// host_linux_adapter.c
// Target: Linux (x86_64, arm64, riscv64)
// Compile: gcc -O3 -shared -fPIC -o liblinux_adapter.so host_linux_adapter.c -lpthread

#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <stdint.h>
#include <fcntl.h>
#include <unistd.h>
#include <pthread.h>
#include <stdatomic.h>
#include <errno.h>
#include <sys/ioctl.h>
#include <asm/termbits.h> // Required for termios2 and BOTHER custom baud rates
// Deliberately not including <termios.h>: on some glibc/kernel-header
// combinations its `struct termios` collides with the one pulled in by
// <asm/termbits.h> above. Only the termios2 ioctl path (TCGETS2/TCSETS2)
// is used here, so the legacy termios.h declarations aren't needed.

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

static void *linux_uart_reader_thread(void *arg) {
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
    // Open Linux TTY device in non-blocking mode
    g_tty_fd = open(device_path, O_RDWR | O_NOCTTY | O_NDELAY);
    if (g_tty_fd < 0) {
        perror("[Linux Adapter] Failed to open serial port");
        return false;
    }

    // 1. Lock device exclusively to prevent ModemManager/brltty interference
    if (ioctl(g_tty_fd, TIOCEXCL) < 0) {
        perror("[Linux Adapter] Warning: Could not set TIOCEXCL exclusive lock");
    }

    // 2. Restore blocking behavior for worker thread read() calls
    fcntl(g_tty_fd, F_SETFL, 0);

    // 3. Configure Custom Baud Rate & RTS/CTS via Linux termios2
    struct termios2 tio2;
    if (ioctl(g_tty_fd, TCGETS2, &tio2) < 0) {
        perror("[Linux Adapter] TCGETS2 ioctl failed");
        close(g_tty_fd);
        return false;
    }

    // Set Raw Mode
    tio2.c_iflag &= ~(IGNBRK | BRKINT | PARMRK | ISTRIP | INLCR | IGNCR | ICRNL | IXON);
    tio2.c_oflag &= ~OPOST;
    tio2.c_lflag &= ~(ECHO | ECHONL | ICANON | ISIG | IEXTEN);

    // Set 8N1 (8 Data Bits, No Parity, 1 Stop Bit)
    tio2.c_cflag &= ~(PARENB | CSTOPB | CSIZE);
    tio2.c_cflag |= (CS8 | CLOCAL | CREAD);

    // Enable Hardware RTS/CTS Flow Control
    tio2.c_cflag |= CRTSCTS;

    // Set Custom Arbitrary Baud Rate via BOTHER flag
    tio2.c_cflag &= ~CBAUD;
    tio2.c_cflag |= BOTHER;
    tio2.c_ispeed = baud_rate;
    tio2.c_ospeed = baud_rate;

    if (ioctl(g_tty_fd, TCSETS2, &tio2) < 0) {
        perror("[Linux Adapter] TCSETS2 ioctl failed to apply baud rate");
        close(g_tty_fd);
        return false;
    }

    // Reset ring buffer
    atomic_store_explicit(&g_rx_ring.head, 0, memory_order_relaxed);
    atomic_store_explicit(&g_rx_ring.tail, 0, memory_order_relaxed);

    // Spawn ingestion thread
    atomic_store_explicit(&g_thread_running, true, memory_order_relaxed);
    if (pthread_create(&g_reader_thread, NULL, linux_uart_reader_thread, NULL) != 0) {
        perror("[Linux Adapter] pthread_create failed");
        close(g_tty_fd);
        return false;
    }

    printf("[Linux Adapter] Exclusive access granted on %s at %u baud (RTS/CTS ON)\n", device_path, baud_rate);
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
        ioctl(g_tty_fd, TIOCNXCL); // Clear exclusive lock
        close(g_tty_fd);
        g_tty_fd = -1;
    }
    printf("[Linux Adapter] Clean shutdown completed.\n");
}
