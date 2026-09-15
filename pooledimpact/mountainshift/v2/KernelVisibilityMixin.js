/**
 * @file KernelVisibilityMixin.js
 * @description The concrete answer to "should Shell's core logic live in
 *   the Kernel/ISO boot chain, or stay a peer IIFE": stay a peer IIFE
 *   (see Shell.js's own header for the full reasoning -- Kernel.js's
 *   tick() is a simulated CPU register-level scheduler, categorically
 *   the wrong place to run Shell's real sockets/processes/WASM
 *   instances), but bolt on a THIN visibility bridge so a real Terminal's
 *   `ps` can show Shell's background jobs alongside Kernel's simulated
 *   ones, without Shell.js itself ever needing to know Kernel exists.
 *
 *   Built entirely from PreflightMixin.js's `after` hook -- no new
 *   composition mechanism, just this project's own preflight/postflight
 *   mixin shape pointed at a real integration need. Wraps ONLY Shell's
 *   `exec` method: after a REAL call returns (never before -- this mixin
 *   never vetoes or rewrites anything Shell does, it only observes), if
 *   the command line ended in `&` and Shell's own "[pid] pid\n"
 *   background-start ack is present in the result, it also calls
 *   kernel.fork(cmdline) so the SAME job shows up in the real Kernel's
 *   ps() too.
 *
 *   Explicitly, deliberately NOT done here (first cut -- a real gap, not
 *   an oversight): Shell's own pid and the pid kernel.fork() mints for
 *   the SAME job are two different numbers. Real unification (one shared
 *   pid space) would mean threading a pid allocator through both
 *   ProcessTable.js and Kernel.js, which is a bigger, separate change --
 *   this mixin buys unified LISTING today without pretending to buy
 *   unified ADDRESSING. `kill` is not forwarded to kernel.kill() for the
 *   same reason: this mixin has no reliable way to know which kernel pid
 *   corresponds to which Shell pid without that shared allocator.
 * @tests test/KernelVisibilityMixin.test.js
 */
(function(root, factory)
{
    if (typeof define === 'function' && define.amd)
    {
        define(['./PreflightMixin.js'], factory);
    }
    else if (typeof module === 'object' && module.exports)
    {
        module.exports = factory(require('./PreflightMixin.js'));
    }
    else
    {
        root.KernelVisibilityMixin = factory(root.PreflightMixin);
    }
}(typeof self !== 'undefined' ? self : this, function(PreflightMixin)
{
    'use strict';
    if (!PreflightMixin)
    {
        throw new Error('KernelVisibilityMixin requires PreflightMixin.js to be loaded first');
    }

    /**
     * @param {Function} Shell - the real Shell class (from Shell.js's
     *   composeMixins(Shell) hook -- Shell.js never exports this class
     *   directly, so this factory only ever receives it there)
     * @param {{fork: Function}} kernel - a real Kernel capability object
     *   (e.g. MountainShift's own run()-resolved `caps.fork`)
     * @returns {Object} an ExtendX-composable mixin
     */
    function createKernelVisibilityMixin(Shell, kernel)
    {
        if (!kernel || typeof kernel.fork !== 'function')
        {
            throw new Error('createKernelVisibilityMixin(): kernel must expose a real fork(cmd) -- see MountainShift.js\'s own run()-resolved capability object');
        }

        return PreflightMixin.createPreflightMixin(Shell, {
            mixinId: 'kernelVisibility:Shell',
            only: ['exec'],
            after(ctx)
            {
                const cmdline = String(ctx.args[0] || '').trim();
                if (!cmdline.endsWith('&')) return;
                if (!ctx.result || typeof ctx.result.stdout !== 'string') return;
                if (!/^\[\d+\]\s+\d+\n$/.test(ctx.result.stdout)) return; // only Shell's own background-start ack

                const realCmdline = cmdline.slice(0, -1).trim();
                kernel.fork(realCmdline);
                // Deliberately not returning anything -- this mixin only
                // ever observes; ctx.result passes through unchanged.
            }
        });
    }

    return {
        createKernelVisibilityMixin: createKernelVisibilityMixin,
        name: 'KernelVisibilityMixin',
        description: 'Mirrors Shell background-job starts into a real Kernel\'s fork() for unified ps listing -- listing only, not pid-space unification. See file header.',
        tests: ['test/KernelVisibilityMixin.test.js']
    };
}));
