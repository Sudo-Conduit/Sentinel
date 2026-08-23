#ifndef HOST_ADAPTER_H
#define HOST_ADAPTER_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

// Shared library export macros for Windows DLLs and POSIX visibility
#if defined(_WIN32) || defined(CYGWIN)
#ifdef HOST_ADAPTER_EXPORTS
#define HOST_ADAPTER_API __declspec(dllexport)
#else
#define HOST_ADAPTER_API __declspec(dllimport)
#endif
#else
#if __GNUC__ >= 4
#define HOST_ADAPTER_API __attribute__((visibility("default")))
#else
#define HOST_ADAPTER_API
#endif
#endif

// Initializes the underlying hardware serial port (TTY / COM) and starts
// the background ingestion worker thread.
// @param device_path OS-specific path (e.g., "/dev/ttyUSB0", "/dev/cu.usbserial-10", "\\.\COM3")
// @param baud_rate   Target baud rate (e.g., 115200, 921600, 3000000)
// @return true on success, false on failure
HOST_ADAPTER_API bool host_adapter_init(const char *device_path, uint32_t baud_rate);

// Synchronously writes raw binary bytes to the hardware serial port.
// @param buffer Pointer to the byte array to transmit
// @param length Number of bytes to send
// @return Number of bytes successfully written to the serial node
HOST_ADAPTER_API uint32_t host_uart_write_bytes(const uint8_t *buffer, uint32_t length);

// Non-blocking read from the host adapter's internal SPSC ring buffer.
// @param buffer     Pointer to memory where received bytes should be copied
// @param max_length Maximum number of bytes to read
// @return Number of bytes retrieved from the ring buffer
HOST_ADAPTER_API uint32_t host_uart_read_bytes(uint8_t *buffer, uint32_t max_length);

// Signals the background reader thread to terminate and releases the hardware
// COM / TTY file descriptor or handle.
HOST_ADAPTER_API void host_adapter_cleanup(void);

#ifdef __cplusplus
}
#endif

#endif // HOST_ADAPTER_H
