// ane_provider.mjs -- a ComputeCore-shaped provider backed by the real,
// verified e5rt/ANE dispatch path (libane_e5rt_dispatch.dylib), via koffi.
// Contract: { id, kind, detail, alloc(Ctor,n), matmul(m,n,k,A,lda,B,ldb,C,ldc) }
//
// ComputeCore's providers are Float32Array end to end; the ANE path is
// fp16-only I/O (MIL rejects fp32 as I/O type). So this provider converts at
// the boundary -- f32 in, f16 to the ANE, f16 back, f32 out -- and caches one
// compiled MIL program per distinct (m,k,n) shape, since RoutedMixin calls
// the same shape repeatedly across bench reps and across experts of equal
// row-count.
import koffi from 'koffi';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DYLIB = join(__dirname, 'libane_e5rt_dispatch.dylib');
const CACHE_DIR = join(__dirname, 'e5rt_cache_cpe');
mkdirSync(CACHE_DIR, { recursive: true });

const lib = koffi.load(DYLIB);

const ProgramPtr = koffi.pointer('ane_e5rt_program_t', koffi.opaque());

const compile = lib.func(
    'ane_e5rt_program_t *ane_e5rt_program_compile(const char *mil_path, const char *cache_dir, ' +
    'uint64_t device_mask, const char **input_names, const size_t *input_sizes, size_t n_inputs, ' +
    'const char **output_names, const size_t *output_sizes, size_t n_outputs)');
const setInput = lib.func('int ane_e5rt_program_set_input_fp16(ane_e5rt_program_t *prog, const char *port, const uint16_t *data, size_t n_elems)');
const execute = lib.func('int ane_e5rt_program_execute(ane_e5rt_program_t *prog)');
const getOutput = lib.func('int ane_e5rt_program_get_output_fp16(ane_e5rt_program_t *prog, const char *port, uint16_t *dest, size_t n_elems)');
const release = lib.func('void ane_e5rt_program_release(ane_e5rt_program_t *prog)');

// Hardware fp16<->fp32 conversion via ARM NEON's native FP16 support
// (f16_convert.c, vcvt_f32_f16/vcvt_f16_f32 -- a single FCVT instruction per
// 4 lanes; ARM's equivalent of x86 F16C). Two prior versions of this file
// did the conversion in JS instead: a scalar bit-manipulation loop that
// allocated fresh TypedArrays per element (33.5M allocations/call at
// 4096x4096, dominating everything), then a fixed allocation-free version
// that still called Math.pow() per element on the f16->f32 side (387-591ms
// by itself). Both were software reimplementing what this hardware already
// does natively, in whole-array calls: 3.91ms and 6.29ms respectively for
// 16.78M elements, vs ~30ms and ~39ms in JS.
const f16lib = koffi.load(join(__dirname, 'f16_convert.dylib'));
const f32arr_to_f16 = f16lib.func('void f32_to_f16_array(const float *src, uint16_t *dst, size_t n)');
const f16arr_to_f32 = f16lib.func('void f16_to_f32_array(const uint16_t *src, float *dst, size_t n)');

function genMil(m, k, n) {
    return `program(1.3)
[buildInfo = dict<string, string>({{"coremlc-component-MIL", "3520.4.1"},
                                    {"coremlc-version", "3520.5.1"}})]
{
    func main<ios18>(tensor<fp16, [${m}, ${k}]> a, tensor<fp16, [${k}, ${n}]> b) {
        tensor<fp16, [${m}, ${n}]> y = matmul(transpose_x = bool(false), transpose_y = bool(false),
            x = a, y = b)[name = string("y")];
    } -> (y);
}
`;
}

const shapeCache = new Map();  // "m,k,n" -> { prog, aBuf, bBuf, yBuf }
let compileCount = 0, cacheHits = 0;

// Weight (B operand) conversion cache, keyed by array identity. A weight
// matrix is the same object reference across every call that reuses it
// (dense: same W[e] on every rep; routed: same W[e] across every expert-call
// across every rep) -- only its DESTINATION buffer changes per shape, since
// each compiled (m,k,n) program owns its own I/O buffers. Content is
// converted once per distinct weight object; A (the activation/gathered
// rows) is untouched by this and still converts every call, since it holds
// genuinely different data each time.
const weightCache = new WeakMap();  // Float32Array -> Uint16Array (fp16, shape-independent content)
let weightConversions = 0, weightCacheHits = 0;

function getCompiled(m, k, n) {
    const key = `${m},${k},${n}`;
    let entry = shapeCache.get(key);
    if (entry) { cacheHits++; return entry; }

    const milPath = join(CACHE_DIR, `gemm_${key.replace(/,/g, '_')}.mil`);
    writeFileSync(milPath, genMil(m, k, n));

    const inputNames = ['a', 'b'];
    const inputSizes = [BigInt(m * k * 2), BigInt(k * n * 2)];
    const outputNames = ['y'];
    const outputSizes = [BigInt(m * n * 2)];

    const prog = compile(milPath, CACHE_DIR, 4n, inputNames, inputSizes, 2n, outputNames, outputSizes, 1n);
    if (!prog) throw new Error(`ANE compile failed for shape ${key}`);
    compileCount++;

    entry = {
        prog,
        aBuf: new Uint16Array(m * k),
        bBuf: new Uint16Array(k * n),
        yBuf: new Uint16Array(m * n),
    };
    shapeCache.set(key, entry);
    return entry;
}

export const ANE_PROVIDER = {
    id: 'ane',
    kind: 'fp16-io (converted at boundary)',
    detail: 'e5rt/ANE (Espresso, device_mask=0x4, no fallback)',
    alloc: (Ctor, n) => new Ctor(n),
    matmul(m, n, k, A, lda, B, ldb, C, ldc) {
        // RoutedMixin's gather/scatter always hands contiguous blocks, so
        // lda===k, ldb===n, ldc===n holds for our actual call pattern.
        if (lda !== k || ldb !== n || ldc !== n) {
            throw new Error(`ane_provider: non-contiguous stride unsupported (lda=${lda},k=${k} ldb=${ldb},n=${n} ldc=${ldc})`);
        }
        const { prog, aBuf, bBuf, yBuf } = getCompiled(m, k, n);

        f32arr_to_f16(A, aBuf, m * k);

        let bConverted = weightCache.get(B);
        if (bConverted && bConverted.length === k * n) {
            weightCacheHits++;
        } else {
            bConverted = new Uint16Array(k * n);
            f32arr_to_f16(B, bConverted, k * n);
            weightCache.set(B, bConverted);
            weightConversions++;
        }
        bBuf.set(bConverted);   // native, vectorized copy into this shape's dedicated buffer

        setInput(prog, 'a', aBuf, BigInt(m * k));
        setInput(prog, 'b', bBuf, BigInt(k * n));
        if (execute(prog) !== 0) throw new Error(`ANE execute failed for shape ${m},${k},${n}`);
        getOutput(prog, 'y', yBuf, BigInt(m * n));

        f16arr_to_f32(yBuf, C, m * n);
    },
    stats: () => ({ compiles: compileCount, cacheHits, weightConversions, weightCacheHits }),
};
