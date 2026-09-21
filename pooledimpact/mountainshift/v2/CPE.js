/**
 * @file CPE.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Compute Processing Engine -- one `run(cmd)` surface over whatever
 *              matmul engine the host actually has, so the same source runs on
 *              Linux, in a browser, and on a Mac without a language switch or a
 *              build step.
 *
 *   Design rule, and the reason this is small:
 *
 *       EVERY ENGINE IS ONLY EVER ASKED FOR A NORMAL MATMUL.
 *
 *   The routed/MoE op is not a special kernel. It is a selection followed by
 *   ordinary dense matmuls: gather the rows each expert owns into a contiguous
 *   block, hand that block to the engine as a plain GEMM, scatter the result
 *   back. BLAS and AMX are at their worst on short ragged blocks and at their
 *   best on normal ones, so the fix is to never hand them anything else --
 *   research/routed-gemm measured BLAS retaining 2% of its dense rate at one
 *   row per block, and the cause was weight re-streaming, not call overhead.
 *   `matmul` is therefore the only primitive; `routed` composes it.
 *
 *   Providers (a provider is just an object with a matmul):
 *     blas -- koffi -> cblas_sgemm in whatever is on the box. One CBLAS ABI
 *             covers MKL, OpenBLAS and Apple Accelerate, which is what makes
 *             Linux and Mac the same code path. MKL additionally dispatches
 *             cblas_gemm_s8u8s32 to VNNI and AMX, so the int8 tile engines are
 *             reachable with no C of ours.
 *     js   -- portable reference. No FFI, no build. This is the browser path
 *             until a WASM-SIMD provider lands beside it.
 *
 *   Extensibility is ExtendX, not inheritance: ops live in mixins and compose
 *   at runtime, so a new op (Quantum, when it is mainline) is a mixin added to
 *   the list rather than an edit to this file.
 *
 *   ArrayBuffer and typed-array views only. No Buffer, no Node globals outside
 *   the guarded provider probe -- the target runtime is a browser.
 *
 * @see research/routed-gemm/README.md -- the measurements this design follows
 */
