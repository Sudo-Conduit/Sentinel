// cpu_gpu_providers.mjs -- SME1, SME2, SDOT, BFDOT (Will's "BDOT"), and GPU as
// ComputeCore-shaped providers. SME1/SME2/SDOT/BFDOT now point at the
// *_fixed dylibs (sme1_fixed, sme2_fixed, kernels_fixed) -- the originals had
// real, confirmed-and-fixed correctness bugs (SME: a vertical-slice ZA drain
// bug plus a predicate-as-counter construction bug; SDOT: B indexed along
// the wrong dimension entirely, plus only writing 1/4 of each output block;
// BFDOT: 4 partial-sum lanes of one dot product mis-stored as 4 different
// columns). Contract, matching ane_provider.mjs:
//   { id, kind, detail, alloc(Ctor,n), matmul(m,n,k,A,lda,B,ldb,C,ldc) }.
//
// None of these need MIL/e5rt compilation -- each dylib call is already a
// plain, immediately-dispatchable GEMM, so these providers are much thinner
// than the ANE one. SME1/SME2/GPU are pure f32 end to end (zero conversion).
// SDOT is genuinely lossy (int8 quantization) and BFDOT needs a cheap
// truncating f32->bf16 pack -- both documented honestly below, not hidden.
import koffi from 'koffi';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// libmetalwrapper.dylib (Metal GPU backend) is a pre-built dependency whose
// source isn't part of this directory -- point METALWRAPPER_DIR at wherever
// it lives, or build.sh drops it alongside these files by default.
const HERE = process.env.METALWRAPPER_DIR || __dirname;

function contiguousGuard(lda, k, ldb, n, ldc, providerId) {
    if (lda !== k || ldb !== n || ldc !== n) {
        throw new Error(`${providerId}_provider: non-contiguous stride unsupported (lda=${lda},k=${k} ldb=${ldb},n=${n} ldc=${ldc})`);
    }
}

// ─── SME1 / SME2 -- plain f32, no conversion at all ─────────────────────────
// Raw TypedArrays, no Buffer wrapping -- the earlier Buffer workaround was
// masking symptoms of the since-fixed C bugs, not a real koffi requirement
// (confirmed against the fixed dylibs on Node 22+).

function makeSmeProvider(which) {
    const lib = koffi.load(path.join(__dirname, `${which}_fixed.dylib`));
    const fn = lib.func(`void ${which}_gemm_f32(const float *A, const float *B, float *C, size_t M, size_t N, size_t K)`);
    return {
        id: which,
        kind: 'fp32',
        detail: `${which}_fixed.dylib (ARM SME, native f32)`,
        alloc: (Ctor, n) => new Ctor(n),
        matmul(m, n, k, A, lda, B, ldb, C, ldc) {
            contiguousGuard(lda, k, ldb, n, ldc, which);
            fn(A, B, C, m, n, k);
        },
    };
}

// ─── SDOT -- int8, genuinely lossy; scale is symmetric per-call ────────────

const kernels = koffi.load(path.join(__dirname, 'kernels_fixed.dylib'));
const sdotGemm = kernels.func('void sdot_gemm_i8(const int8_t *A, const int8_t *B, int32_t *C, size_t M, size_t N, size_t K)');
const bfdotGemm = kernels.func('void bfdot_gemm_bf16(const uint16_t *A, const uint16_t *B, float *C, size_t M, size_t N, size_t K)');

function quantizeI8(src, n) {
    let maxAbs = 1e-12;
    for (let i = 0; i < n; i++) { const a = Math.abs(src[i]); if (a > maxAbs) maxAbs = a; }
    const scale = 127 / maxAbs;
    const out = new Int8Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.max(-127, Math.min(127, Math.round(src[i] * scale)));
    return { out, scale };
}

export const SDOT_PROVIDER = {
    id: 'sdot',
    kind: 'int8 (lossy quantization -- see detail)',
    detail: 'kernels.dylib sdot_gemm_i8: symmetric per-call int8 quantization of A and B, ' +
            'int32 accumulator dequantized by 1/(scaleA*scaleB). NOT bit-exact -- real ' +
            'quantization error, reported honestly rather than forced to pass a tight tolerance.',
    alloc: (Ctor, n) => new Ctor(n),
    matmul(m, n, k, A, lda, B, ldb, C, ldc) {
        contiguousGuard(lda, k, ldb, n, ldc, 'sdot');
        const { out: Aq, scale: sa } = quantizeI8(A, m * k);
        const { out: Bq, scale: sb } = quantizeI8(B, k * n);
        const Cint = new Int32Array(m * n);
        sdotGemm(Aq, Bq, Cint, m, n, k);
        const inv = 1 / (sa * sb);
        for (let i = 0; i < m * n; i++) C[i] = Cint[i] * inv;
    },
};

// ─── BFDOT ("BDOT") -- bf16, exact truncation (not fp16's remapping) ────────

function f32_to_bf16(val) {
    const f32 = new Float32Array([val]);
    const bits = new Uint32Array(f32.buffer)[0];
    const rounded = (bits + 0x7fff + ((bits >>> 16) & 1)) >>> 0;  // round-to-nearest-even
    return (rounded >>> 16) & 0xffff;
}

export const BFDOT_PROVIDER = {
    id: 'bfdot',
    kind: 'bf16 (lossy, ~7-bit mantissa; output stays fp32)',
    detail: 'kernels.dylib bfdot_gemm_bf16: A/B truncated to bf16, accumulates to fp32 directly (no output requant, unlike SDOT).',
    alloc: (Ctor, n) => new Ctor(n),
    matmul(m, n, k, A, lda, B, ldb, C, ldc) {
        contiguousGuard(lda, k, ldb, n, ldc, 'bfdot');
        const Ab = new Uint16Array(m * k);
        const Bb = new Uint16Array(k * n);
        for (let i = 0; i < m * k; i++) Ab[i] = f32_to_bf16(A[i]);
        for (let i = 0; i < k * n; i++) Bb[i] = f32_to_bf16(B[i]);
        bfdotGemm(Ab, Bb, C, m, n, k);
    },
};

// ─── GPU -- Metal via libmetalwrapper.dylib, plain f32 ─────────────────────

const mwLib = koffi.load(path.join(HERE, 'libmetalwrapper.dylib'));
const mw_init = mwLib.func('int mw_init()');
const mw_last_error = mwLib.func('const char *mw_last_error()');
const mw_matmul_f32 = mwLib.func(
    'int mw_matmul_f32(int M, int N, int K, const float *A, const float *B, float *C, float alpha, float beta)');

let gpuInited = false;
function ensureGpuInit() {
    if (gpuInited) return;
    const rc = mw_init();
    if (rc !== 0) throw new Error(`mw_init failed (rc=${rc}): ${mw_last_error()}`);
    gpuInited = true;
}

export const GPU_PROVIDER = {
    id: 'gpu',
    kind: 'fp32',
    detail: 'libmetalwrapper.dylib mw_matmul_f32 (Metal, native f32, no CPE-side tiling/pack applied)',
    alloc: (Ctor, n) => new Ctor(n),
    matmul(m, n, k, A, lda, B, ldb, C, ldc) {
        contiguousGuard(lda, k, ldb, n, ldc, 'gpu');
        ensureGpuInit();
        const rc = mw_matmul_f32(m, n, k, A, B, C, 1.0, 0.0);
        if (rc !== 0) throw new Error(`mw_matmul_f32 failed (rc=${rc}): ${mw_last_error()}`);
    },
};

export const SME1_PROVIDER = makeSmeProvider('sme1');
export const SME2_PROVIDER = makeSmeProvider('sme2');
