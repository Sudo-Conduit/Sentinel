/**
 * @file Shell.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description The Shell.wasm command engine (ShellHost.js/JobTable.js/
 *   ProcessTable.js), wrapped the way MountainShift.js wraps the BIOS/
 *   Kernel/CPU boot chain: a plain, ExtendX-composable class (`class
 *   Shell`, never exported directly -- see below) instantiated inside an
 *   opaque factory function's closure, which returns bound capability
 *   methods instead of the instance itself.
 *
 *   Why a class at all, when ShellHost.createShell() already returns a
 *   working {run, runDetailed} object: ExtendX.extend() composes mixins
 *   onto a class's PROTOTYPE methods (SecurityMixin.js/PreflightMixin.js
 *   both introspect BaseClass.prototype by name) -- a bag of closures has
 *   no prototype to introspect, so it cannot be composed with. `class
 *   Shell` exists specifically to give exec()/ps()/jobs()/fg()/bg()/
 *   kill() a real, named prototype surface those mixins can wrap. This
 *   file does not reimplement any of ShellHost.js's actual command
 *   logic -- every Shell method is a thin call into the SAME already-
 *   tested engine (test/Shell.wasm.test.js, test/Curl.wasm.test.js,
 *   test/Spawn.wasm.test.js, test/JobControl.test.js all still exercise
 *   it directly and are unaffected by this file's existence).
 *
 *   Not a BaseClassX subclass, matching CPU.js's own precedent exactly
 *   (see CPU.js's header): this is a runtime engine -- real sockets, real
 *   child processes, real WASM instances -- not schema-tracked domain
 *   state worth fingerprinting/tracing the way ISO.js or a Kernel process
 *   record is.
 *
 *   Opacity, scoped down from MountainShift.js's full treatment: the real
 *   Shell instance lives ONLY in ShellFactory()'s closure, exactly like
 *   every internal instance in MountainShift.js's own closure -- a plain
 *   JS closure is unreachable from outside the function that created it,
 *   which is the real, load-bearing mechanism either file relies on.
 *   MountainShift.js ALSO wraps its return value in a full-trap Proxy, as
 *   deliberate defense-in-depth against a SPECIFIC threat model named in
 *   its own header: a DevTools Local Overrides payload running directly
 *   in a real page's global scope, where raw class internals would be
 *   trivially inspectable from that page's own console. Shell runs
 *   server-side (Node), not injected into a browser page that way, so
 *   that specific threat model doesn't apply here -- the Proxy layer is
 *   deliberately omitted rather than copied as decoration. If Shell is
 *   ever also loaded into a browser/DevTools-injectable context, revisit
 *   this decision rather than assuming it still holds.
 *
 *   Kernel integration (explicitly NOT done here -- see the file this
 *   answers, the "ISO vs. IIFE" design discussion): Shell.js has ZERO
 *   dependency on Kernel.js/BIOS.js/Registry.js, on purpose. Kernel.js's
 *   fork()/kill()/tick()/ps() are a SIMULATED CPU scheduler -- tick()
 *   actually advances a shared CPU.js instance's registers one fetch/
 *   decode/execute quantum at a time for each "process." Shell's jobs
 *   (a backgrounded `top` WASM tick-job, a real spawned node/php process)
 *   are not simulated CPU-bound programs; nothing about them could
 *   meaningfully run under Kernel's round-robin register-level tick().
 *   Wiring Shell.wasm's execution INTO Kernel's scheduler would be a
 *   category error, not an integration. What DOES make sense -- unified
 *   `ps` visibility, so a real Terminal's `ps` shows Shell's background
 *   jobs alongside Kernel's simulated ones -- is a bolt-on concern, not
 *   something Shell.js's own class body should know about: see
 *   KernelVisibilityMixin.js, built with PreflightMixin.js via this
 *   file's own composeMixins(Shell) hook (see ShellFactory() below),
 *   composed in only by a caller that actually has a real Kernel
 *   capability object. It mirrors a job START into kernel.fork() (for a
 *   unified process listing) but deliberately does NOT attempt to unify
 *   pid spaces or forward kill() bidirectionally in this first cut --
 *   Shell's own pid and the kernel-side bookkeeping pid for the same job
 *   are two different numbers until a deeper unification is designed and
 *   tested; documented here rather than silently half-done.
 *
 *   And ISO.js: an ISO, in this codebase, is an install-image file
 *   manifest + checksum (see ISO.js's own header) -- a boot-time DATA
 *   payload BIOS.boot() installs FROM, not a place runtime logic lives.
 *   "Should Shell's core logic be in ISO or the IIFE" doesn't parse as a
 *   real choice once ISO's actual job is this narrow: Shell's code is a
 *   peer runtime engine, exactly like MountainShift.js itself, CPU.js,
 *   Kernel.js -- never install-manifest data.
 *
 * @docs Kernel-Machine-Architecture.md
 * @tests test/Shell.opaque.test.js
 */
