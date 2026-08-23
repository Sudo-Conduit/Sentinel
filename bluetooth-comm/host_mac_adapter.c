// host_mac_adapter.c
// Target: macOS (arm64 Apple Silicon & x86_64 Intel) / POSIX
// Compile: clang -O3 -shared -o libmac_adapter.dylib host_mac_adapter.c -lpthread

#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <stdint.h>
#include <fcntl.h>
#include <unistd.h>
#include <termios.h>
#include <pthread.h>
#include <stdatomic.h>
#include <errno.h>
#include <sys/ioctl.h>

// macOS specific header for arbitrary high-speed baud rates
#if defined(__APPLE__)
#include <IOKit/serial/ioss.h>
#endif

#include "host_adapter.h"

#define RING_BUFFER_SIZE 16384
#define RING_BUFFER_MASK (RING_BUFFER_SIZE - 1)

typedef struct {
    uint8_t  buffer[RING_BUFFER_SIZE];
    _Atomic size_t head;
    _Atomic size_t tail;
} spsc_ring_buffer_t;

static spsc_ring_buffer_t g_rx_ring = { .head = 0, .tail = 0 };
static int                g_tty_fd  = -1;
static pthread_t          g_reader_thread;
static _Atomic bool       g_thread_running = false;

// --- SPSC Ring Buffer Operations ---

static size_t ring_push(const uint8_t *data, size_t len) {
    size_t head = atomic_load_explicit(&g_rx_ring.head, memory_order_relaxed);
    size_t tail = atomic_load_explicit(&g_rx_ring.tail, memory_order_acquire);

    size_t available = RING_BUFFER_SIZE - (head - tail);
    size_t to_write  = (len < available) ? len : available;

    for (size_t i = 0; i < to_write; i++) {
        g_rx_ring.buffer[(head + i) & RING_BUFFER_MASK] = data[i];
    }

    atomic_store_explicit(&g_rx_ring.head, head + to_write, memory_order_release);
    return to_write;
}

static size_t ring_pop(uint8_t *dest, size_t max_len) {
    size_t tail = atomic_load_explicit(&g_rx_ring.tail, memory_order_relaxed);
    size_t head = atomic_load_explicit(&g_rx_ring.head, memory_order_acquire);

    size_t available = head - tail;
    size_t to_read   = (max_len < available) ? max_len : available;

    for (size_t i = 0; i < to_read; i++) {
        dest[i] = g_rx_ring.buffer[(tail + i) & RING_BUFFER_MASK];
    }

    atomic_store_explicit(&g_rx_ring.tail, tail + to_read, memory_order_release);
    return to_read;
}

// --- Background Worker Thread ---

static void *mac_uart_reader_thread(void *arg) {
    (void)arg;
    uint8_t rx_chunk[1024];

    while (atomic_load_explicit(&g_thread_running, memory_order_relaxed)) {
        ssize_t bytes_read = read(g_tty_fd, rx_chunk, sizeof(rx_chunk));

        if (bytes_read > 0) {
            ring_push(rx_chunk, (size_t)bytes_read);
        } else if (bytes_read < 0) {
            if (errno != EAGAIN && errno != EWOULDBLOCK) {
                break;
            }
            usleep(100);
        } else {
            usleep(100);
        }
    }
    return NULL;
}

// --- Exported Adapter Interface ---

