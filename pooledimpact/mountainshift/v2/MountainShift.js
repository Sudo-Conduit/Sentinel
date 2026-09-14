/**
 * @file MountainShift.js
 * @author Will Fobbs
 * @version 1.1.0
 * @description E.1 (MSOS Cleanup Roadmap): the opaque closure factory.
 *   `MountainShift(options)` composes and boots the ALREADY-hardened
 *   chain -- Registry, BIOS (SecurityMixin + graph-mode StructureMixin),
 *   Kernel (same), Physical (same), CPU (SecurityMixin) -- wired exactly
 *   the way test/FullBootChain.lifecycle.test.js already proves it
 *   (BIOS.kernelFactory -> a secured Kernel, Physical.cpuFactory -> a
 *   secured CPU, a Registry attached so C.2's NVRAM fast path and C.4's
 *   first-boot distinction both apply automatically) -- entirely inside
 *   this function's own closure scope, then returns a single opaque
 *   object exposing ONLY `run()`. Memory.js is deliberately not required
 *   or wired in here: BIOS.boot() only ever picks one up via a bare
 *   global `Memory` lookup (never a constructor argument), a pre-existing
 *   BIOS.js behavior this file does not change -- exactly the same "ends
 *   up null" state test/FullBootChain.lifecycle.test.js and
 *   test/BIOS.security.test.js already run under and accept.
 *
 *   "The closure only has run()" is not a metaphor: every internal
 *   instance (registry/bios/physical/kernel and whatever CPU/Memory they
 *   construct) lives ONLY as a variable captured by this function's
 *   closure -- never assigned to any property of the returned object,
 *   never leaked to a module-level or global variable. That is the real,
 *   load-bearing opacity mechanism; a plain JS closure is fundamentally
 *   unreachable from outside the function that created it, full stop, no
 *   Proxy trickery required for that part.
 *
 *   The full-trap Proxy wrapped around the returned object is deliberate
 *   defense-in-depth on top of that, not a substitute for it: every
 *   single Proxy trap is explicitly defined (never left to JS's implicit
 *   default-forwarding behavior), each one forwarding to the equivalent
 *   Reflect operation against a target that is itself frozen and
 *   null-prototype with exactly one non-configurable, non-writable
 *   property (`run`). Because the target already IS the fully locked-down
 *   shape we want, every trap's forwarded Reflect call automatically
 *   satisfies the Proxy invariants and returns exactly the answer a
 *   caller should see -- there is no special-cased "hide everything else"
 *   branch to get subtly wrong, because there is nothing else on the
 *   target to hide. A future maintenance change that widened the
 *   target's shape without also updating this handler would still only
 *   ever expose what the target itself really has -- the explicit,
 *   full-trap handler exists so that fact is an auditable, deliberate
 *   choice at every trap, not an accident of Proxy default behavior.
 *
 *   Exists specifically because of DevTools Local Overrides' own
 *   constraint (the source thread this whole roadmap grew out of): a
 *   file injected that way runs directly in a real page's global scope,
 *   offline, with zero user interaction -- exposing raw BIOS/Kernel class
 *   internals there (the way MSOS-Injector.js's eval'd globals currently
 *   do) makes MSOS trivially inspectable/tamperable from that page's own
 *   DevTools console. This factory is what a Local Overrides payload
 *   should actually hand back to the page instead. Rewiring
 *   MSOS-Injector.js (E.3) to inject and call this factory instead of
 *   eval'ing raw class source is a real follow-on, deliberately NOT done
 *   here -- E.1's own scope is the factory itself, proven opaque and
 *   functionally correct in isolation first.
 *
 *   run() is idempotent: real firmware's "power on" does nothing
 *   meaningful if the machine is already running, and re-running BIOS.
 *   boot() a second time would double-construct a Kernel/Memory/CPU
 *   under a machine that already has one. The first call's outcome is
 *   cached and returned again by any later call.
 *
 *   v1.1.0: run() now resolves to a small CAPABILITY object instead of a
 *   bare boolean -- `{ ok: true, bootedFrom, cores, fork, kill, tick, ps,
 *   getMemory }`. This is E.2's own anticipated evolution ("once run()'s
 *   own surface grows past a bare boolean"), driven by real need: wiring
 *   the actual Terminal app (entry.html/PosixCommands.js/Procd.js) onto
 *   this factory required giving it something to actually DO real work
 *   with. The exact method set is not a guess -- grepped from the real,
 *   currently-shipping Terminal source: entry.html's own boot sequence
 *   and top renderer use fork/tick/getMemory/cores; PosixCommands.js's
 *   ps/kill commands and Procd.js's attachKernel() usage need exactly
 *   ps/kill/fork/cores.
 *
 *   `ok` is (deliberately) not gated on `bootedFrom` -- confirmed live
 *   that BIOS.boot() ALWAYS produces a fully working Kernel whether or
 *   not a real boot device was found (fork()/tick()/ps() all work
 *   normally on a 'none'-booted Kernel; real hardware hands off to
 *   whatever OS it has regardless of which device it found). An earlier
 *   draft of this version gated `ok` on `bootedFrom !== 'none'`, which
 *   would have made run() report failure for exactly the Terminal's own
 *   real deployment shape (no fs/iso configured, so bootedFrom is always
 *   'none') and abort a boot that actually succeeds -- caught by tracing
 *   the real call path before shipping, not assumed safe. `ok` now
 *   simply reflects "run() got a real kernel back"; a genuine failure
 *   (a broken dependency inside boot() itself throwing) propagates as an
 *   ordinary rejected promise, matching how every other failure in this
 *   codebase's boot chain is signaled -- not a parallel sentinel value
 *   invented on top of that convention. `bootedFrom` is exposed as plain
 *   informational status, the same string the real Kernel carries.
 *
 *   Each capability is a closure bound to the REAL secured Kernel --
 *   calling `caps.fork(cmd, ppid)` really does dispatch through
 *   SecurityMixin/ExtendX exactly like calling kernel.fork() directly
 *   would. What never happens, still: the Kernel instance itself, BIOS,
 *   Physical, and Registry remain unreachable through the capability
 *   object -- only these entry points exist, frozen, nothing else. The
 *   OUTER returned object's own contract is completely unchanged by
 *   this -- it is still, and only ever, `{ run }`.
 *
 *   options.onBoot (test/diagnostic only): an optional callback invoked
 *   from INSIDE this closure, synchronously after boot() settles, with
 *   the real internal instances (registry, bios, physical, kernel) --
 *   NEVER exposed through the returned opaque object. Only code that
 *   holds a reference to THIS SPECIFIC MountainShift(options) call can
 *   ever supply or receive it; a page script that merely holds the
 *   returned object (`const os = MountainShift(); os.run();`) has no way
 *   to reach it. This is what test/MountainShift.opaque.test.js uses to
 *   verify a real boot actually happened without breaking opacity for
 *   every other caller.
 * @docs Kernel-Machine-Architecture.md
 * @tests test/MountainShift.opaque.test.js
 */
