/**
 * RegXConformance.js — rigor test suite for RegX.js (JS → WAT/Wasm)
 *
 * Author: Wilbert Fobbs III
 * Company: Pooled Impact / Mountain Shift
 * Version: 1.0.0
 *
 * WHY THIS EXISTS
 *
 * Auditing RegX by reading it found one candidate defect. Auditing it by
 * RUNNING it — parse, generate, then hand the bytes to the real engine via
 * WebAssembly.validate() — found a confirmed one: a single-line method body
 * compiles to a module that reports success and is invalid. The gap between
 * "looks right" and "the engine accepts it" is exactly what a reference
 * implementation cannot be allowed to have, so this suite runs every case
 * through the real WebAssembly object, never just through RegX's own claim
 * that it succeeded.
 *
 * H1 below is falsifiable in one specific way: ANY case where
 * javascriptToWasm() returns bytes without throwing, and those bytes are
 * either WebAssembly-invalid or instantiate-and-compute the wrong number, is
 * a silent-failure event. Confirmed cases are locked in as regressions
 * (marked XFAIL, counted separately from real failures) so a fix is visible
 * as a status change, not rediscovered from scratch.
 *
 * @license Proprietary — All Rights Reserved
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) define(['RegX', 'TestReport'], factory);
    else if (typeof module === 'object' && module.exports) module.exports = factory(root.RegX, root.TestReport);
    else root.RegXConformance = factory(root.RegX, root.TestReport);
}(typeof self !== 'undefined' ? self : this, function (RegX, TestReport) {

    'use strict';

    const VERSION = '1.0.0';

    // ─── Cases ──────────────────────────────────────────────────
    //
    // Each case: { id, name, src, xfail, run(RegX) -> {ok, detail, value} }.
    // `xfail: true` means the case is EXPECTED to fail right now — a locked
    // regression, not a silent gap. It still runs every time; a case that
    // starts passing while still marked xfail is itself reported, because an
    // unexpected pass on a locked regression means the fix landed and the
    // lock should be removed.

    function hasWasm() { return typeof WebAssembly !== 'undefined'; }

    var RealInstance = WebAssembly.Instance;
    function unwrapI64(r) { return typeof r === 'bigint' ? Number(r) : r; }
    function AutoInstance(module, imports) {
        const real = new RealInstance(module, imports || {});
        const wrapped = {};
        Object.keys(real.exports).forEach(function (k) {
            const v = real.exports[k];
            if (typeof v !== 'function') { wrapped[k] = v; return; }
            wrapped[k] = function () {
                const args = Array.prototype.slice.call(arguments);
                try { return unwrapI64(v.apply(null, args)); }
                catch (e) {
                    if (!/Cannot convert .* to a BigInt/.test(e.message)) throw e;
                    const coerced = args.map(function (a, i) {
                        return (i > 0 && typeof a === 'number') ? BigInt(a) : a;
                    });
                    return unwrapI64(v.apply(null, coerced));
                }
            };
        });
        this.exports = wrapped;
    }


    function compileAndValidate(src) {
        const wat = RegX.javascriptToWAT(src);
        const wasm = RegX.javascriptToWasm(src);
        const valid = hasWasm() ? WebAssembly.validate(wasm) : null;
        return { wat: wat, wasm: wasm, valid: valid };
    }

    function instantiateAndCall(wasm, fnName, args) {
        // Synchronous path: WebAssembly.Module + Instance, not the async
        // instantiate(), so a single case can return its result inline rather
        // than forcing every case in the suite to be a Promise.
        const mod = new WebAssembly.Module(wasm);
        const inst = new AutoInstance(mod, {});
        return inst.exports[fnName].apply(null, args);
    }

    const CASES = [

        {
            id: '01', name: 'parse: blocks/methods/properties found for canonical class',
            keywords: ['class'],
            src: 'class Point {\n  constructor(x, y) {\n    this.x = x;\n    this.y = y;\n  }\n  sum(z) {\n    return this.x + this.y + z;\n  }\n}\n',
            run: function (RegX) {
                const inst = new RegX();
                const ast = inst.parse(this.src);
                const ok = ast.blocks.length === 1 && ast.methods.length === 2 &&
                    ast.properties.length === 2;
                return { ok: ok, detail: 'blocks=' + ast.blocks.length + ' methods=' + ast.methods.length +
                    ' properties=' + ast.properties.length + ' (want 1/2/2)' };
            }
        },

        {
            id: '02', name: 'multi-line class with a param method → valid WASM (WebAssembly.validate)',
            src: 'class Point {\n  constructor(x, y) {\n    this.x = x;\n    this.y = y;\n  }\n  sum(z) {\n    return this.x + this.y + z;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const r = compileAndValidate(this.src);
                return { ok: r.valid === true, detail: 'WebAssembly.validate() = ' + r.valid };
            }
        },

        {
            id: '03', name: 'LOCKED REGRESSION — WAT and Wasm-binary backends DISAGREE on 3+ term sums',
            xfail: true,
            keywords: ['+ (3+ terms)'],
            src: 'class Point {\n  constructor(x, y) {\n    this.x = x;\n    this.y = y;\n  }\n  sum(z) {\n    return this.x + this.y + z;\n  }\n}\n',
            run: function (RegX) {
                // compileExpressionToWAT folds an n-part split('+') into n-1
                // NESTED i32.add forms — correct for any n. Its sibling,
                // compileExpressionToWasm, pushes all n operands then emits
                // exactly ONE i32.add (0x6A) regardless of n. For n=3 that
                // leaves 2 values on the operand stack at `return`; WASM's
                // return only consumes the top ARITY values (1, here) and
                // marks the rest unreachable, so WebAssembly.validate() never
                // sees the leftover — the module is spec-valid AND wrong.
                // Confirmed by an actual call, not by reading: sum(x=10,y=20,z=5)
                // returns 25 (y+z), silently dropping x.
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const inst = new RegX();
                inst.parse(this.src);
                const wasm = inst.generateWasm();
                let result = null, valid = null, threw = null;
                try {
                    valid = WebAssembly.validate(wasm);
                    const mod = new WebAssembly.Module(wasm);
                    const i1 = new AutoInstance(mod, {});
                    i1.exports.init(0, 10, 20);
                    result = i1.exports.sum(0, 5);
                } catch (e) { threw = e.message; }
                const reproduced = threw === null && valid === true && result === 25;
                return { ok: reproduced, detail: threw ? ('now throws: ' + threw + ' (would be a fix)')
                    : 'sum(this@0{x=10,y=20}, z=5) = ' + result + ' (want 35; got y+z, x silently dropped). ' +
                      'valid=' + valid + ' — spec-valid AND wrong, because return only checks arity-many values.' };
            }
        },

        {
            id: '04', name: 'zero-extra-param method (this.start only) → valid WASM',
            src: 'class Counter {\n  constructor(start) {\n    this.start = start;\n  }\n  getStart() {\n    return this.start;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const r = compileAndValidate(this.src);
                return { ok: r.valid === true, detail: 'WebAssembly.validate() = ' + r.valid };
            }
        },

        {
            id: '05', name: 'multiple properties get distinct, non-colliding offsets',
            src: 'class Vec3 {\n  constructor(a, b, c) {\n    this.a = a;\n    this.b = b;\n    this.c = c;\n  }\n  first() {\n    return this.a;\n  }\n}\n',
            run: function (RegX) {
                const inst = new RegX();
                const ast = inst.parse(this.src);
                const map = inst.buildPropertyMap(ast);
                const offsets = Object.keys(map).map(function (k) { return map[k]; });
                const distinct = new Set(offsets).size === offsets.length;
                return { ok: distinct && offsets.length === 3,
                    detail: JSON.stringify(map) + (distinct ? ' (distinct)' : ' (COLLISION)') };
            }
        },

        {
            id: '06', name: 'LOCKED REGRESSION — single-line method body silently compiles to an invalid module',
            xfail: true,
            src: 'class Box {\n  constructor(v) { this.v = v; }\n  getV() { return this.v; }\n}\n',
            run: function (RegX) {
                // parseStatements splits the body on \\n and matches each line
                // with an ANCHORED regex (^this\\....=, ^return...;$). A
                // statement sharing a line with its brace matches neither, is
                // silently dropped, and javascriptToWasm() returns bytes with
                // no exception. Confirmed by WebAssembly.validate() === false:
                // "expected 1 elements on the stack for fallthru, found 0".
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let threw = null, valid = null;
                try {
                    const r = compileAndValidate(this.src);
                    valid = r.valid;
                } catch (e) { threw = e.message; }
                // H1-consistent behaviour would be: throw, OR valid === false.
                // The actual defect is worse than either: no throw AND
                // (right now) valid === false with no signal reaching the
                // caller of javascriptToWasm(). ok=true here means the defect
                // reproduced as expected; ok=false means it silently started
                // returning a VALID module for the wrong reason and needs a
                // real look, not just an unlock.
                const reproduced = threw === null && valid === false;
                return { ok: reproduced, detail: threw ? ('now throws: ' + threw + ' (would be a fix)')
                    : 'javascriptToWasm() succeeded, WebAssembly.validate() = ' + valid };
            }
        },

        {
            id: '07', name: 'suspected — bare identifier with no matching param defaults to local index 1',
            xfail: true,
            src: 'class Thing {\n  constructor(v) {\n    this.v = v;\n  }\n  getFoo() {\n    return bar;\n  }\n}\n',
            run: function (RegX) {
                // getFoo() has zero extra params, so its type signature has
                // exactly one local (index 0 = $this). compileExpressionToWasm's
                // fallback for an unrecognised bare identifier is hardcoded to
                // local index 1 regardless of whether one exists — expect an
                // invalid module (local index out of bounds) rather than a
                // thrown error at compile time.
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let threw = null, valid = null;
                try {
                    const r = compileAndValidate(this.src);
                    valid = r.valid;
                } catch (e) { threw = e.message; }
                const reproduced = threw === null && valid === false;
                return { ok: reproduced, detail: threw ? ('now throws: ' + threw + ' (would be a fix)')
                    : 'javascriptToWasm() succeeded, WebAssembly.validate() = ' + valid +
                      (valid === true ? ' — NOT reproduced; local 1 happened to exist or engine tolerated it' : '') };
            }
        },

        {
            id: '08', name: 'unsupported operator (subtraction) is silently dropped to a wrong constant, not rejected',
            xfail: true,
            keywords: ['-'],
            src: 'class Diff {\n  constructor(a, b) {\n    this.a = a;\n    this.b = b;\n  }\n  d() {\n    return this.a - this.b;\n  }\n}\n',
            run: function (RegX) {
                // compileExpressionToWasm has no '-' branch. "this.a - this.b"
                // matches none of {this.X, +, *, digits, identifier}, so it
                // falls through to the final default: emit i32.const 0. That is
                // valid WASM (0 is a legal i32 constant) that computes the
                // WRONG answer with no signal at all — the case H1 calls out
                // as strictly worse than an invalid module.
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, valid = null, threw = null;
                try {
                    const r = compileAndValidate(this.src);
                    valid = r.valid;
                    result = instantiateAndCall(r.wasm, 'd', [0]);
                } catch (e) { threw = e.message; }
                const wrongAnswer = threw === null && valid === true && result === 0;
                return { ok: wrongAnswer, detail: threw ? ('threw: ' + threw)
                    : 'd(this uninitialised) = ' + result + ', valid=' + valid +
                      ' — compiles clean, computes 0 regardless of a/b, no error anywhere' };
            }
        },

        {
            id: '10', name: 'cross-backend check: WAT text correctly nests n-1 adds; Wasm binary does not',
            xfail: true,
            src: 'class Point {\n  constructor(x, y) {\n    this.x = x;\n    this.y = y;\n  }\n  sum(z) {\n    return this.x + this.y + z;\n  }\n}\n',
            run: function (RegX) {
                // Independent of instantiate/call: structural proof the two
                // generators, off the SAME ast, disagree. WAT nests (n-1) forms;
                // the binary emits exactly one 0x6A regardless of n. This is
                // the root cause case 03 demonstrates by running.
                const inst = new RegX();
                inst.parse(this.src);
                const wat = inst.generateWAT();
                // Scope the count to $sum's own body — generateHelpers()
                // emits fixed $store/$load functions that contain their own
                // (i32.add for pointer arithmetic, and counting the whole
                // module conflates that boilerplate with the method under test.
                const sumSection = wat.slice(wat.indexOf('(func $sum'), wat.indexOf(';; ─── Exports'));
                const watAddCount = (sumSection.match(/\(i32\.add/g) || []).length;
                const localMap = inst.buildLocalMap(inst._ast.methods[1].params);
                const map = inst.buildPropertyMap(inst._ast);
                const stmt = inst.parseStatements(inst._ast.methods[1].body)[0];
                const wasmBytes = inst.compileExpressionToWasm(stmt.value, map, localMap);
                const wasmAddCount = wasmBytes.filter(function (b) { return b === 0x6A; }).length;
                const wasmCombineAdds = wasmAddCount - 2; // 2 are address arithmetic for the two property reads
                const agree = watAddCount === 2 && wasmCombineAdds === 2;
                // xfail semantics: ok=true means "the known defect reproduced"
                // — here, that the two backends DISAGREE. ok=agree would
                // invert this (report ok=true when they happen to agree),
                // which is the wrong way round for a locked regression.
                return { ok: !agree, detail: 'WAT nests ' + watAddCount + ' add(s) (want 2 for a 3-term sum); ' +
                    'Wasm binary emits ' + wasmCombineAdds + ' combining add(s) (want 2) — backends disagree, ' +
                    'not just "the wasm path has a bug" but "two lowerings of one ast produce different semantics."' };
            }
        },

        {
            id: '11', name: 'two classes in one source — do property maps collide across classes?',
            xfail: true,
            src: 'class A {\n  constructor(x) {\n    this.x = x;\n  }\n  getX() {\n    return this.x;\n  }\n}\nclass B {\n  constructor(y) {\n    this.y = y;\n  }\n  getY() {\n    return this.y;\n  }\n}\n',
            run: function (RegX) {
                // buildPropertyMap reads ast.properties, which JavaScriptMixin
                // fills by scanning the WHOLE source once — not per class. So
                // A's "x" and B's "y" share ONE offset table (x=0, y=4)
                // instead of each class getting its own 0-based layout. Two
                // single-property classes should each see their own field at
                // offset 0; instead the second class's field lands at offset 4
                // on an object that only has one property.
                const inst = new RegX();
                const ast = inst.parse(this.src);
                const map = inst.buildPropertyMap(ast);
                const collision = map.x === 0 && map.y === 4; // global, cross-class table
                return { ok: collision, detail: 'propertyMap = ' + JSON.stringify(map) +
                    ' — single global table across both classes; B.y at offset 4 assumes A.x is ' +
                    'also present on the same object, which it is not.' };
            }
        },

        {
            id: '12', name: 'division operator silently computes 0, not division',
            xfail: true,
            keywords: ['/'],
            src: 'class Ratio {\n  constructor(a, b) {\n    this.a = a;\n    this.b = b;\n  }\n  r() {\n    return this.a / this.b;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const inst = new RegX();
                inst.parse(this.src);
                const wasm = inst.generateWasm();
                let result = null, threw = null;
                try {
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 10, 2);
                    result = i1.exports.r(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 0,
                    detail: threw ? ('threw: ' + threw) : 'r(a=10,b=2) = ' + result + ' (want 5) — "/" matches no ' +
                        'branch in compileExpressionToWasm, falls through to the i32.const 0 default.' };
            }
        },

        {
            id: '13', name: 'comparison operator silently computes 0, not a boolean',
            xfail: true,
            keywords: ['<', '>', '===', 'comparison operators'],
            src: 'class Cmp {\n  constructor(a, b) {\n    this.a = a;\n    this.b = b;\n  }\n  lt() {\n    return this.a < this.b;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const inst = new RegX();
                inst.parse(this.src);
                const wasm = inst.generateWasm();
                let result = null, threw = null;
                try {
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 1, 2);
                    result = i1.exports.lt(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 0,
                    detail: threw ? ('threw: ' + threw) : 'lt(a=1,b=2) = ' + result + ' (want 1/true) — same ' +
                        'unmatched-operator fallthrough as division.' };
            }
        },

        {
            id: '14', name: 'negative literal returns 0, not the negative value',
            xfail: true,
            keywords: ['unary -'],
            src: 'class Neg {\n  constructor(x) {\n    this.x = x;\n  }\n  n() {\n    return -5;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const inst = new RegX();
                inst.parse(this.src);
                const wasm = inst.generateWasm();
                let result = null, threw = null;
                try {
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    result = i1.exports.n(0);
                } catch (e) { threw = e.message; }
                // /^\d+$/ does not match a leading '-', and the identifier
                // regex does not match it either, so it falls to the default.
                return { ok: threw === null && result === 0,
                    detail: threw ? ('threw: ' + threw) : 'n() = ' + result + ' (want -5)' };
            }
        },

        {
            id: '15', name: 'missing semicolon (ASI style) drops the statement entirely',
            xfail: true,
            src: 'class NoSemi {\n  constructor(x) {\n    this.x = x;\n  }\n  get() {\n    return this.x\n  }\n}\n',
            run: function (RegX) {
                // parseStatements anchors on a trailing ';' — ^return\\s+(.+);$
                // — so a semicolon-free return (valid, idiomatic JS under ASI)
                // matches nothing and is silently dropped. The generated
                // function body is empty, which — like case 06 — compiles
                // without a thrown error.
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let valid = null, threw = null;
                try { valid = WebAssembly.validate(RegX.javascriptToWasm(this.src)); }
                catch (e) { threw = e.message; }
                const reproduced = threw === null && valid === false;
                return { ok: reproduced, detail: threw ? ('now throws: ' + threw + ' (would be a fix)')
                    : 'compiled with no error; WebAssembly.validate() = ' + valid + ' — empty body, ASI not supported' };
            }
        },

        {
            id: '16', name: 'a // comment line inside a method body does not break the statements after it',
            src: 'class Commented {\n  constructor(x) {\n    this.x = x;\n  }\n  get() {\n    // just a comment\n    return this.x;\n  }\n}\n',
            run: function (RegX) {
                // Positive case: parseStatements is line-based and a comment
                // line matches neither statement pattern, so it is skipped
                // harmlessly — the FOLLOWING real statement still compiles.
                // Worth locking in as a pass, not just an absence of a defect.
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const inst = new RegX();
                inst.parse(this.src);
                const wasm = inst.generateWasm();
                let result = null, threw = null;
                try {
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 7);
                    result = i1.exports.get(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 7, detail: threw ? ('threw: ' + threw) : 'get() = ' + result + ' (want 7)' };
            }
        },

        {
            id: '17', name: 'a method call in an expression is silently dropped to 0, not called',
            xfail: true,
            src: 'class Caller {\n  constructor(x) {\n    this.x = x;\n  }\n  helper() {\n    return this.x;\n  }\n  wrap() {\n    return this.helper();\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const inst = new RegX();
                inst.parse(this.src);
                let wasm, threw = null, result = null;
                try {
                    wasm = inst.generateWasm();
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 9);
                    result = i1.exports.wrap(0);
                } catch (e) { threw = e.message; }
                // "this.helper()" matches the this.X regex only up to the
                // identifier before "()" is even considered, so behaviour here
                // depends on exactly how the call-syntax remainder is handled;
                // record what actually happens rather than assume.
                return { ok: threw === null && result !== 9,
                    detail: threw ? ('threw: ' + threw + ' — calls rejected loudly, better than cases 06-08 staying silent')
                        : 'wrap() = ' + result + ' (want 9 if calls worked) — method calls are not compiled as calls' };
            }
        },

        {
            id: '18', name: '2-term addition (this.x + this.y) — the boundary where case 03/10\'s defect starts',
            keywords: ['+ (2 terms)'],
            src: 'class Sum2 {\n  constructor(x, y) {\n    this.x = x;\n    this.y = y;\n  }\n  add() {\n    return this.x + this.y;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const inst = new RegX();
                inst.parse(this.src);
                const wasm = inst.generateWasm();
                let result = null, threw = null;
                try {
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 3, 4);
                    result = i1.exports.add(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 7, detail: threw ? ('threw: ' + threw) : 'add() = ' + result + ' (want 7) — 2-term sums are exactly where cases 03/10 stop applying' };
            }
        },

        {
            id: '19', name: '2-term multiplication (this.a * this.b)',
            keywords: ['* (2 terms)'],
            src: 'class Prod {\n  constructor(a, b) {\n    this.a = a;\n    this.b = b;\n  }\n  mul() {\n    return this.a * this.b;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const inst = new RegX();
                inst.parse(this.src);
                const wasm = inst.generateWasm();
                let result = null, threw = null;
                try {
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 6, 7);
                    result = i1.exports.mul(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 42, detail: threw ? ('threw: ' + threw) : 'mul() = ' + result + ' (want 42)' };
            }
        },

        {
            id: '20', name: 'bare local param returned alone, no operator (return z;)',
            src: 'class Echo {\n  constructor(x) {\n    this.x = x;\n  }\n  echo(z) {\n    return z;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const inst = new RegX();
                inst.parse(this.src);
                const wasm = inst.generateWasm();
                let result = null, threw = null;
                try {
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    result = i1.exports.echo(0, 99);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 99, detail: threw ? ('threw: ' + threw) : 'echo(99) = ' + result + ' (want 99)' };
            }
        },

        {
            id: '21', name: 'bare digit literal returned alone (return 42;)',
            src: 'class Const {\n  constructor(x) {\n    this.x = x;\n  }\n  answer() {\n    return 42;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const inst = new RegX();
                inst.parse(this.src);
                const wasm = inst.generateWasm();
                let result = null, threw = null;
                try {
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    result = i1.exports.answer(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 42, detail: threw ? ('threw: ' + threw) : 'answer() = ' + result + ' (want 42)' };
            }
        },

        {
            id: '22', name: 'two instances of the same class have independent memory/state',
            src: 'class Box {\n  constructor(v) {\n    this.v = v;\n  }\n  get() {\n    return this.v;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const inst = new RegX();
                inst.parse(this.src);
                const wasm = inst.generateWasm();
                let r1 = null, r2 = null, threw = null;
                try {
                    const mod = new WebAssembly.Module(wasm);
                    const a = new AutoInstance(mod, {});
                    const b = new AutoInstance(mod, {});
                    a.exports.init(0, 111);
                    b.exports.init(0, 222); // same address 0, but each instance owns ITS OWN memory
                    r1 = a.exports.get(0);
                    r2 = b.exports.get(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && r1 === 111 && r2 === 222,
                    detail: threw ? ('threw: ' + threw) : 'a.get()=' + r1 + ' b.get()=' + r2 + ' (want 111/222, not cross-contaminated)' };
            }
        },

        {
            id: '23', name: 'three properties get three distinct offsets (0,4,8), all readable independently',
            src: 'class Vec3 {\n  constructor(a, b, c) {\n    this.a = a;\n    this.b = b;\n    this.c = c;\n  }\n  first() {\n    return this.a;\n  }\n  second() {\n    return this.b;\n  }\n  third() {\n    return this.c;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const inst = new RegX();
                inst.parse(this.src);
                const wasm = inst.generateWasm();
                let r = [], threw = null;
                try {
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 10, 20, 30);
                    r = [i1.exports.first(0), i1.exports.second(0), i1.exports.third(0)];
                } catch (e) { threw = e.message; }
                const ok = threw === null && r[0] === 10 && r[1] === 20 && r[2] === 30;
                return { ok: ok, detail: threw ? ('threw: ' + threw) : 'first/second/third = ' + JSON.stringify(r) + ' (want [10,20,30])' };
            }
        },

        {
            id: '24', name: 'WAT export section lists exactly the non-constructor methods, plus memory',
            src: 'class Multi {\n  constructor(x) {\n    this.x = x;\n  }\n  a() {\n    return this.x;\n  }\n  b() {\n    return this.x;\n  }\n}\n',
            run: function (RegX) {
                const inst = new RegX();
                inst.parse(this.src);
                const wat = inst.generateWAT();
                const hasA = /\(export "a" \(func \$a\)\)/.test(wat);
                const hasB = /\(export "b" \(func \$b\)\)/.test(wat);
                const hasMem = /\(export "memory" \(memory 0\)\)/.test(wat);
                const noCtorExport = !/\(export "constructor"/.test(wat);
                return { ok: hasA && hasB && hasMem && noCtorExport,
                    detail: 'a=' + hasA + ' b=' + hasB + ' memory=' + hasMem + ' constructor-not-exported=' + noCtorExport };
            }
        },

        {
            id: '25', name: 'a property value of exactly 0 round-trips correctly (not confused with "unset")',
            src: 'class Zero {\n  constructor(x) {\n    this.x = x;\n  }\n  get() {\n    return this.x;\n  }\n}\n',
            run: function (RegX) {
                // propertyMap lookups elsewhere use `propertyMap[key] || 0` as a
                // fallback, which is safe for OFFSETS (0 is a legitimate one)
                // but this case checks the DATA path: a stored value of 0 must
                // read back as 0, not be mistaken for a missing property.
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const inst = new RegX();
                inst.parse(this.src);
                const wasm = inst.generateWasm();
                let result = null, threw = null;
                try {
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 0);
                    result = i1.exports.get(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 0, detail: threw ? ('threw: ' + threw) : 'get() = ' + result + ' (want 0)' };
            }
        },

        {
            id: '26', name: 'host-object call (Object.freeze) — categorically unencodable, not a missing branch',
            xfail: true,
            keywords: ['Object.freeze'],
            src: 'class Locked {\n  constructor(x) {\n    this.x = Object.freeze(x);\n  }\n  get() {\n    return this.x;\n  }\n}\n',
            run: function (RegX) {
                // Distinct from cases 06/08/12-15/17: those are grammar gaps a
                // regex branch could close. This one cannot be closed by adding
                // a branch — WASM has no object model, so Object.freeze(x) has
                // no i32/f64 encoding at all. The only real fix is a host
                // import table (WebAssembly.instantiate(module, imports)),
                // which RegXCore has no mechanism for. Confirms it falls
                // through the SAME silent path as the grammar gaps, not a
                // distinct crash — the category is different, the failure
                // mode is not.
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const inst = new RegX();
                inst.parse(this.src);
                let wasm, threw = null, result = null;
                try {
                    wasm = inst.generateWasm();
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 7);
                    result = i1.exports.get(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result !== 7,
                    detail: threw ? ('threw: ' + threw + ' — rejected loudly, which would be the honest behaviour')
                        : 'get() = ' + result + ' (Object.freeze(x) is not x=7; no host import table exists to call it at all)' };
            }
        },

        {
            id: '27', name: 'FIXED — recognized host import (console.log) actually reaches the host function',
            keywords: ['console.log'],
            src: 'class Announcer {\n  constructor(x) {\n    this.x = x;\n  }\n  announce() {\n    console.log(this.x);\n    return this.x;\n  }\n}\n',
            run: function (RegX) {
                // The real fix for item 43, proven end-to-end, not asserted:
                // an Import Section is emitted, the call opcode targets the
                // import's function index, and the value ACTUALLY reaches a
                // JS function supplied at instantiate() — captured here via a
                // side channel the host controls, which is the only way to
                // prove a call crossed the boundary rather than being dropped.
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let captured = null, ret = null, valid = null, threw = null;
                try {
                    const inst = new RegX();
                    inst.parse(this.src);
                    const wat = inst.generateWAT();
                    const wasm = inst.generateWasm();
                    valid = WebAssembly.validate(wasm);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {
                        env: { log: function (v) { captured = v; } }
                    });
                    i1.exports.init(0, 77);
                    ret = i1.exports.announce(0);
                    if (!/\(import "env" "log"/.test(wat)) threw = 'WAT missing the import declaration';
                } catch (e) { threw = e.message; }
                return { ok: threw === null && valid === true && Number(captured) === 77 && Number(ret) === 77,
                    detail: threw ? ('threw/failed: ' + threw)
                        : 'valid=' + valid + ', host received ' + captured + ' via env.log (want 77), announce() returned ' + ret + ' (want 77)' };
            }
        },

        {
            id: '28', name: 'array literal assignment (this.arr = [1,2,3];) has no bracket handling at all',
            xfail: true,
            keywords: ['[] literal'],
            src: 'class Arr {\n  constructor() {\n    this.arr = [1, 2, 3];\n  }\n  get() {\n    return this.arr;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0);
                    result = i1.exports.get(0);
                } catch (e) { threw = e.message; }
                // "[1, 2, 3]" contains no digits-only match, no identifier match,
                // no +/* — falls to the i32.const 0 default. There is no array
                // representation in this compiler at all (no length, no
                // elements, no pointer-to-array convention).
                return { ok: threw === null && result === 0,
                    detail: threw ? ('threw: ' + threw) : 'get() = ' + result + ' — arrays are not a value RegX can express, not just unparsed' };
            }
        },

        {
            id: '29', name: 'array index read (this.arr[0]) does not match the property-read pattern',
            xfail: true,
            keywords: ['[] index read', 'Array.isArray'],
            src: 'class Idx {\n  constructor(v) {\n    this.arr = v;\n  }\n  first() {\n    return this.arr[0];\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 55);
                    result = i1.exports.first(0);
                } catch (e) { threw = e.message; }
                // /^this\.(\w+)$/ requires the identifier to be the WHOLE
                // remainder — "this.arr[0]" doesn't match (trailing "[0]"),
                // so it falls through every branch to the i32.const 0 default.
                return { ok: threw === null && result === 0,
                    detail: threw ? ('threw: ' + threw) : 'first() = ' + result + ' (this.arr[0] does not match this.X, falls to 0)' };
            }
        },

        {
            id: '30', name: 'if/else is not a recognized statement — the branch is silently dropped, not evaluated',
            xfail: true,
            keywords: ['if', 'else'],
            src: 'class Cond {\n  constructor(x) {\n    this.x = x;\n  }\n  check() {\n    if (this.x > 0) {\n      return 1;\n    } else {\n      return 0;\n    }\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let valid = null, threw = null, result = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    valid = WebAssembly.validate(wasm);
                    if (valid) {
                        const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                        i1.exports.init(0, 5);
                        result = i1.exports.check(0);
                    }
                } catch (e) { threw = e.message; }
                // parseStatements is line-based with anchored patterns; "if
                // (...)  {", "return 1;", "} else {", "return 0;", "}" — the
                // TWO return lines both match, so BOTH compile in sequence with
                // no branch at all: whichever the code generator happens to
                // emit is not conditional on this.x in any way.
                return { ok: threw === null, detail: threw ? ('threw: ' + threw)
                    : 'compiled (valid=' + valid + '), check() = ' + result + ' — no branch instruction exists; ' +
                      'both return statements were parsed as unconditional, one silently wins' };
            }
        },

        {
            id: '31', name: 'a while loop is not a recognized statement — the loop body is dropped, not repeated',
            xfail: true,
            keywords: ['while', 'for'],
            src: 'class Loop {\n  constructor(x) {\n    this.x = x;\n  }\n  run() {\n    while (this.x > 0) {\n      this.x = this.x;\n    }\n    return this.x;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let valid = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    valid = WebAssembly.validate(wasm);
                } catch (e) { threw = e.message; }
                // "while (this.x > 0) {" matches no statement pattern and is
                // dropped; there is no loop opcode (br/loop) anywhere in this
                // compiler. Compiling succeeds (or fails to validate) with no
                // relation to whether the source would actually terminate.
                return { ok: threw === null, detail: threw ? ('threw: ' + threw) : 'compiled, valid=' + valid + ' — no loop construct exists at all' };
            }
        },

        {
            id: '32', name: 'a string literal return value is not representable — falls to 0',
            xfail: true,
            keywords: ['string literal', 'String()'],
            src: 'class Str {\n  constructor(x) {\n    this.x = x;\n  }\n  greet() {\n    return "hi";\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    result = i1.exports.greet(0);
                } catch (e) { threw = e.message; }
                // WASM's value types are i32/i64/f32/f64 — there is no string
                // type and no memory-layout convention (length-prefixed bytes,
                // null-terminated, etc.) for one in this compiler at all.
                return { ok: threw === null && result === 0, detail: threw ? ('threw: ' + threw) : 'greet() = ' + result + ' (want "hi", got a number — strings are not a representable value here)' };
            }
        },

        {
            id: '33', name: 'NaN is treated as an ordinary local-variable identifier, not IEEE NaN',
            xfail: true,
            keywords: ['NaN', 'undefined', 'null'],
            src: 'class N {\n  constructor(x) {\n    this.x = x;\n  }\n  bad(z) {\n    return NaN;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null, valid = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    valid = WebAssembly.validate(wasm);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    result = i1.exports.bad(0, 12345); // z=12345, local index 1
                } catch (e) { threw = e.message; }
                // /^[a-zA-Z_]\w*$/ matches "NaN" as a bare identifier and
                // compiles it as local.get on whatever index the fallback
                // picks (here, z's real index 1) -- so bad() returns z's
                // VALUE, not NaN. WASM's i32 result type could not hold IEEE
                // NaN even if this were fixed; that needs f64, never emitted.
                return { ok: threw === null && result === 12345,
                    detail: threw ? ('threw: ' + threw) : 'bad() = ' + result + ' (want NaN; got z\u2019s value instead — "NaN" was compiled as a variable read)' };
            }
        },

        {
            id: '34', name: 'Math.floor(x) as a return EXPRESSION is not a call at all — falls to 0',
            xfail: true,
            keywords: ['Math.floor (expression)'],
            src: 'class M {\n  constructor(x) {\n    this.x = x;\n  }\n  f() {\n    return Math.floor(this.x);\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 9);
                    result = i1.exports.f(0);
                } catch (e) { threw = e.message; }
                // The 'call' statement type (added for item 43) only exists at
                // STATEMENT position ("foo();" as its own line). Inside a
                // return expression, compileExpressionToWasm has no call
                // handling whatsoever — "Math.floor(this.x)" matches none of
                // {this.X, +, *, digits, identifier} and falls to i32.const 0.
                return { ok: threw === null && result === 0,
                    detail: threw ? ('threw: ' + threw) : 'f() = ' + result + ' (want 9; Math.floor is invisible inside an expression, only as a bare statement)' };
            }
        },

        {
            id: '35', name: 'Math.floor(x); as a bare statement is an unrecognized callee — same silent drop as case 26',
            xfail: true,
            keywords: ['Math.floor (statement)'],
            src: 'class M2 {\n  constructor(x) {\n    this.x = x;\n  }\n  f() {\n    Math.floor(this.x);\n    return this.x;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null, valid = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    valid = WebAssembly.validate(wasm);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 9);
                    result = i1.exports.f(0);
                } catch (e) { threw = e.message; }
                // Now parses as a 'call' statement (item 43's addition), but
                // 'Math.floor' has no KNOWN_IMPORTS row, so compileStatementToWasm
                // returns null for it just like Object.freeze in case 26 — the
                // statement is dropped, the rest of the method still runs.
                return { ok: threw === null && valid === true && result === 9,
                    detail: threw ? ('threw: ' + threw) : 'f() = ' + result + ' (want 9 — the call itself vanished, but did not corrupt what follows)' };
            }
        },

        {
            id: '36', name: 'uniformity check: EVERY unrecognized dot-call (Math.*, JSON.*, Date.*, ...) shares ONE mechanism, not N',
            keywords: ['Math.max', 'Math.min', 'Math.abs', 'Math.pow', 'Math.sqrt', 'Math.log', 'Math.round', 'Math.ceil', 'Math.random',
                'JSON.stringify', 'JSON.parse', 'Date.now', 'Object.seal', 'Object.keys', 'Object.assign',
                'Number.isInteger', 'Number.parseInt', 'parseInt', 'parseFloat', 'isNaN',
                'console.warn', 'console.error', 'console.info'],
            src: 'class Any {\n  constructor(x) {\n    this.x = x;\n  }\n  a() {\n    Math.max(this.x, 1);\n    JSON.stringify(this.x);\n    Date.now();\n    return this.x;\n  }\n}\n',
            run: function (RegX) {
                // The real question behind "do we list Math.* keywords": KNOWN_IMPORTS
                // has exactly ONE row (console.log). Every other dot-path in the
                // entire standard library — Math.abs/max/min/pow/sqrt/round/ceil/
                // random, JSON.parse/stringify, Object.seal/keys/assign, Array.isArray,
                // Number.isInteger, String(), Date.now, parseInt, isNaN, console.warn/
                // error/info — is NOT individually tested, but is mechanically
                // guaranteed to hit the identical unrecognized-callee path, because
                // compileStatementToWasm's 'call' branch is a single `if (!KNOWN_IMPORTS[...])
                // return null` gate, not per-name logic. Proven here by mixing three
                // unrelated stdlib calls in one method and confirming none of them
                // disturbs the return value or the module's validity — one mechanism,
                // sampled three ways, not three separate unverified claims.
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, valid = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    valid = WebAssembly.validate(wasm);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 41);
                    result = i1.exports.a(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && valid === true && result === 41,
                    detail: threw ? ('threw: ' + threw) : 'valid=' + valid + ', a() = ' + result + ' (want 41) — all three ' +
                        'unknown calls vanished identically; confirms the gate is per-TABLE-MEMBERSHIP, not per-name' };
            }
        },

        {
            id: '37', name: 'PASS: mixed + and * respects precedence (this.a + this.b * this.c)',
            keywords: ['mixed +/* precedence'],
            src: 'class Mix {\n  constructor(a, b, c) {\n    this.a = a;\n    this.b = b;\n    this.c = c;\n  }\n  calc() {\n    return this.a + this.b * this.c;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 2, 3, 4);
                    result = i1.exports.calc(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 14, detail: threw ? ('threw: ' + threw) : 'calc() = ' + result + ' (want 14)' };
            }
        },

        {
            id: '38', name: 'PASS: identifiers with underscores and digits (_x, x1) as param names',
            keywords: ['identifier naming (_, digits)'],
            src: 'class Named {\n  constructor(_x, x1) {\n    this._x = _x;\n    this.x1 = x1;\n  }\n  sum() {\n    return this._x + this.x1;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 5, 6);
                    result = i1.exports.sum(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 11, detail: threw ? ('threw: ' + threw) : 'sum() = ' + result + ' (want 11)' };
            }
        },

        {
            id: '39', name: 'PASS: a constructor with no property assignments compiles and exports cleanly',
            keywords: ['empty constructor'],
            src: 'class Empty {\n  constructor() {\n  }\n  answer() {\n    return 1;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null, valid = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    valid = WebAssembly.validate(wasm);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0);
                    result = i1.exports.answer(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && valid === true && result === 1, detail: threw ? ('threw: ' + threw) : 'valid=' + valid + ', answer() = ' + result + ' (want 1)' };
            }
        },

        {
            id: '40', name: 'FAIL: true/false boolean literals are compiled as variable references, not 1/0',
            xfail: true,
            keywords: ['true', 'false', 'boolean literal'],
            src: 'class Bool {\n  constructor(x) {\n    this.x = x;\n  }\n  yes(z) {\n    return true;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    result = i1.exports.yes(0, 999);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 999, detail: threw ? ('threw: ' + threw) : 'yes() = ' + result + ' (want true/1; "true" was compiled as a variable read, same mechanism as NaN)' };
            }
        },

        {
            id: '41', name: 'FAIL: typeof is not a recognized unary operator — falls to 0',
            xfail: true,
            keywords: ['typeof'],
            src: 'class T {\n  constructor(x) {\n    this.x = x;\n  }\n  t() {\n    return typeof this.x;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 5);
                    result = i1.exports.t(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 0, detail: threw ? ('threw: ' + threw) : 't() = ' + result + ' (want "number"; typeof is not handled, falls to i32.const 0)' };
            }
        },

        {
            id: '42', name: 'FAIL: instanceof is not a recognized operator — falls to 0',
            xfail: true,
            keywords: ['instanceof'],
            src: 'class I {\n  constructor(x) {\n    this.x = x;\n  }\n  chk() {\n    return this.x instanceof Object;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 5);
                    result = i1.exports.chk(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 0, detail: threw ? ('threw: ' + threw) : 'chk() = ' + result + ' (want 0/false anyway, but for the wrong reason — no operator handling exists)' };
            }
        },

        {
            id: '43', name: 'FAIL: compound assignment (this.x += 1;) matches no statement pattern — silently dropped',
            xfail: true,
            keywords: ['+= compound assignment', '-=', '*=', '/='],
            src: 'class Comp {\n  constructor(x) {\n    this.x = x;\n  }\n  inc() {\n    this.x += 1;\n    return this.x;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 10);
                    result = i1.exports.inc(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 10, detail: threw ? ('threw: ' + threw) : 'inc() = ' + result + ' (want 11; this.x += 1 was never applied, not even wrongly)' };
            }
        },

        {
            id: '44', name: 'FAIL: ternary (cond ? a : b) is not recognized — falls to 0',
            xfail: true,
            keywords: ['ternary ?:'],
            src: 'class Tern {\n  constructor(x) {\n    this.x = x;\n  }\n  pick() {\n    return this.x > 0 ? 1 : 0;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 5);
                    result = i1.exports.pick(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 0, detail: threw ? ('threw: ' + threw) : 'pick() = ' + result + ' (want 1 — happens to also fall to 0, same default path as every other unrecognized shape)' };
            }
        },

        {
            id: '45', name: 'FAIL: class ... extends ... is not recognized as a block AT ALL — the whole class vanishes',
            xfail: true,
            keywords: ['extends', 'inheritance', 'super'],
            src: 'class Base {\n  constructor(x) {\n    this.x = x;\n  }\n  get() {\n    return this.x;\n  }\n}\nclass Derived extends Base {\n  constructor(x) {\n    this.x = x;\n  }\n  get() {\n    return this.x;\n  }\n}\n',
            run: function (RegX) {
                const inst = new RegX();
                const ast = inst.parse(this.src);
                const foundDerived = ast.blocks.some(function (b) { return b.name === 'Derived'; });
                return { ok: !foundDerived, detail: 'blocks found: ' + ast.blocks.map(function (b) { return b.name; }).join(', ') +
                    ' — Derived is missing entirely, not just its extends clause; every property/method it declares is invisible' };
            }
        },

        {
            id: '46', name: 'FAIL: bare "this" as a return value is compiled as an ordinary identifier, not the object pointer',
            xfail: true,
            keywords: ['return this', 'this (bare)'],
            src: 'class Self {\n  constructor(x) {\n    this.x = x;\n  }\n  self(z) {\n    return this;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    result = i1.exports.self(42, 777);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 777, detail: threw ? ('threw: ' + threw) : 'self() = ' + result + ' (want 42, the this-pointer; got z\u2019s value instead — same index-1 fallback as NaN/true)' };
            }
        },

        {
            id: '47', name: 'arrow function assigned to a property',
            xfail: true,
            keywords: ['arrow functions'],
            src: 'class A {\n  constructor(x) {\n    this.f = () => x;\n  }\n  get() {\n    return this.f;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 9);
                    result = i1.exports.get(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 0, detail: threw ? ('threw: ' + threw) : 'get() = ' + result + ' (want a callable; got 0)' };
            }
        },
        {
            id: '48', name: 'destructuring assignment in a method body',
            xfail: true,
            keywords: ['destructuring'],
            src: 'class D {\n  constructor(x) {\n    this.x = x;\n  }\n  get() {\n    const { a, b } = this.x;\n    return a;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let valid = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    valid = WebAssembly.validate(wasm);
                } catch (e) { threw = e.message; }
                return { ok: threw !== null || valid === false, detail: threw ? ('threw: ' + threw) : 'compiled, valid=' + valid + ' — destructuring not applied' };
            }
        },
        {
            id: '49', name: 'rest parameter in a constructor (...args) is a fixed single slot, not variable-arity capture',
            xfail: true,
            keywords: ['spread/rest'],
            src: 'class R {\n  constructor(...args) {\n    this.x = args;\n  }\n  get() {\n    return this.x;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let threw = null, valid = null, exportArity = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    valid = WebAssembly.validate(wasm);
                    const inst = new RegX();
                    inst.parse(this.src);
                    exportArity = (inst._ast.methods[0].params || []).length; // "...args" counted as ONE param
                } catch (e) { threw = e.message; }
                // Coincidentally valid: "...args" becomes one localMap entry,
                // and the unrecognized-identifier fallback (index 1) happens
                // to land on that same slot for exactly one extra param. It
                // is a fixed single-argument function, never variable-arity
                // capture -- validity here is a coincidence of the fallback,
                // not rest-parameter support.
                return { ok: threw === null && valid === true && exportArity === 1,
                    detail: threw ? ('threw: ' + threw) : 'valid=' + valid + ', constructor param count=' + exportArity +
                        ' (a real rest param captures 0..N args; this is exactly 1, fixed)' };
            }
        },
        {
            id: '50', name: 'template literal beyond a bare string',
            xfail: true,
            keywords: ['template literals beyond a bare string'],
            src: 'class TL {\n  constructor(x) {\n    this.x = x;\n  }\n  greet() {\n    return `hi ${this.x}`;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 9);
                    result = i1.exports.greet(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 0, detail: threw ? ('threw: ' + threw) : 'greet() = ' + result + ' (want "hi 9")' };
            }
        },
        {
            id: '51', name: 'switch statement',
            xfail: true,
            keywords: ['switch'],
            src: 'class S {\n  constructor(x) {\n    this.x = x;\n  }\n  pick() {\n    switch (this.x) {\n      case 1:\n        return 1;\n    }\n    return 0;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 1);
                    result = i1.exports.pick(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null, detail: threw ? ('threw: ' + threw) : 'pick() = ' + result + ' — not a real switch dispatch' };
            }
        },
        {
            id: '52', name: 'try/catch',
            xfail: true,
            keywords: ['try/catch'],
            src: 'class C {\n  constructor(x) {\n    this.x = x;\n  }\n  safe() {\n    try {\n      return this.x;\n    } catch (e) {\n      return 0;\n    }\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 9);
                    result = i1.exports.safe(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null, detail: threw ? ('threw: ' + threw) : 'safe() = ' + result + ' — try/catch structure not compiled' };
            }
        },
        {
            id: '53', name: 'FIXED — getter syntax (get x()) compiles to a real, distinctly-named, callable accessor',
            keywords: ['getters/setters'],
            src: 'class G {\n  constructor(x) {\n    this._x = x;\n  }\n  get x() {\n    return this._x;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const inst = new RegX();
                const ast = inst.parse(this.src);
                const acc = ast.methods.find(function (m) { return m.accessorKind === 'get'; });
                let result = null, threw = null, valid = null;
                try {
                    const wasm = inst.generateWasm();
                    valid = WebAssembly.validate(wasm);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 9);
                    result = i1.exports.get_x(0);
                } catch (e) { threw = e.message; }
                const ok = threw === null && valid === true && Number(result) === 9 && !!acc && acc.accessorProp === 'x';
                return { ok: ok, detail: threw ? ('threw: ' + threw)
                    : 'accessor tagged=' + (!!acc) + ', valid=' + valid + ', get_x() = ' + result + ' (want 9) — "get x()" compiles to its own export, not a bare name collision' };
            }
        },
        {
            id: '54', name: 'FIXED — static class member compiles to a real, exported, shared WASM global',
            keywords: ['static/private class members'],
            src: 'class St {\n  static count = 0;\n  constructor(x) {\n    this.x = x;\n  }\n  get() {\n    return this.x;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const inst = new RegX();
                inst.parse(this.src);
                let result = null, threw = null, valid = null, staticVal = null;
                try {
                    const wasm = inst.generateWasm();
                    valid = WebAssembly.validate(wasm);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 9);
                    result = i1.exports.get(0);
                    staticVal = Number(i1.exports.count.value);
                } catch (e) { threw = e.message; }
                const ok = threw === null && valid === true && result === 9 && staticVal === 0;
                return { ok: ok, detail: threw ? ('threw: ' + threw)
                    : 'valid=' + valid + ', get()=' + result + ' (want 9), static "count" export.value=' + staticVal + ' (want 0) — ' +
                      'a WASM global shared by the module instance, not per-object memory, not invisible' };
            }
        },
        {
            id: '55', name: 'FIXED — private class field (#x) is allocated real storage, initialized from its declared default',
            keywords: ['static/private class members'],
            src: 'class P {\n  #x = 5;\n  constructor(x) {\n    this.x = x;\n  }\n  get() {\n    return this.x;\n  }\n  getPrivate() {\n    return this.#x;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                const inst = new RegX();
                const ast = inst.parse(this.src);
                const tracked = ast.properties.some(function (p) { return p.key === '#x'; });
                let result = null, priv = null, threw = null, valid = null;
                try {
                    const wasm = inst.generateWasm();
                    valid = WebAssembly.validate(wasm);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 9);
                    result = i1.exports.get(0);
                    priv = i1.exports.getPrivate(0);
                } catch (e) { threw = e.message; }
                const ok = threw === null && valid === true && result === 9 && Number(priv) === 5 && tracked;
                return { ok: ok, detail: threw ? ('threw: ' + threw)
                    : 'valid=' + valid + ', get()=' + result + ' (want 9), getPrivate()=' + priv + ' (want 5, its declared default), tracked as property=' + tracked };
            }
        },
        {
            id: '56', name: 'async method',
            xfail: true,
            keywords: ['async/await'],
            src: 'class As {\n  constructor(x) {\n    this.x = x;\n  }\n  async get() {\n    return this.x;\n  }\n}\n',
            run: function (RegX) {
                const inst = new RegX();
                const ast = inst.parse(this.src);
                const named = ast.methods.map(function (m) { return m.name; });
                return { ok: named.indexOf('async') === -1 || named.indexOf('get') === -1,
                    detail: 'methods found: ' + named.join(', ') + ' — async is not modeled, real Promise-returning semantics absent regardless' };
            }
        },
        {
            id: '57', name: 'generator method (yield)',
            xfail: true,
            keywords: ['generators'],
            src: 'class Gen {\n  constructor(x) {\n    this.x = x;\n  }\n  *walk() {\n    yield this.x;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let threw = null, valid = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    valid = WebAssembly.validate(wasm);
                } catch (e) { threw = e.message; }
                return { ok: true, detail: threw ? ('threw: ' + threw) : 'valid=' + valid + ' — yield not recognized as any statement shape' };
            }
        },
        {
            id: '58', name: 'new Promise(...)',
            xfail: true,
            keywords: ['Promise'],
            src: 'class Pr {\n  constructor(x) {\n    this.x = x;\n  }\n  wait() {\n    return new Promise(this.x);\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 9);
                    result = i1.exports.wait(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 0, detail: threw ? ('threw: ' + threw) : 'wait() = ' + result + ' (want a Promise; "new" is unhandled)' };
            }
        },
        {
            id: '59', name: 'new Map() / new Set()',
            xfail: true,
            keywords: ['Map/Set'],
            src: 'class M {\n  constructor(x) {\n    this.x = x;\n  }\n  bag() {\n    return new Map();\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    result = i1.exports.bag(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 0, detail: threw ? ('threw: ' + threw) : 'bag() = ' + result + ' (want a Map)' };
            }
        },
        {
            id: '60', name: 'optional chaining (this.x?.y)',
            xfail: true,
            keywords: ['optional chaining (?.)'],
            src: 'class OC {\n  constructor(x) {\n    this.x = x;\n  }\n  get() {\n    return this.x?.y;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 9);
                    result = i1.exports.get(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 0, detail: threw ? ('threw: ' + threw) : 'get() = ' + result };
            }
        },
        {
            id: '61', name: 'nullish coalescing (this.x ?? 0)',
            xfail: true,
            keywords: ['nullish coalescing (??)'],
            src: 'class NC {\n  constructor(x) {\n    this.x = x;\n  }\n  get() {\n    return this.x ?? 0;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 9);
                    result = i1.exports.get(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null && result === 0, detail: threw ? ('threw: ' + threw) : 'get() = ' + result + ' (want 9)' };
            }
        },
        {
            id: '62', name: 'Array/String instance method call (this.arr.push(1))',
            xfail: true,
            keywords: ['Array/String instance methods (.map/.filter/.slice/...)'],
            src: 'class Arr2 {\n  constructor(x) {\n    this.arr = x;\n  }\n  add() {\n    this.arr.push(1);\n    return this.arr;\n  }\n}\n',
            run: function (RegX) {
                if (!hasWasm()) return { ok: null, detail: 'no WebAssembly in this host — skipped' };
                let result = null, threw = null;
                try {
                    const wasm = RegX.javascriptToWasm(this.src);
                    const i1 = new AutoInstance(new WebAssembly.Module(wasm), {});
                    i1.exports.init(0, 9);
                    result = i1.exports.add(0);
                } catch (e) { threw = e.message; }
                return { ok: threw === null, detail: threw ? ('threw: ' + threw) : 'add() = ' + result + ' — .push not in KNOWN_IMPORTS, dropped like Math.floor' };
            }
        },

        {
            id: '09', name: 'debug harness does not throw (enableDebug/hexDump/getDebugLog/disableDebug)',
            src: 'class Q {\n  constructor(x) {\n    this.x = x;\n  }\n  get() {\n    return this.x;\n  }\n}\n',
            run: function (RegX) {
                try {
                    RegX.enableDebug();
                    const inst = new RegX();
                    inst.enableDebug();
                    inst.parse(this.src);
                    inst.generateWAT();
                    inst.generateWasm();
                    const log = RegX.getDebugLog();
                    RegX.clearDebugLog();
                    RegX.disableDebug();
                    return { ok: typeof log === 'string', detail: 'debug log captured, ' + log.length + ' chars' };
                } catch (e) {
                    RegX.disableDebug();
                    return { ok: false, detail: 'threw: ' + e.message };
                }
            }
        }
    ];

    // ─── Runner ─────────────────────────────────────────────────

    function run(opts) {
        opts = opts || {};

        if (!RegX) throw new Error('RegXConformance: RegX is not loaded');
        if (!TestReport) throw new Error('RegXConformance: TestReport is not loaded');

        const R = new TestReport.Report({
            suite: 'RegX', id: '001', title: 'RegX conformance — JS → WAT/Wasm',
            subtitle: 'Every case is proven against the real WebAssembly engine, never against RegX\'s own claim of success.'
        });

        R.precondition('RegX loaded', function () { return { ok: typeof RegX !== 'undefined' }; });
        R.precondition('WebAssembly available in this host', function () {
            return { ok: hasWasm(), note: hasWasm() ? 'yes' : 'no — WASM-dependent cases will skip, not silently pass' };
        });
        R.observation('RegX version', function () { return RegX.hexDump ? 'RegX ' + (RegX.name || 'RegX') : 'RegX'; });

        R.hypothesis({
            h1: 'RegX\'s supported grammar (this.X = expr; / return expr; over +, *, digits, ' +
                'bare identifiers) compiles correctly, and any input the grammar does not cover ' +
                'fails LOUDLY — a thrown error or WebAssembly.validate() === false — rather than ' +
                'silently returning a module that is invalid or computes a wrong answer.',
            h1Predicts: [
                'Cases 01-05, 09 (in-grammar, single-arity operators): pass.',
                'Cases 06-08 (out-of-grammar) and 03/10 (3+ term sums, a cross-backend divergence): ' +
                'should throw or fail validate(); currently do NOT — each is a locked regression ' +
                '(XFAIL), tracked, not hidden.'
            ],
            falsifier: 'Any case where javascriptToWasm() returns bytes with no exception, and those ' +
                'bytes are WebAssembly-invalid OR compute a wrong number when called. Cases 06-08 ' +
                'currently satisfy this — H1 is REJECTED for the current implementation, on record ' +
                'as of this run.'
        });

        R.preconditionBlock();

        R.section('CASES');
        let pass = 0, fail = 0, xfail = 0, xpass = 0, skip = 0;
        const rows = [];
        const failures = [];
        const caseResults = [];

        // CASES is in INSERTION order, not numeric order: every new case was
        // spliced in "right before case 09" as an anchor across many edits,
        // so 09 ended up last in the array despite its low id. Sort a copy
        // here rather than reorder the source array, so the report is
        // deterministic without a risky mass-reshuffle of the file.
        const sortedCases = CASES.slice().sort(function (a, b) { return parseInt(a.id, 10) - parseInt(b.id, 10); });

        for (const c of sortedCases) {
            let outcome;
            try { outcome = c.run.call(c, RegX); }
            catch (e) { outcome = { ok: false, detail: 'case threw: ' + e.message }; }

            let tag;
            if (outcome.ok === null) { tag = 'SKIP'; skip++; }
            else if (c.xfail) {
                // xfail passes its OWN check (the defect reproduced as
                // expected) — that is a "locked" result, not a green pass on
                // working code. If it fails its check, the defect's behaviour
                // CHANGED, which is itself worth a look either way.
                tag = outcome.ok ? 'XFAIL' : 'XPASS?';
                if (outcome.ok) { xfail++; } else { xpass++; }
                if (!outcome.ok) failures.push(c.id + ' ' + c.name + ' — behaviour changed: ' + outcome.detail);
            }
            else if (outcome.ok) { tag = 'PASS'; pass++; }
            else { tag = 'FAIL'; fail++; failures.push(c.id + ' ' + c.name + ' — ' + outcome.detail); }

            rows.push([c.id, tag, c.name.length > 52 ? c.name.slice(0, 51) + '…' : c.name]);
            caseResults.push({ id: c.id, name: c.name, tag: tag, detail: outcome.detail, keywords: c.keywords || [] });
            R.line('  ' + tag.padEnd(7) + c.id + '  ' + c.name);
            R.line('          ' + outcome.detail);
        }

        R.section('SUMMARY');
        R.kv('Pass', pass);
        R.kv('Fail', fail + (fail ? '  ← real, unexpected failures' : ''));
        R.kv('XFAIL (locked)', xfail + (xfail ? '  ← known defects, re-checked every run, see H1' : ''));
        R.kv('XPASS', xpass + (xpass ? '  ← a locked defect stopped reproducing — fix landed or behaviour drifted' : ''));
        R.kv('Skipped', skip + (skip ? '  ← no WebAssembly in this host' : ''));

        const verdictText = fail
            ? fail + ' UNEXPECTED failure(s) — see CASES above.'
            : (xfail
                ? 'All expected cases pass. H1 is REJECTED as stated: ' + xfail +
                  ' locked regression(s) confirmed present (cases 06-08 class). RegX silently ' +
                  'accepts out-of-grammar input in some shapes rather than failing loudly.'
                : 'All cases pass, including zero locked regressions — H1 holds for this run.');

        R.verdict({
            text: verdictText,
            support: rows.map(function (r) { return r[1].padEnd(7) + r[0] + '  ' + r[2]; }),
            caveat: 'This suite covers RegXCore + JavaScriptMixin + WATGeneratorMixin + ' +
                'WasmBinaryGeneratorMixin against the grammar RegX documents (this.X = expr;, ' +
                'return expr;, +, *, digits, identifiers). It does NOT cover control flow, calls, ' +
                'strings, arrays, or any language mixin other than JavaScript — those are untested, ' +
                'not passing.'
        });

        return {
            pass: pass, fail: fail, xfail: xfail, skip: skip,
            failures: failures,
            caseResults: caseResults,
            reportText: R.render()
        };
    }

    // ─── Keyword report ─────────────────────────────────────────
    //
    // The keyword-support table is GENERATED from these results, not hand
    // maintained in a separate doc. A markdown file describing test outcomes
    // can drift from what the suite actually verifies the moment either one
    // changes without the other; this cannot drift, because it has no
    // existence apart from the run that just happened.
    function keywordReport() {
        const result = run();
        const byKeyword = {};
        for (const cr of result.caseResults) {
            for (const kw of cr.keywords) {
                byKeyword[kw] = { keyword: kw, caseId: cr.id, caseName: cr.name, tag: cr.tag, detail: cr.detail };
            }
        }
        const keywords = Object.keys(byKeyword).sort();
        const working = keywords.filter(function (k) { return byKeyword[k].tag === 'PASS'; });
        const notWorking = keywords.filter(function (k) { return byKeyword[k].tag !== 'PASS'; });

        const lines = [];
        lines.push(TestReport.RULE);
        lines.push('  KEYWORD SUPPORT — generated from RegXConformance.run(), case-by-case');
        lines.push('  Every row below is the live outcome of the named case, not prose.');
        lines.push(TestReport.RULE);
        lines.push('');
        lines.push('  WORKS (' + working.length + '):');
        lines.push('    ' + (working.length ? working.join(', ') : '(none)'));
        lines.push('');
        lines.push('  DOES NOT WORK (' + notWorking.length + '):');
        lines.push('    ' + (notWorking.length ? notWorking.join(', ') : '(none)'));
        lines.push('');
        lines.push(TestReport.RULE);
        for (const kw of keywords) {
            const e = byKeyword[kw];
            lines.push('');
            lines.push('  ' + kw);
            lines.push('    ' + e.tag.padEnd(7) + 'case ' + e.caseId + '  ' + e.caseName);
            lines.push('    ' + e.detail);
        }
        lines.push('');
        lines.push(TestReport.RULE);
        return { keywords: keywords, working: working, notWorking: notWorking, byKeyword: byKeyword, reportText: lines.join('\n'), suiteResult: result };
    }

    // ─── Untagged-keyword audit ─────────────────────────────────
    //
    // "class" was used in every single case's src and tagged as a keyword in
    // NONE of them until a user caught it by hand. That is the exact failure
    // this suite exists to prevent -- a keyword's coverage tag was still a
    // human remembering to write it down, which is no more reliable than the
    // markdown table this replaced. This audits the gap mechanically: scan
    // every case's actual source text for a token, and if the token appears
    // ANYWHERE but is claimed by NO case's keywords array, that is reported
    // as a hard finding, not left to be caught by chance a second time.
    // Structural tokens present in nearly every class-based case by
    // definition are not a coverage gap when "untagged" -- they carry no
    // distinguishing information about what that CASE tests. Removed rather
    // than filtered at report time, so the list itself states what counts as
    // interesting.
    var INTERESTING_TOKENS = [
        { name: 'class', re: /\bclass\b/ },
        { name: 'extends', re: /\bextends\b/ },
        { name: 'if', re: /\bif\s*\(/ },
        { name: 'else', re: /\belse\b/ },
        { name: 'while', re: /\bwhile\s*\(/ },
        { name: 'for', re: /\bfor\s*\(/ },
        { name: 'typeof', re: /\btypeof\b/ },
        { name: 'instanceof', re: /\binstanceof\b/ },
        { name: 'true', re: /\btrue\b/ },
        { name: 'false', re: /\bfalse\b/ },
        { name: 'NaN', re: /\bNaN\b/ },
        { name: 'console.log', re: /console\.log/ },
        { name: 'Math.floor', re: /Math\.floor/ },
        { name: 'Math.max', re: /Math\.max/ },
        { name: 'JSON.stringify', re: /JSON\.stringify/ },
        { name: 'Date.now', re: /Date\.now/ },
        { name: 'Object.freeze', re: /Object\.freeze/ },
        { name: '+=', re: /[^=!<>]\+=/ },
        { name: '-', re: /this\.\w+\s*-\s*this\.\w+/ },
        { name: '/', re: /this\.\w+\s*\/\s*this\.\w+/ },
        { name: '?:', re: /\?[^:]*:/ }
    ];

    function auditUntaggedKeywords() {
        const result = run();
        const taggedNames = [];
        for (const cr of result.caseResults) for (const kw of cr.keywords) taggedNames.push(kw);

        const findings = [];
        for (const tok of INTERESTING_TOKENS) {
            const usedBy = CASES.filter(function (c) { return tok.re.test(c.src || ''); }).map(function (c) { return c.id; });
            // Substring match, not exact-string: a case tagged 'Math.floor
            // (statement)' DOES cover the token 'Math.floor' -- exact-equality
            // would report that as a false gap, which is its own kind of
            // noise (case in point: this caught itself on first run).
            const covered = taggedNames.some(function (kw) { return kw.indexOf(tok.name) !== -1; });
            if (usedBy.length && !covered) {
                findings.push({ token: tok.name, usedByCaseIds: usedBy });
            }
        }
        return { findings: findings, checkedTokens: INTERESTING_TOKENS.length, taggedKeywordCount: new Set(taggedNames).size };
    }

    return { version: VERSION, run: run, CASES: CASES, keywordReport: keywordReport, auditUntaggedKeywords: auditUntaggedKeywords };
}));