bool host_adapter_init(const char *device_path, uint32_t baud_rate) {
    g_tty_fd = open(device_path, O_RDWR | O_NOCTTY | O_NDELAY);
    if (g_tty_fd < 0) {
        perror("[Mac Adapter] Error opening serial port");
        return false;
    }

    // Restore blocking behavior for worker thread read() calls
    fcntl(g_tty_fd, F_SETFL, 0);

    struct termios options;
    tcgetattr(g_tty_fd, &options);

    // Raw mode: disable canonical processing, echoing, line signals
    cfmakeraw(&options);

    // Configure 8N1 (8 Data Bits, No Parity, 1 Stop Bit)
    options.c_cflag &= ~(PARENB | CSTOPB | CSIZE);
    options.c_cflag |= (CS8 | CLOCAL | CREAD);

    // =========================================================================
    // HARDWARE RTS/CTS FLOW CONTROL ENABLEMENT
    // =========================================================================
#if defined(CRTSCTS)
    options.c_cflag |= CRTSCTS; // Standard POSIX RTS/CTS Hardware Flow Control
#elif defined(CNEW_RTSCTS)
    options.c_cflag |= CNEW_RTSCTS;
#endif

    // Flush existing hardware buffers before applying new settings
    tcflush(g_tty_fd, TCIOFLUSH);

    // Apply basic termios settings
    if (tcsetattr(g_tty_fd, TCSANOW, &options) != 0) {
        perror("[Mac Adapter] Failed to apply termios parameters");
        close(g_tty_fd);
        return false;
    }

    // =========================================================================
    // HIGH-SPEED BAUD RATE CONFIGURATION (macOS IOSSIOPSPEED Override)
    // =========================================================================
    speed_t speed = (speed_t)baud_rate;

#if defined(__APPLE__) && defined(IOSSIOPSPEED)
    // macOS allows setting arbitrary high baud rates (e.g. 921600, 2000000, 3000000)
    // directly on the underlying serial hardware via ioctl
    if (ioctl(g_tty_fd, IOSSIOPSPEED, &speed) < 0) {
        printf("[Mac Adapter] IOSSIOPSPEED ioctl failed, falling back to standard termios...\n");
        cfsetispeed(&options, B115200);
        cfsetospeed(&options, B115200);
        tcsetattr(g_tty_fd, TCSANOW, &options);
    }
#else
    // Standard POSIX baud mapping fallback
    speed_t b_code = B115200;
    if (baud_rate == 921600)  b_code = B921600;
    if (baud_rate == 2000000) b_code = B2000000;
    cfsetispeed(&options, b_code);
    cfsetospeed(&options, b_code);
    tcsetattr(g_tty_fd, TCSANOW, &options);
#endif

    // Reset SPSC ring buffer indices
    atomic_store_explicit(&g_rx_ring.head, 0, memory_order_relaxed);
    atomic_store_explicit(&g_rx_ring.tail, 0, memory_order_relaxed);

    // Spawn ingestion thread
    atomic_store_explicit(&g_thread_running, true, memory_order_relaxed);
    if (pthread_create(&g_reader_thread, NULL, mac_uart_reader_thread, NULL) != 0) {
        perror("[Mac Adapter] pthread_create failed");
        close(g_tty_fd);
        return false;
    }

    printf("[Mac Adapter] Hardware RTS/CTS Flow Control enabled on %s at %u baud\n", device_path, baud_rate);
    return true;
}

uint32_t host_uart_write_bytes(const uint8_t *buffer, uint32_t length) {
    if (g_tty_fd < 0 || buffer == NULL || length == 0) return 0;

    ssize_t written = write(g_tty_fd, buffer, length);
    return (written > 0) ? (uint32_t)written : 0;
}

uint32_t host_uart_read_bytes(uint8_t *buffer, uint32_t max_length) {
    if (buffer == NULL || max_length == 0) return 0;
    return (uint32_t)ring_pop(buffer, (size_t)max_length);
}

void host_adapter_cleanup(void) {
    if (atomic_load_explicit(&g_thread_running, memory_order_relaxed)) {
        atomic_store_explicit(&g_thread_running, false, memory_order_relaxed);
        pthread_join(g_reader_thread, NULL);
    }

    if (g_tty_fd >= 0) {
        // Assert RTS low/clear before closing
        int flags;
        if (ioctl(g_tty_fd, TIOCMGET, &flags) >= 0) {
            flags &= ~TIOCM_RTS;
            ioctl(g_tty_fd, TIOCMSET, &flags);
        }
        close(g_tty_fd);
        g_tty_fd = -1;
    }
    printf("[Mac Adapter] Adapter safely shut down.\n");
}
