// sentinel_mem.h
// Tiny freestanding memory helpers shared by the WASM modules.
// Kept `static inline` so each translation unit gets its own copy with
// no libc dependency — this code is built with -nostdlib.

#ifndef SENTINEL_MEM_H
#define SENTINEL_MEM_H

#include <stddef.h>
#include <stdint.h>

static inline void sentinel_memcpy(void *dest, const void *src, size_t n) {
    uint8_t *d = (uint8_t *)dest;
    const uint8_t *s = (const uint8_t *)src;
    for (size_t i = 0; i < n; i++) d[i] = s[i];
}

static inline void sentinel_memset(void *dest, uint8_t value, size_t n) {
    uint8_t *d = (uint8_t *)dest;
    for (size_t i = 0; i < n; i++) d[i] = value;
}

#endif // SENTINEL_MEM_H
