#ifndef MEMORYMAP_H
#define MEMORYMAP_H

#include <stdint.h>

// ============================================================================
// MEMORY LAYOUT CONSTANTS — MUST MATCH BETWEEN MODULES
// ============================================================================

#define HEADER_SIZE           256
#define IDENTIFIER_OFFSET     0
#define MASTER_KEY_OFFSET     16
#define SCRATCH_OFFSET        48
#define STATUS_FLAG_OFFSET    80

#define IDENTIFIER_LEN        16
#define KEY_LEN               32
#define SCRATCH_LEN           32

#define SLOT_BASE             256
#define SLOT_SIZE             4       // sizeof(float)

// ============================================================================
// ERROR CODES
// ============================================================================

#define SUCCESS                   0
#define ERR_AUTH_FAILED          -1
#define ERR_NOT_AUTHENTICATED    -2
#define ERR_INVALID_ADDRESS      -3
#define ERR_NULL_POINTER         -4
#define ERR_ALREADY_AUTH         -5
#define ERR_MEMORY_NOT_SHARED    -6
#define ERR_THREAD_CREATE        -7
#define ERR_INVALID_DIMENSION    -8
#define ERR_MEMORY_OVERFLOW      -9
#define ERR_INSUFFICIENT_MEMORY  -10
#define ERR_INVALID_THREAD_COUNT -11

// ============================================================================
// EXPORTED FUNCTIONS — memorymap.c
// ============================================================================

// Identity
uint32_t getUUID(void);
uint32_t getPublicKey(void);
uint32_t getAuthScratch(void);

// Authentication
int  authenticate(void);
void deauthenticate(void);

// Memory access
uint32_t getMemoryMap(void);
float    read(uint32_t slot);
int      write(uint32_t slot, float value);

// Layout helpers
uint32_t slotBase(void);
uint32_t slotByteOffset(uint32_t slot);
uint32_t maxSlots(void);
int      totalPages(void);

// Matrix offsets
uint32_t offsetA(void);
uint32_t offsetB(int M, int K);
uint32_t offsetC(int M, int K, int N);
uint32_t offsetBBatch(int batchSize, int K);
uint32_t offsetCBatch(int batchSize, int K, int N);

// Memory sizing — uint32_t: pages never negative (BUG 9 fix)
uint32_t pagesNeeded(int M, int K, int N);
uint32_t pagesBatch(int batchSize, int K, int N);

#endif // MEMORYMAP_H
