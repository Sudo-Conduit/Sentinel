/*
 * memorymap.c — Capability-gated shared linear memory for MSOS WASM modules
 *
 * v0.0.03 — Bug fixes from audit
 *
 * ── Fixes applied ────────────────────────────────────────────────────────
 *
 *   BUG 2: ct_eq32 operator precedence — added parens around (diff | -diff)
 *           before >> 31. Previous form evaluated as diff | ((-diff) >> 31).
 *   BUG 3: pagesNeeded / pagesBatch removed unconditional +1. Ceiling
 *           division already handles exact page boundaries.
 *   BUG 8: pagesNeeded / pagesBatch return type changed to uint32_t.
 *           Pages are never negative; matched to matmul_wasm.h contract.
 *
 * ── Control header layout (bytes 0..255, reserved) ───────────────────────
 *
 *   [0   ..  15]   UUID        (16 bytes, written by host at init)
 *   [16  ..  47]   PublicKey   (32 bytes, written by host at init)
 *   [48  ..  79]   AuthScratch (32 bytes, host writes token before write())
 *   [80  ..  83]   AuthStatus  (u32: 0=unauthenticated, 1=authenticated)
 *   [84  .. 255]   reserved / padding
 *   [256 ..]       Slot data   (float32 slots, slot N at byte 256 + N*4)
 *
 * ── Authentication model ──────────────────────────────────────────────────
 *
 *   PublicKey is a 32-byte token provisioned by the host at init.
 *   Before calling write(), an authenticated caller writes the same 32 bytes
 *   into AuthScratch then calls authenticate(). Constant-time compare sets
 *   AuthStatus. getMemoryMap() and write() gate on AuthStatus == 1.
 *   read() is unconditionally public.
 *
 * ── Memory ────────────────────────────────────────────────────────────────
 *
 *   256 MB flat static array. Host accesses via exported memory_base symbol.
 *   Supports 4096×4096×4096 f32 without overflow.
 *
 * Compile:
 *   clang --target=wasm32-wasi-threads -pthread -O3 -msimd128 \
 *         -I. \
 *         -Wl,--no-entry -Wl,--export-all \
 *         -Wl,--export-memory \
 *         -Wl,--shared-memory \
 *         -Wl,--initial-memory=268435456 \
 *         -Wl,--max-memory=268435456 \
 *         -o memorymap.wasm memorymap.c
 */

#include "memorymap.h"
#include <stdint.h>

// ============================================================================
// MEMORY DECLARATION
// ============================================================================

__attribute__((used)) __attribute__((visibility("default"))) uint8_t memory_base[268435456] __attribute__((aligned(65536)));

#define IDENTIFIER   ((char     *)(memory_base + IDENTIFIER_OFFSET))
#define MASTER_KEY   ((char     *)(memory_base + MASTER_KEY_OFFSET))
#define SCRATCH      ((char     *)(memory_base + SCRATCH_OFFSET))
#define STATUS_FLAG  ((uint32_t *)(memory_base + STATUS_FLAG_OFFSET))
#define SLOTS        ((float    *)(memory_base + SLOT_BASE))

// ============================================================================
// INTERNAL: runtime base address
// memory_base is a static array placed by the linker at an arbitrary offset
// in linear memory (typically 65536). All exported offset functions add this
// so callers receive absolute linear memory addresses usable directly against
// memory.buffer — no JS-side arithmetic required.
// ============================================================================

static inline uint32_t mem_base(void)
{
    return (uint32_t)(uintptr_t)memory_base;
}

// ============================================================================
// CONSTANT-TIME COMPARISON
// ============================================================================

static int ct_eq32(const unsigned char *a, const unsigned char *b)
{
    unsigned char diff = 0;
    for (int i = 0; i < KEY_LEN; i++)
        diff |= a[i] ^ b[i];
    // BUG 2 FIX: parens around (diff | -diff) before >> 31
    return (int)(1 - (((unsigned int)diff | (unsigned int)-(int)diff) >> 31));
}

static int auth_check(void)
{
    const unsigned char *pubkey  = (const unsigned char *)MASTER_KEY;
    const unsigned char *scratch = (const unsigned char *)SCRATCH;
    int ok = ct_eq32(pubkey, scratch);
    *STATUS_FLAG = (uint32_t)ok;
    return ok;
}

// ============================================================================
// EXPORTED: Identity
// ============================================================================

__attribute__((used)) __attribute__((visibility("default")))
uint32_t getUUID(void) {
    return mem_base() + (uint32_t)IDENTIFIER_OFFSET;
}

__attribute__((used)) __attribute__((visibility("default")))
uint32_t getPublicKey(void) {
    return mem_base() + (uint32_t)MASTER_KEY_OFFSET;
}

__attribute__((used)) __attribute__((visibility("default")))
uint32_t getAuthScratch(void) {
    return mem_base() + (uint32_t)SCRATCH_OFFSET;
}

// ============================================================================
// EXPORTED: Authentication
// ============================================================================

__attribute__((used)) __attribute__((visibility("default")))
int authenticate(void) {
    return auth_check();
}

__attribute__((used)) __attribute__((visibility("default")))
void deauthenticate(void)
{
    unsigned char *scratch = (unsigned char *)SCRATCH;
    for (int i = 0; i < SCRATCH_LEN; i++)
        scratch[i] = 0;
    *STATUS_FLAG = 0u;
}