(function(root, factory)
{
    if (typeof define === 'function' && define.amd)
    {
        define(['./ExtendX.js'], factory);
    }
    else if (typeof module === 'object' && module.exports)
    {
        let ExtendX = null;
        try { ExtendX = require('./ExtendX.js'); } catch (e) { /* optional */ }
        module.exports = factory(ExtendX);
    }
    else
    {
        root.CPE = factory(root.ExtendX);
    }
}(typeof self !== 'undefined' ? self : this, function(ExtendX)
{
    'use strict';

    const AUTHOR = 'Wilbert Fobbs III';
    const COMPANY = 'Pooled Impact';
    const VERSION = '1.0.0';
    const NAME = 'CPE';

    const ROW_MAJOR = 101, NO_TRANS = 111;
    const ALIGN = 64;

    // ─── Host detection ─────────────────────────────────────────
    // Deliberately duck-typed rather than checking for Node: a browser build,
    // an Electron renderer and a bundler shim all differ, and all of them
    // simply fail to produce koffi, which is the only signal that matters.

    const HOST = (function()
    {
        const hasProcess = typeof process === 'object' && process !== null
            && typeof process.versions === 'object';
        return {
            node: hasProcess && !!process.versions.node,
            browser: typeof window !== 'undefined' && typeof document !== 'undefined',
            platform: hasProcess ? process.platform : 'browser'
        };
    }());

    /**
     * 64-byte aligned typed array. ArrayBuffer only -- Buffer does not exist in
     * a browser, and the same source has to run there.
     *
     * Backing stores do not land on a 64-byte boundary on their own (x86_64
     * Linux hands them back at addr % 64 == 32), which straddles a cache line
     * on every 512-bit load; research/gemm-node measured ~2x for exactly that.
     * So over-allocate and take a view at the next boundary. V8 allocates
     * ArrayBuffer backing stores off-heap and never relocates them, so an
     * address taken once stays valid for the life of the buffer.
     *
     * @param {Function} Ctor - typed array constructor
     * @param {number} n - element count
     * @param {Function} [addressOf] - provider hook returning a BigInt address
     * @returns {TypedArray}
     */
    function aligned(Ctor, n, addressOf)
    {
        const bytes = n * Ctor.BYTES_PER_ELEMENT;
        if (!addressOf) return new Ctor(new ArrayBuffer(bytes));

        const ab = new ArrayBuffer(bytes + ALIGN);
        const base = Number(addressOf(new Uint8Array(ab)) % BigInt(ALIGN));
        return new Ctor(ab, (ALIGN - base) % ALIGN, n);
    }

    // ─── Providers ──────────────────────────────────────────────
    // A provider is { id, kind, detail, matmul(m,n,k,A,lda,B,ldb,C,ldc) }.
    // Nothing above this layer knows which one it got.

    /**
     * Portable reference matmul. Correct everywhere, fast nowhere. This is the
     * browser path until a WASM-SIMD provider sits beside it, and it is also
     * the oracle every other provider is checked against.
     */
    const JS_PROVIDER = {
        id: 'js',
        kind: 'fp32',
        detail: 'portable JS triple loop',
        alloc: (Ctor, n) => aligned(Ctor, n, null),
        matmul(m, n, k, A, lda, B, ldb, C, ldc)
        {
            for (let i = 0; i < m; i++)
            {
                const arow = i * lda, crow = i * ldc;
                for (let j = 0; j < n; j++) C[crow + j] = 0;
                for (let p = 0; p < k; p++)
                {
                    const a = A[arow + p];
                    if (a === 0) continue;
                    const brow = p * ldb;
                    for (let j = 0; j < n; j++) C[crow + j] += a * B[brow + j];
                }
            }
        }
    };

    // One CBLAS ABI, three vendors. Accelerate is why Mac needs no separate
    // code path; MKL is why int8/VNNI/AMX need no C.
    const BLAS_CANDIDATES = [
        // Linux
        'libmkl_rt.so.2', 'libmkl_rt.so', 'libopenblas.so.0', 'libopenblas.so',
        'libblas.so.3',
        // Mac
        '/System/Library/Frameworks/Accelerate.framework/Versions/A/Accelerate',
        'libblas.dylib', 'libopenblas.dylib'
    ];

    // ILP64 builds (numpy/scipy wheels) prefix scipy_ and suffix 64_; MKL,
    // Accelerate and distro OpenBLAS use the plain names with 32-bit ints.
    const SGEMM_VARIANTS = [
        { sym: 'cblas_sgemm',          int: 'int'   },
        { sym: 'scipy_cblas_sgemm64_', int: 'int64' },
        { sym: 'cblas_sgemm64_',       int: 'int64' }
    ];

    /**
     * Bind a CBLAS sgemm out of whatever shared library the host already has.
     * Returns null rather than throwing when there is nothing to bind -- a
     * browser has no FFI and that is an ordinary outcome, not an error.
     *
     * @param {string[]} [extraPaths] - searched before the built-in candidates
     * @returns {Object|null} provider
     */
    function makeBlasProvider(extraPaths)
    {
        if (!HOST.node) return null;

        let koffi = null;
        try { koffi = require('koffi'); } catch (e) { return null; }

        const paths = (extraPaths || [])
            .concat(typeof process !== 'undefined' && process.env.BLAS_SO
                ? [process.env.BLAS_SO] : [])
            .concat(BLAS_CANDIDATES);

        for (const path of paths)
        {
            let lib = null;
            try { lib = koffi.load(path); } catch (e) { continue; }

            for (const v of SGEMM_VARIANTS)
            {
                const I = v.int;
                let fn = null;
                try
                {
                    fn = lib.func(`void ${v.sym}(${I},${I},${I},${I},${I},${I},`
                        + `float,float*,${I},float*,${I},float,_Inout_ float*,${I})`);
                }
                catch (e) { continue; }

                const addressOf = p => koffi.address(p);
                return {
                    id: 'blas',
                    kind: 'fp32',
                    detail: `${v.sym} (${I}) in ${path}`,
                    library: path,
                    alloc: (Ctor, n) => aligned(Ctor, n, addressOf),
                    matmul(m, n, k, A, lda, B, ldb, C, ldc)
                    {
                        // A normal matmul. Nothing clever, on purpose.
                        fn(ROW_MAJOR, NO_TRANS, NO_TRANS, m, n, k,
                           1.0, A, lda, B, ldb, 0.0, C, ldc);
                    }
                };
            }
        }
        return null;
    }

    /**
     * @param {Object} [opts] - { provider, libraries }
     * @returns {Object[]} every provider usable on this host, best first
     */
    function detectProviders(opts)
    {
        const found = [];
        const blas = makeBlasProvider(opts && opts.libraries);
        if (blas) found.push(blas);
        found.push(JS_PROVIDER);
        return found;
    }

    // ─── Core ───────────────────────────────────────────────────

    /**
     * The engine. Holds a provider and a command table; every op is a method
     * named `op_<name>`, which is what makes an op addable by mixin.
     */
    class ComputeCore
    {
        constructor(opts)
        {
            opts = opts || {};
            const available = detectProviders(opts);
            const picked = opts.provider
                ? available.find(p => p.id === opts.provider)
                : available[0];

            if (!picked)
            {
                throw new Error(`CPE: no provider "${opts.provider}" on this host`
                    + ` (have: ${available.map(p => p.id).join(', ')})`);
            }

            this.provider = picked;
            this.available = available;
            this.options = opts;
        }

        /**
         * The single entry point.
         * @param {Object|string} cmd - { op, ... }, or an op name alone
         * @returns {*} whatever the op returns
         */
        run(cmd)
        {
            if (typeof cmd === 'string') cmd = { op: cmd };
            if (!cmd || typeof cmd.op !== 'string')
            {
                throw new Error('CPE.run(cmd): cmd needs an { op } string');
            }

            const handler = this['op_' + cmd.op];
            if (typeof handler !== 'function')
            {
                throw new Error(`CPE.run(): unknown op "${cmd.op}" -- have: `
                    + this.ops().join(', '));
            }
            return handler.call(this, cmd);
        }

        /** @returns {string[]} every op this instance currently answers to */
        ops()
        {
            const out = new Set();
            for (let o = this; o && o !== Object.prototype; o = Object.getPrototypeOf(o))
            {
                for (const k of Object.getOwnPropertyNames(o))
                {
                    if (k.startsWith('op_')) out.add(k.slice(3));
                }
            }
            return Array.from(out).sort();
        }

        /** Allocate through the provider so alignment matches its ABI. */
        alloc(Ctor, n) { return this.provider.alloc(Ctor, n); }

        /**
         * A reusable scratch buffer of at least `n` elements. Grows, never
         * shrinks. The size check is the point: one engine serves many shapes,
         * and a buffer kept from a smaller one is a silent overflow.
         * @param {string} key
         * @param {number} n
         * @returns {Float32Array}
         */
        _scratch(key, n)
        {
            let buf = this[key];
            if (!buf || buf.length < n) buf = this[key] = this.alloc(Float32Array, n);
            return buf;
        }

        // ─── Ops ────────────────────────────────────────────────

        /** @returns {Object} what this host can do */
        op_caps()
        {
            return {
                version: VERSION,
                host: HOST,
                provider: this.provider.id,
                detail: this.provider.detail,
                providers: this.available.map(p => ({ id: p.id, detail: p.detail })),
                ops: this.ops()
            };
        }

        /**
         * A normal matmul. C = A*B, row-major, no transpose.
         * This is the ONLY primitive -- see the file header.
         * @param {Object} cmd - { m, n, k, A, B, C, lda, ldb, ldc }
         */
        op_matmul(cmd)
        {
            const { m, n, k, A, B } = cmd;
            const lda = cmd.lda || k, ldb = cmd.ldb || n, ldc = cmd.ldc || n;
            const C = cmd.C || this.alloc(Float32Array, m * ldc);
            this.provider.matmul(m, n, k, A, lda, B, ldb, C, ldc);
            return C;
        }
    }

    // ─── Mixins ─────────────────────────────────────────────────
    // Ops that are not core. Each is a plain object with a mixinId, which is
    // all ExtendX.extend() requires.

    /**
     * The routed/MoE diagonal. Y[b] = X[b] * W[route[b]].
     *
     * A dense implementation evaluates every expert for every token and
     * discards (E-1)/E of it. This evaluates only the diagonal of the
     * (token x expert) grid. The saving is E, and none of it comes from a
     * clever kernel -- the engine still only ever sees a normal matmul.
     */
    const RoutedMixin = {
        mixinId: 'cpe.routed',

        /**
         * Group token indices by expert. This grouping IS the diagonal.
         * @param {Int32Array|number[]} route - expert index per token
         * @param {number} E - expert count
         * @returns {Int32Array[]} rows owned by each expert
         */
        rowsByExpert(route, E)
        {
            const counts = new Int32Array(E);
            for (let b = 0; b < route.length; b++) counts[route[b]]++;

            const rowsOf = new Array(E);
            for (let e = 0; e < E; e++) rowsOf[e] = new Int32Array(counts[e]);

            const fill = new Int32Array(E);
            for (let b = 0; b < route.length; b++)
            {
                const e = route[b];
                rowsOf[e][fill[e]++] = b;
            }
            return rowsOf;
        },

        /**
         * @param {Object} cmd - { X, W (array of E), route, B, K, N, E, Y? }
         * @returns {TypedArray} Y
         */
        op_routed(cmd)
        {
            const { X, W, route, B, K, N, E } = cmd;
            const Y = cmd.Y || this.alloc(Float32Array, B * N);

            const rowsOf = this.rowsByExpert(route, E);

            // One scratch buffer for all experts, not one per expert: the
            // gather is contiguous across them. Cached between calls, but the
            // cache is sized -- an engine is reused across shapes, and a
            // buffer kept from a smaller shape silently overflows the gather.
            const gathered = this._scratch('_gather', B * K);
            const out = this._scratch('_out', B * N);

            let off = 0;
            for (let e = 0; e < E; e++)
            {
                const rows = rowsOf[e];
                if (rows.length === 0) continue;

                for (let r = 0; r < rows.length; r++)
                {
                    gathered.set(X.subarray(rows[r] * K, rows[r] * K + K), (off + r) * K);
                }

                // ── and here it is just a normal matmul ──
                this.run({
                    op: 'matmul',
                    m: rows.length, n: N, k: K,
                    A: gathered.subarray(off * K, (off + rows.length) * K),
                    B: W[e],
                    C: out.subarray(off * N, (off + rows.length) * N)
                });

                for (let r = 0; r < rows.length; r++)
                {
                    Y.set(out.subarray((off + r) * N, (off + r) * N + N), rows[r] * N);
                }
                off += rows.length;
            }
            return Y;
        },

        /**
         * The dense path, kept so the routed path can be checked against it
         * rather than trusted. Evaluates every expert for every token.
         */
        op_dense(cmd)
        {
            const { X, W, route, B, K, N, E } = cmd;
            const Y = cmd.Y || this.alloc(Float32Array, B * N);
            const scratch = this._scratch('_dscratch', B * N);

            for (let e = 0; e < E; e++)
            {
                this.run({ op: 'matmul', m: B, n: N, k: K, A: X, B: W[e], C: scratch });
                for (let b = 0; b < B; b++)
                {
                    if (route[b] === e) Y.set(scratch.subarray(b * N, b * N + N), b * N);
                }
            }
            return Y;
        }
    };

    /**
     * Timing, and the block-height sweep that decides which provider to use
     * for a given shape. Separate from the ops so a deployment that does not
     * benchmark does not carry it.
     */
    const BenchMixin = {
        mixinId: 'cpe.bench',

        _now()
        {
            if (typeof performance === 'object' && performance
                && typeof performance.now === 'function') return performance.now() / 1000;
            return Date.now() / 1000;
        },

        /**
         * @param {Object} cmd - { fn, reps }
         * @returns {number} best wall-clock seconds over reps
         */
        op_time(cmd)
        {
            const reps = cmd.reps || 5;
            cmd.fn();                                   // warm
            let best = Infinity;
            for (let r = 0; r < reps; r++)
            {
                const t0 = this._now();
                cmd.fn();
                const d = this._now() - t0;
                if (d < best) best = d;
            }
            return best;
        },

        /**
         * Routed against dense on the same data, verified before it is timed.
         * @param {Object} cmd - { B, K, N, E, reps }
         * @returns {Object} { dense, routed, speedup, maxRelErr, ok }
         */
        op_bench(cmd)
        {
            const B = cmd.B || 720, K = cmd.K || 512, N = cmd.N || 512;
            const E = cmd.E || 8, reps = cmd.reps || 5;

            const X = this.alloc(Float32Array, B * K);
            for (let i = 0; i < X.length; i++) X[i] = ((i * 37) % 1000) / 1000 - 0.5;

            const W = [];
            for (let e = 0; e < E; e++)
            {
                const w = this.alloc(Float32Array, K * N);
                for (let i = 0; i < w.length; i++) w[i] = ((i + e * 7919) % 997) / 997 - 0.5;
                W.push(w);
            }

            const route = new Int32Array(B);
            for (let b = 0; b < B; b++) route[b] = (b * 31 + 7) % E;

            const Yd = this.alloc(Float32Array, B * N);
            const Yr = this.alloc(Float32Array, B * N);
            const args = { X, W, route, B, K, N, E };

            const dense = () => this.run(Object.assign({ op: 'dense', Y: Yd }, args));
            const routed = () => this.run(Object.assign({ op: 'routed', Y: Yr }, args));

            const td = this.run({ op: 'time', fn: dense, reps });
            const tr = this.run({ op: 'time', fn: routed, reps });

            let worst = 0;
            for (let i = 0; i < B * N; i++)
            {
                const d = Math.abs(Yr[i] - Yd[i]);
                const s = Math.abs(Yd[i]) || 1;
                if (d / s > worst) worst = d / s;
            }

            const denseFlops = 2 * B * E * K * N;
            return {
                provider: this.provider.id,
                shape: { B, K, N, E, rowsPerExpert: B / E },
                dense_ms: td * 1000,
                routed_ms: tr * 1000,
                dense_gflops: denseFlops / td / 1e9,
                routed_equiv_gflops: denseFlops / tr / 1e9,
                speedup: td / tr,
                maxRelErr: worst,
                ok: worst < 1e-4
            };
        }
    };

    // ─── Composition ────────────────────────────────────────────

    const DEFAULT_MIXINS = [RoutedMixin, BenchMixin];
    const EXTRA_MIXINS = [];

    /**
     * Compose the core with the mixin set. Uses ExtendX when it is present,
     * which is what makes a layer runtime-toggleable; falls back to prototype
     * copying when it is not, so CPE still loads standalone in a browser that
     * has not pulled ExtendX in.
     *
     * @param {Object[]} mixins
     * @returns {Function} composed constructor
     */
    function compose(mixins)
    {
        if (ExtendX && typeof ExtendX.extend === 'function')
        {
            return ExtendX.extend(ComputeCore, ...mixins);
        }

        class Composed extends ComputeCore {}
        for (const m of mixins)
        {
            for (const key of Object.keys(m))
            {
                if (key === 'mixinId') continue;
                Composed.prototype[key] = m[key];
            }
        }
        return Composed;
    }

    const CPE = {
        get author() { return AUTHOR; },
        get company() { return COMPANY; },
        get version() { return VERSION; },
        get engineName() { return NAME; },

        Core: ComputeCore,
        mixins: { routed: RoutedMixin, bench: BenchMixin },

        /**
         * Register an additional op layer. This is the seam Quantum goes
         * through when it becomes mainline -- a mixin, not an edit here.
         * @param {Object} mixin - needs a stable string mixinId
         */
        use(mixin)
        {
            if (!mixin || typeof mixin.mixinId !== 'string')
            {
                throw new Error('CPE.use(): a layer needs a stable string mixinId');
            }
            if (!EXTRA_MIXINS.some(m => m.mixinId === mixin.mixinId))
            {
                EXTRA_MIXINS.push(mixin);
            }
            return CPE;
        },

        /**
         * @param {Object} [opts] - { provider, libraries, mixins }
         * @returns {ComputeCore} an engine with .run(cmd)
         */
        create(opts)
        {
            opts = opts || {};
            const mixins = (opts.mixins || DEFAULT_MIXINS).concat(EXTRA_MIXINS);
            const Composed = compose(mixins);
            return new Composed(opts);
        },

        /** Convenience: one-shot command against a default engine. */
        run(cmd, opts) { return CPE.create(opts).run(cmd); }
    };

    return CPE;
}));
