// UMD IIFE - Analysis engine: the unified entry point for Analysis/Research,
// built as ExtendX-composed command mixins rather than one monolithic file.
//
// run(cmdName, input, io) is the one thing a UI (or a test) calls. io is
// { stdin, stdout, stderr, ref }:
//   - stdin/stdout/stderr: plain { write(str) } sinks (default no-ops so a
//     caller that doesn't care about output doesn't have to provide any).
//   - ref: a deliberately unshaped, extensible context object — who/what is
//     calling, under what scope. This module never reads its fields itself;
//     it only threads it through untouched so a cross-cutting mixin (ACL,
//     audit logging, rate limiting) can inspect it uniformly, without any
//     individual command needing to know ACL exists. AclMixin below is a
//     worked example of that, not a required dependency — commands are
//     usable with no ACL mixin composed in at all.
//
// Each capability (aromaticity, coordination, ionization) is its own mixin
// implementing ONE method matching its command name — these don't chain
// against each other (different names), they're just distinct methods
// ExtendX composes onto one engine. `run` itself IS a chainable extension
// point: a mixin that also implements `run` (like AclMixin) wraps the base
// dispatcher via next(), which is what makes ACL "just another mixin"
// instead of a fork of the dispatcher.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./ExtendX', './PDT', './CoordinationChemistry', './Aromaticity', './Smiles'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(
            require('./ExtendX.js'),
            require('./PDT.js'),
            require('./CoordinationChemistry.js'),
            require('./Aromaticity.js'),
            require('./Smiles.js')
        );
    } else {
        root.Analysis = factory(root.ExtendX, root.PDT, root.CoordinationChemistry, root.Aromaticity, root.Smiles);
    }
}(typeof self !== 'undefined' ? self : this, function(ExtendX, PDT, CoordinationChemistry, Aromaticity, Smiles) {
    'use strict';
    if (!ExtendX) throw new Error('Analysis requires ExtendX');

    function noopSink() { return { write: function() {} }; }

    // The base class every command mixin composes onto. Its own `run` is
    // the innermost link in the chain — always reachable via next(), never
    // itself calling next() (nothing is below it).
    function BaseAnalysisEngine() {}
    BaseAnalysisEngine.prototype.run = function(cmdName, input, io) {
        io = io || {};
        var stdout = io.stdout || noopSink();
        var stderr = io.stderr || noopSink();
        var ref = io.ref || {};
        if (typeof this[cmdName] !== 'function') {
            var msg = 'Unknown command: "' + cmdName + '"';
            stderr.write(msg + '\n');
            return { code: 127, error: msg };
        }
        return this[cmdName](input, { stdin: io.stdin, stdout: stdout, stderr: stderr, ref: ref });
    };

    // ─── Command mixins ─────────────────────────────────────────────────
    // Each wraps an already-validated module; no new chemistry logic here,
    // only the command surface (name, input shape, stdout reporting).

    var AromaticityCommand = {
        mixinId: 'aromaticity',
        // input: { system: {atoms, bonds, planar}, options?: {betaModel} }
        aromaticity: function(input, io) {
            if (!Aromaticity) return { code: 1, error: 'Aromaticity module not available' };
            var result = Aromaticity.analyze(input.system, input.options);
            io.stdout.write(JSON.stringify(result) + '\n');
            return result;
        }
    };

    var CoordinationCommand = {
        mixinId: 'coordination',
        // input: { formula: 'C34H32FeN4O4', options?: {betaModel} }
        coordination: function(input, io) {
            if (!CoordinationChemistry) return { code: 1, error: 'CoordinationChemistry module not available' };
            var result = CoordinationChemistry.analyze(input.formula, input.options);
            io.stdout.write(JSON.stringify(result) + '\n');
            return result;
        }
    };

    var IonizationCommand = {
        mixinId: 'ionization',
        // input: { Z: 26, step: 1 }
        ionization: function(input, io) {
            if (!PDT) return { code: 1, error: 'PDT module not available' };
            var result = PDT.ionizationAnalysis(input.Z, input.step);
            io.stdout.write(JSON.stringify(result) + '\n');
            return result;
        }
    };

    // ─── Extensibility worked example: ACL as a composable layer ───────
    // Gates the GENERIC dispatcher (run), not any individual command, by
    // inspecting io.ref — which this module never otherwise looks at.
    // Deliberately not composed into DefaultAnalysisEngine below (ACL
    // policy is a deployment decision, not a default), but built and
    // smoke-tested here so the extensibility point is proven, not just
    // asserted. allowFn: (ref, cmdName) -> boolean.
    function makeAclMixin(allowFn) {
        return {
            mixinId: 'acl',
            run: function(cmdName, input, io, next) {
                var ref = (io && io.ref) || {};
                if (!allowFn(ref, cmdName)) {
                    var msg = 'Permission denied: ref=' + JSON.stringify(ref) + ' cannot run "' + cmdName + '"';
                    if (io && io.stderr) io.stderr.write(msg + '\n');
                    return { code: 403, error: msg };
                }
                return next(cmdName, input, io);
            }
        };
    }

    var DefaultAnalysisEngine = ExtendX.extend(BaseAnalysisEngine, AromaticityCommand, CoordinationCommand, IonizationCommand);

    return {
        BaseAnalysisEngine: BaseAnalysisEngine,
        AromaticityCommand: AromaticityCommand,
        CoordinationCommand: CoordinationCommand,
        IonizationCommand: IonizationCommand,
        makeAclMixin: makeAclMixin,
        DefaultAnalysisEngine: DefaultAnalysisEngine,
        create: function() { return new DefaultAnalysisEngine(); },
        version: '0.1'
    };
}));