(function(root, factory)
{
    if (typeof define === 'function' && define.amd)
    {
        define(['./ShellHost.js'], factory);
    }
    else if (typeof module === 'object' && module.exports)
    {
        module.exports = factory(require('./ShellHost.js'));
    }
    else
    {
        root.Shell = factory(root.ShellHost);
    }
}(typeof self !== 'undefined' ? self : this, function(ShellHost)
{
    'use strict';
    if (!ShellHost || typeof ShellHost.createShell !== 'function')
    {
        throw new Error('Shell requires ShellHost.js (createShell) to be loaded first');
    }

    /**
     * The real engine class. Every method is a thin call into the SAME
     * ShellHost.js instance this class's constructor lazily boots and
     * caches -- see boot() below. Never exported directly; ShellFactory()
     * is the only thing that ever constructs one, and it lives only in
     * that function's closure.
     */
    class Shell
    {
        /** @param {Object} [options] - forwarded verbatim to ShellHost.createShell() */
        constructor(options)
        {
            this._options = options || {};
            this._hostPromise = null;
        }

        /**
         * Idempotent, cached boot -- same reasoning as MountainShift.js's
         * own run(): the underlying createShell() does real async work
         * (fetching/compiling shell.wasm), and a second caller should get
         * the SAME booted host, not a second one racing the first.
         * @returns {Promise<Object>} the underlying ShellHost instance
         */
        async boot()
        {
            if (!this._hostPromise)
            {
                this._hostPromise = ShellHost.createShell(this._options);
            }
            return this._hostPromise;
        }

        /**
         * Runs one command line and returns the full result. ps/jobs/fg/
         * bg/kill are not special-cased here at all -- they're ordinary
         * command lines ShellHost.js's own runDetailed() already
         * recognizes as builtins (see ShellHost.js's header); this method
         * doesn't need to know that.
         * @param {string} cmdline
         * @returns {Promise<{rc:number, stdout:string, cwd:string}>}
         */
        async exec(cmdline)
        {
            const host = await this.boot();
            return host.runDetailed(cmdline);
        }

        /** @param {string} cmdline @returns {Promise<string>} just the real stdout */
        async run(cmdline)
        {
            return (await this.exec(cmdline)).stdout;
        }

        /** @returns {Promise<string>} */
        async ps() { return (await this.exec('ps')).stdout; }

        /** @returns {Promise<string>} */
        async jobs() { return (await this.exec('jobs')).stdout; }

        /** @param {number} pid @returns {Promise<{rc:number, stdout:string, cwd:string}>} */
        async fg(pid) { return this.exec('fg ' + pid); }

        /** @param {number} pid @returns {Promise<{rc:number, stdout:string, cwd:string}>} */
        async bg(pid) { return this.exec('bg ' + pid); }

        /** @param {number} pid @returns {Promise<{rc:number, stdout:string, cwd:string}>} */
        async kill(pid) { return this.exec('kill ' + pid); }
    }

    /**
     * The opaque closure factory -- ShellFactory(options).boot() resolves
     * to a small capability object of bound closures over the real Shell
     * instance, which itself is never returned or otherwise reachable
     * from outside this function. See this file's header for why this
     * intentionally omits MountainShift.js's additional full-trap Proxy
     * layer (a different threat model this file doesn't share).
     * @param {Object} [options] - forwarded to `new Shell(options)`
     * @param {Function} [options.composeMixins] - (Shell) => Array<mixin>,
     *   called with the real (otherwise un-exported) Shell class so a
     *   caller can build mixins against its actual prototype -- e.g.
     *   PreflightMixin.createPreflightMixin(Shell, {...}) -- without this
     *   file ever exporting Shell itself. See createKernelVisibilityMixin.js
     *   for a real example (composeMixins: (Shell) => [createKernelVisibilityMixin(Shell, kernel)]).
     * @returns {{boot: () => Promise<{ok:boolean, exec:Function, run:Function, ps:Function, jobs:Function, fg:Function, bg:Function, kill:Function}>}}
     */
    function ShellFactory(options)
    {
        const opts = options || {};
        const ExtendX = opts.ExtendX || (typeof require === 'function' ? require('./ExtendX.js') : root.ExtendX);
        const mixins = typeof opts.composeMixins === 'function' ? opts.composeMixins(Shell) : null;
        const ComposedShell = (Array.isArray(mixins) && mixins.length > 0 && ExtendX)
            ? ExtendX.extend(Shell, ...mixins)
            : Shell;

        const shell = new ComposedShell(opts);

        let hasBooted = false;
        let cachedResult = null;

        async function boot()
        {
            if (hasBooted)
            {
                return cachedResult;
            }
            hasBooted = true;
            await shell.boot();
            cachedResult = Object.freeze({
                ok: true,
                exec: (cmdline) => shell.exec(cmdline),
                run: (cmdline) => shell.run(cmdline),
                ps: () => shell.ps(),
                jobs: () => shell.jobs(),
                fg: (pid) => shell.fg(pid),
                bg: (pid) => shell.bg(pid),
                kill: (pid) => shell.kill(pid)
            });
            return cachedResult;
        }

        return { boot };
    }

    ShellFactory.author = 'Will Fobbs';
    ShellFactory.version = '1.0.0';
    ShellFactory.description = 'Opaque closure factory over ShellHost.js\'s WASM command engine -- ExtendX-composable, capability-object surface, no Kernel dependency.';
    ShellFactory.docs = ['Kernel-Machine-Architecture.md'];
    ShellFactory.tests = ['test/Shell.opaque.test.js'];

    return ShellFactory;
}));