(function(root, factory)
{
    if (typeof define === 'function' && define.amd)
    {
        define(['./BaseClassX.js', './ExtendX.js', './SecurityMixin.js', './StructureMixin.js', './CPU.js', './Physical.js', './Kernel.js', './BIOS.js', './Registry.js'], factory);
    }
    else if (typeof module === 'object' && module.exports)
    {
        module.exports = factory(
            require('./BaseClassX.js'),
            require('./ExtendX.js'),
            require('./SecurityMixin.js'),
            require('./StructureMixin.js'),
            require('./CPU.js'),
            require('./Physical.js'),
            require('./Kernel.js'),
            require('./BIOS.js'),
            require('./Registry.js')
        );
    }
    else
    {
        root.MountainShift = factory(root.BaseClassX, root.ExtendX, root.SecurityMixin, root.StructureMixin, root.CPU, root.Physical, root.Kernel, root.BIOS, root.Registry);
    }
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, ExtendX, SecurityMixin, StructureMixin, CPU, Physical, Kernel, BIOS, Registry)
{
    'use strict';
    if (!BaseClassX || !ExtendX)
    {
        throw new Error('MountainShift requires BaseClassX.js and ExtendX.js to be loaded first');
    }

    const { createSecurityMixin } = SecurityMixin;
    const { createStructureMixin } = StructureMixin;

    // Composed ONCE at module scope, matching test/FullBootChain.lifecycle.
    // test.js's own established pattern exactly -- createSecurityMixin(CPU)
    // mints a STABLE mixinId per class ('security:CPU', etc.), so calling it
    // again inside MountainShift()'s own function body (once per factory
    // CALL, not once per module load) would try to re-register that same id
    // with a DIFFERENT mixin object on every second-and-later call, which
    // ExtendX.extend()'s own collision guard correctly rejects. One secured
    // class family is reused across every MountainShift() invocation; each
    // call constructs fresh INSTANCES of it, never fresh classes.
    const SecuredCPU = ExtendX.extend(CPU, createSecurityMixin(CPU));
    const SecuredPhysical = ExtendX.extend(Physical, createSecurityMixin(Physical), createStructureMixin(Physical, { mode: 'graph' }));
    const SecuredKernel = ExtendX.extend(Kernel, createSecurityMixin(Kernel), createStructureMixin(Kernel, { mode: 'graph' }));
    const SecuredBIOS = ExtendX.extend(BIOS, createSecurityMixin(BIOS), createStructureMixin(BIOS, { mode: 'graph' }));

    /**
     * The opaque closure factory. Every internal instance this creates
     * lives only in this function's own closure -- see this file's header
     * comment for why that (not the Proxy below) is the real opacity
     * mechanism.
     * @param {Object} [options={}]
     * @param {number} [options.capacityMHz=2600] - Physical's clock speed
     * @param {number} [options.ramBytes=0x10000] - Physical's RAM size
     * @param {string[]} [options.bootDeviceOrder] - passed to BIOS via Registry
     * @param {string} [options.firmwareType] - passed to BIOS via Registry
     * @param {Object} [options.fs] - filesystem-shaped boot-entry lookup, forwarded to BIOS.boot()
     * @param {Object} [options.iso] - an ISO to install/boot from as a last resort, forwarded to BIOS.boot()
     * @param {Function} [options.onBoot] - test/diagnostic hook, see header comment; NEVER exposed via the returned object
     * @returns {{run: Function}} an opaque, full-trap-Proxy-wrapped object exposing ONLY run()
     */
    function MountainShift(options)
    {
        const opts = options || {};

        const registry = new Registry({
            entries: {
                bootDeviceOrder: opts.bootDeviceOrder || ['esp', 'disk', 'network'],
                firmwareType: opts.firmwareType || 'UEFI',
                secureBoot: false,
                firstBootComplete: false
            }
        });

        const bios = new SecuredBIOS({ kernelFactory: (kOpts) => new SecuredKernel(kOpts) });
        bios.attachRegistry(registry);

        const physical = new SecuredPhysical({
            capacityMHz: opts.capacityMHz || 2600,
            ramBytes: opts.ramBytes || 0x10000,
            cpuFactory: (memBytes) => new SecuredCPU({ memorySize: memBytes })
        });

        let hasRun = false;
        let cachedResult = null;

        async function run()
        {
            if (hasRun)
            {
                return cachedResult;
            }
            hasRun = true;
            // BIOS.boot() ALWAYS produces a working Kernel, whether or not a
            // real boot device was found -- bootedFrom:'none' is informational
            // status, not a failure signal (confirmed live: fork()/tick()/ps()
            // all work normally on a 'none'-booted Kernel; real hardware hands
            // off to its OS the same way regardless of which device it found).
            // ok therefore reflects "did run() get a real kernel back" -- true
            // in every normal case; a genuine failure (a broken dependency
            // inside boot() itself throwing) propagates as an ordinary
            // rejected promise, matching how every other failure in this
            // codebase's boot chain is signaled (ISO.verifyIntegrity() throws,
            // Installer.install() throws, etc.) -- not a parallel {ok:false}
            // sentinel invented on top of that convention.
            const kernel = await bios.boot(physical, opts.fs, opts.iso);
            cachedResult = Object.freeze({
                ok: true,
                bootedFrom: kernel.bootedFrom,
                cores: kernel.cores,
                fork: (cmd, ppid) => kernel.fork(cmd, ppid),
                kill: (pid) => kernel.kill(pid),
                tick: () => kernel.tick(),
                ps: () => kernel.ps(),
                getMemory: () => (typeof kernel.getMemory === 'function' ? kernel.getMemory() : null)
            });
            if (typeof opts.onBoot === 'function')
            {
                opts.onBoot({ registry, bios, physical, kernel });
            }
            return cachedResult;
        }

        // ─── The opaque return value ────────────────────────────────
        //
        // target: null-prototype (no inherited Object.prototype methods --
        // toString/hasOwnProperty/constructor are all genuinely ABSENT, not
        // just hidden), frozen (no property can be added/removed/
        // reconfigured), with exactly one non-configurable, non-writable
        // own property. This target IS the fully locked-down shape on its
        // own -- the Proxy below adds no additional hiding logic beyond
        // forwarding to it, deliberately, trap by trap.
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

    MountainShift.author = 'Will Fobbs';
    MountainShift.version = '1.1.0';
    MountainShift.description = 'Opaque closure factory over the hardened MSOS boot chain -- the returned object exposes ONLY run().';
    MountainShift.docs = ['Kernel-Machine-Architecture.md'];
    MountainShift.tests = ['test/MountainShift.opaque.test.js'];

    return MountainShift;
}));
