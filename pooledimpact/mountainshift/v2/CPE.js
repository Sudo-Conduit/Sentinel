/**
 * @file CPE.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Compute Processing Engine -- opaque closure factory over
 *              ComputeCore.js. The returned object exposes ONLY run(cmd).
 *
 *   Same shape as MountainShift.js, for the same reason. Everything a caller
 *   can reach goes through one gate:
 *
 *       const cpe = CPE();
 *       cpe.run({ op: 'routed', X, W, route, B, K, N, E });
 *
 *   Providers, mixins, the composed class, the scratch buffers and the FFI
 *   handle are all closure-local. They are not hidden behind a naming
 *   convention or a non-enumerable property -- they are genuinely
 *   unreachable from the returned object, which is a null-prototype frozen
 *   target with exactly one own property, wrapped in a full-trap Proxy.
 *
 *   Why one gate matters here specifically: a command is a plain object, so
 *   `{op, ...args}` is already serializable. That is what lets a provider be
 *   somewhere else -- a WebRTC peer on the LAN is not a new abstraction, it
 *   is the same run(cmd) with the matmul happening on another machine. It is
 *   also what makes orchestration and reporting uniform: one entry point to
 *   log, one place to time, one surface to authorize.
 *
 *   Extension happens at CONSTRUCTION, not on the instance. There is no
 *   use()/register() on the returned object, deliberately -- a surface that
 *   can be extended after the fact is a surface that can be extended by
 *   whoever got a reference to it. Pass layers in:
 *
 *       const cpe = CPE({ mixins: [routed, bench, QuantumMixin] });
 *
 *   The closure is per-call. Two CPE() calls share no state, so a page can
 *   hold one engine per peer, per device or per tenant without any of them
 *   being able to observe or disturb another.
 *
 * @tests test/CPE.opaque.test.js (black-box, through run() only)
 *        test/CPE.portability.test.js (white-box, over ComputeCore.js)
 * @see research/routed-gemm/README.md -- the measurements the design follows
 * @see research/CORE/9x8_Torus_003.md -- where the diagonal came from: a
 *      torus traversal by arbitrary jump vector, whose coverage is governed
 *      by the gcd of the step with the grid. The routed op is that same
 *      traversal with the jump vector made data-dependent (route[b]), and
 *      that release's Coverage Ratio is expert load balance.
 */
(function(root, factory)
{
    if (typeof define === 'function' && define.amd)
    {
        define(['./ComputeCore.js'], factory);
    }
    else if (typeof module === 'object' && module.exports)
    {
        module.exports = factory(require('./ComputeCore.js'));
    }
    else
    {
        root.CPE = factory(root.ComputeCore);
    }
}(typeof self !== 'undefined' ? self : this, function(ComputeCore)
{
    'use strict';

    if (!ComputeCore)
    {
        throw new Error('CPE requires ComputeCore to be loaded first');
    }

    /**
     * Build an engine and return an opaque handle to it.
     *
     * @param {Object} [options] - passed to ComputeCore.create():
     *   provider  {string}   force a provider id instead of taking the best
     *   libraries {string[]} extra shared-library paths to try before the
     *                        built-in candidates
     *   mixins    {Object[]} the op layers to compose; omit for the defaults
     * @returns {{run: Function}} an opaque, full-trap-Proxy-wrapped object
     *   exposing ONLY run()
     */
    function CPE(options)
    {
        // Closure-local and unreachable from the returned object. The engine
        // itself is never handed out, so neither is its provider, its FFI
        // handle, its scratch buffers, nor the composed class.
        const engine = ComputeCore.create(options || {});

        /**
         * The only gate.
         * @param {Object|string} cmd - { op, ... }, or an op name alone
         * @returns {*} whatever the op returns
         */
        function run(cmd)
        {
            return engine.run(cmd);
        }

        // ─── The opaque return value ────────────────────────────────
        //
        // Mirrors MountainShift.js deliberately rather than inventing a
        // second opacity idiom in the same codebase.
        //
        // target: null-prototype, so toString/hasOwnProperty/constructor are
        // genuinely ABSENT rather than merely shadowed; frozen, so nothing
        // can be added, removed or reconfigured; exactly one own property,
        // non-writable and non-configurable. The target is the real lock --
        // the Proxy below adds no hiding of its own and forwards every trap,
        // explicitly, so the behavior is a choice at each trap rather than an
        // accident of default Proxy semantics.
        const target = Object.create(null);
        Object.defineProperty(target, 'run', {
            value: run,
            writable: false,
            enumerable: true,
            configurable: false
        });
        Object.freeze(target);

        const handler = {
            get(t, prop, receiver) { return Reflect.get(t, prop, receiver); },
            set(t, prop, value) { return Reflect.set(t, prop, value); },
            has(t, prop) { return Reflect.has(t, prop); },
            deleteProperty(t, prop) { return Reflect.deleteProperty(t, prop); },
            ownKeys(t) { return Reflect.ownKeys(t); },
            getOwnPropertyDescriptor(t, prop) { return Reflect.getOwnPropertyDescriptor(t, prop); },
            defineProperty(t, prop, descriptor) { return Reflect.defineProperty(t, prop, descriptor); },
            getPrototypeOf(t) { return Reflect.getPrototypeOf(t); },
            setPrototypeOf(t, proto) { return Reflect.setPrototypeOf(t, proto); },
            isExtensible(t) { return Reflect.isExtensible(t); },
            preventExtensions(t) { return Reflect.preventExtensions(t); }
        };

        return new Proxy(target, handler);
    }

    CPE.author = 'Will Fobbs';
    CPE.version = '1.0.0';
    CPE.description = 'Opaque closure factory over the Compute Processing '
        + 'Engine -- the returned object exposes ONLY run().';

    return CPE;
}));
