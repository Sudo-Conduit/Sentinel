// ─── frontend_c.js — real C front-end for RegX (Stage 4A, split per-language) ──
//
// Real C: `double calc(double x, double y) { return ...; }`, optionally
// preceded by #include lines, with a real `printf(...)` statement before the
// return. No `**` and no real `^`-as-power exist in C at all (`^` is genuine
// bitwise XOR) -- squaring is `x*x` (plain multiply, no translation needed)
// or `pow(x, 2)` from <math.h> (real libm entry point), translated to
// RegX's own `**`. `M_PI` is the real POSIX/<math.h> constant (not in the
// C standard itself, but the actual idiom every real C program uses).
//
// Structured as TWO RulesEngine pipelines, mirroring how RegX.js's own
// compileArithmeticToWasm is RulesEngine-driven rather than a flat
// split-and-fold (see RulesEngine.js's own header comment: "the same shape
// applies whether the text is a math expression [or] any other staged
// reduction problem"):
//   1. a STATEMENT pipeline (PrintRule, ReturnRule) that reduces the
//      function body's interior text down to a print-statement list plus
//      one return expression;
//   2. an EXPRESSION pipeline (PowCallRule, ConstantRule) that translates
//      real C constant/call syntax into RegX's own arithmetic text, reused
//      identically for both the return expression and every printf argument.
// Adding a new C construct later (e.g. a second math.h constant) means
// registering one more rule in the relevant array below, not editing a
// monolithic parse function.
//
// This file does NOT modify RegX.js. It builds the exact AST object RegX's
// own JS parser would have produced, assigns it to a fresh RegX instance's
// `_ast`, and lets the existing, unmodified generateWasm()/instantiate()
// pipeline take it from there.

(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./RegX.js'), require('./RulesEngine.js'), require('./frontend_common.js'));
  } else {
    root.FrontendC = factory(root.RegX, root.RulesEngine, root.FrontendCommon);
  }
}(typeof self !== 'undefined' ? self : this, function(RegX, RulesEngine, common) {
  'use strict';

  // ─── Expression pipeline: real C constant/call syntax -> RegX text ────
  var PowCallRule = common.makePowCallRule('pow-call', 'pow');
  var ConstantRule = common.makeConstantRule('const-m-pi', 'M_PI', common.PI_LITERAL);
  var exprEngine = new RulesEngine([PowCallRule, ConstantRule]);
  function translateExpr(exprText) {
    return exprEngine.run(exprText, {}).text;
  }

  // ─── Statement pipeline: printf(...) and return EXPR; ──────────────────
  //
  // Real C printf takes a format string plus args (`printf("%f\n", x)`),
  // which doesn't fit RegX's single-value `console.log`-style import
  // (env.log always prints via `console.log('[wasm]', v)`, format string or
  // not). Scoped here to exactly the two shapes that genuinely reduce to a
  // single value crossing that import: `printf(EXPR)` (no format string at
  // all), and `printf("...", EXPR)` (a literal format string plus ONE
  // value, format string dropped since env.log can't use it anyway). Any
  // other arity is a genuine scope error, not a silent guess.
  var PrintRule = {
    ruleId: 'printf-stmt',
    match: function(text) {
      var m = /\bprintf\s*\(/.exec(text);
      if (!m) return null;
      var openParen = m.index + m[0].length - 1;
      var close;
      try { close = common.findMatchingParen(text, m.index); } catch (e) { return null; }
      var end = close + 1;
      if (text[end] === ';') end++;
      return { index: m.index, length: end - m.index, argsText: text.slice(openParen + 1, close) };
    },
    reduce: function(text, m, state) {
      var args = common.splitTopLevelArgs(m.argsText);
      var valueArg;
      if (args.length === 1) {
        valueArg = args[0];
      } else if (args.length === 2 && /^"[^"]*"$/.test(args[0])) {
        valueArg = args[1];
      } else {
        throw new Error('printf(...) is only supported as printf(EXPR) or printf("format", EXPR) in this front-end (real multi-arg/format-driven printf is out of scope), got: printf(' + m.argsText + ')');
      }
      state.printStmts.push('console.log(' + translateExpr(valueArg.trim()) + ');');
      return text.slice(0, m.index) + text.slice(m.index + m.length);
    }
  };

  var ReturnRule = {
    ruleId: 'return-stmt',
    match: function(text) {
      var m = /return\s+([\s\S]+?);/.exec(text);
      if (!m) return null;
      return { index: m.index, length: m[0].length, exprText: m[1].trim() };
    },
    reduce: function(text, m, state) {
      state.returnExpr = translateExpr(m.exprText);
      return text.slice(0, m.index) + text.slice(m.index + m.length);
    }
  };

  function parseC(source) {
    var cleaned = common.stripBlockComments(source).split('\n').filter(function(l) {
      return !/^\s*#\s*include\b/.test(l);
    }).join('\n');
    cleaned = common.stripLineComments(cleaned, '//');
    var headerRegex = /(?:double|float|int)\s+(\w+)\s*\(([^)]*)\)\s*\{/;
    var result = common.extractBraceFunction(cleaned, headerRegex, function(p) {
      var pm = /(?:double|float|int)\s+(\w+)\s*$/.exec(p.trim());
      if (!pm) throw new Error('malformed C parameter (expected "TYPE name"): ' + p);
      return pm[1];
    });
    var bodyText = common.compileStatements(result.interior, PrintRule, ReturnRule, result.name);
    return { name: result.name, params: result.params, bodyText: bodyText };
  }

  function compileC(source) {
    var parsed = parseC(source);
    var ast = common.buildAst(parsed.name, parsed.params, parsed.bodyText, source);
    var instance = new RegX();
    instance._ast = ast;
    instance._source = source;
    return instance;
  }

  function compileAndRunC(source, imports) {
    var instance = compileC(source);
    instance.generateWasm();
    return instance.instantiate(imports);
  }

  return {
    parse: parseC,
    compile: compileC,
    compileAndRun: compileAndRunC
  };
}));