// ============================================================================
// EXPORTED: Memory Access
// ============================================================================

__attribute__((used)) __attribute__((visibility("default")))
uint32_t getMemoryMap(void) {
    if (*STATUS_FLAG != 1u) return 0u;
    return mem_base() + (uint32_t)SLOT_BASE;
}

__attribute__((used)) __attribute__((visibility("default")))
float read(uint32_t slot) {
    return SLOTS[slot];
}

__attribute__((used)) __attribute__((visibility("default")))
int write(uint32_t slot, float value)
{
    if (*STATUS_FLAG != 1u) return ERR_NOT_AUTHENTICATED;
    SLOTS[slot] = value;
    return SUCCESS;
}

// ============================================================================
// EXPORTED: Layout Helpers
// ============================================================================

__attribute__((used)) __attribute__((visibility("default")))
uint32_t slotBase(void) {
    return mem_base() + (uint32_t)SLOT_BASE;
}

__attribute__((used)) __attribute__((visibility("default")))
uint32_t slotByteOffset(uint32_t slot) {
    return mem_base() + (uint32_t)SLOT_BASE + slot * 4u;
}

__attribute__((used)) __attribute__((visibility("default")))
uint32_t maxSlots(void) {
    uint32_t usableBytes = 268435456u - (uint32_t)SLOT_BASE;
    return usableBytes / 4u;
}

__attribute__((used)) __attribute__((visibility("default")))
int totalPages(void) {
    return 4096;
}

/**
 * getBase() — returns the absolute linear memory address of memory_base.
 *
 * Sibling modules (matmul_wasm, etc.) that share this memory object must
 * call getBase() at init to resolve where the buffer actually starts.
 * All header offsets and slot addresses are relative to this value.
 * The host passes this return value into sibling module init functions.
 */
__attribute__((used)) __attribute__((visibility("default")))
uint32_t getBase(void) {
    return mem_base();
}

// ============================================================================
// EXPORTED: Matrix Layout Helpers
// ============================================================================

__attribute__((used)) __attribute__((visibility("default")))
uint32_t offsetA(void) {
    return mem_base() + (uint32_t)SLOT_BASE;
}

__attribute__((used)) __attribute__((visibility("default")))
uint32_t offsetB(int M, int K) {
    return mem_base() + (uint32_t)SLOT_BASE
         + (uint32_t)((uint64_t)M * (uint64_t)K * 4ULL);
}

__attribute__((used)) __attribute__((visibility("default")))
uint32_t offsetC(int M, int K, int N)
{
    uint64_t offB = (uint64_t)M * (uint64_t)K * 4ULL;
    uint64_t offC = offB + (uint64_t)K * (uint64_t)N * 4ULL;
    return mem_base() + (uint32_t)SLOT_BASE + (uint32_t)offC;
}

__attribute__((used)) __attribute__((visibility("default")))
uint32_t offsetBBatch(int batchSize, int K) {
    return mem_base() + (uint32_t)SLOT_BASE
         + (uint32_t)((uint64_t)batchSize * (uint64_t)K * 4ULL);
}

__attribute__((used)) __attribute__((visibility("default")))
uint32_t offsetCBatch(int batchSize, int K, int N)
{
    uint64_t offB = (uint64_t)batchSize * (uint64_t)K * 4ULL;
    uint64_t offC = offB + (uint64_t)K * (uint64_t)N * 4ULL;
    return mem_base() + (uint32_t)SLOT_BASE + (uint32_t)offC;
}

// ============================================================================
// EXPORTED: Memory Sizing
// BUG 3 FIX: removed unconditional +1; ceiling division handles boundaries.
// BUG 8 FIX: return type uint32_t (matched to header).
// ============================================================================

__attribute__((used)) __attribute__((visibility("default")))
uint32_t pagesNeeded(int M, int K, int N)
{
    if (M == 0 || K == 0 || N == 0) return 1;
    uint64_t total_floats = (uint64_t)M * K + (uint64_t)K * N + (uint64_t)M * N;
    uint64_t total_bytes  = (uint64_t)SLOT_BASE + total_floats * 4ULL;
    return (uint32_t)((total_bytes + 65535ULL) / 65536ULL);
}

__attribute__((used)) __attribute__((visibility("default")))
uint32_t pagesBatch(int batchSize, int K, int N)
{
    if (batchSize == 0 || K == 0 || N == 0) return 1;
    uint64_t total_floats = (uint64_t)batchSize * K
                          + (uint64_t)K * N
                          + (uint64_t)batchSize * N;
    uint64_t total_bytes  = (uint64_t)SLOT_BASE + total_floats * 4ULL;
    return (uint32_t)((total_bytes + 65535ULL) / 65536ULL);
}

// ============================================================================
// COMPILE-TIME CHECKS
// ============================================================================

_Static_assert(SLOT_BASE         == 256, "Slots must start at address 256");
_Static_assert(SLOT_SIZE         ==   4, "Float must be 4 bytes");
_Static_assert(STATUS_FLAG_OFFSET == 80, "Status flag must be at address 80");
_Static_assert(IDENTIFIER_OFFSET  ==  0, "UUID must be at address 0");
_Static_assert(MASTER_KEY_OFFSET  == 16, "Master key must be at address 16");
