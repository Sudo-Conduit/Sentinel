// ─── frontend_java.js — real Java front-end for RegX (Stage 4A, per-language) ──
//
// Real Java: `static double calc(double x, double y) { return ...; }`, with
// a real `System.out.println(EXPR);` statement before the return. Java has
// neither `**` nor `^`-as-power (`^` is real bitwise XOR, same trap as C) --
// squaring is `x*x` or `Math.pow(x, 2)` (java.lang.Math, the real static
// method), translated the same way C's pow() is. Math.PI is Java's real
// static double constant. `System.out.println(EXPR)` is Java's real
// single-argument print call (the overload actually used for a bare
// numeric value) -- it takes exactly one value, so unlike C's printf it
// needs no format-string scoping decision: it already fits RegX's
// single-value console.log import as-is.
//
// Structured as the same two RulesEngine pipelines as every other front-end
// file here (see frontend_c.js's header comment for the full rationale):
// a statement pipeline (PrintRule, ReturnRule) and an expression pipeline
// (PowCallRule, ConstantRule), the latter reused for both the return
// expression and every println argument.

(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./RegX.js'), require('./RulesEngine.js'), require('./frontend_common.js'));
  } else {
    root.FrontendJava = factory(root.RegX, root.RulesEngine, root.FrontendCommon);
  }
}(typeof self !== 'undefined' ? self : this, function(RegX, RulesEngine, common) {
  'use strict';

  // ─── Expression pipeline: real Java constant/call syntax -> RegX text ──
  var PowCallRule = common.makePowCallRule('pow-call', 'Math\\.pow');
  var ConstantRule = common.makeConstantRule('const-math-pi', 'Math\\.PI', common.PI_LITERAL);
  var exprEngine = new RulesEngine([PowCallRule, ConstantRule]);
  function translateExpr(exprText) {
    return exprEngine.run(exprText, {}).text;
  }

  // ─── Statement pipeline: System.out.println(EXPR); and return EXPR; ────
  var PrintRule = {
    ruleId: 'println-stmt',
    match: function(text) {
      var m = /\bSystem\.out\.println\s*\(/.exec(text);
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
      if (args.length !== 1) {
        throw new Error('System.out.println(...) is only supported with exactly one argument, got ' + args.length + ': System.out.println(' + m.argsText + ')');
      }
      state.printStmts.push('console.log(' + translateExpr(args[0]) + ');');
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

  function parseJava(source) {
    var cleaned = common.stripBlockComments(source);
    cleaned = common.stripLineComments(cleaned, '//');
    var headerRegex = /(?:(?:public|private|protected|static)\s+)*(?:double|float|int)\s+(\w+)\s*\(([^)]*)\)\s*\{/;
    var result = common.extractBraceFunction(cleaned, headerRegex, function(p) {
      var pm = /(?:double|float|int)\s+(\w+)\s*$/.exec(p.trim());
      if (!pm) throw new Error('malformed Java parameter (expected "TYPE name"): ' + p);
      return pm[1];
    });
    var bodyText = common.compileStatements(result.interior, PrintRule, ReturnRule, result.name);
    return { name: result.name, params: result.params, bodyText: bodyText };
  }

  function compileJava(source) {
    var parsed = parseJava(source);
    var ast = common.buildAst(parsed.name, parsed.params, parsed.bodyText, source);
    var instance = new RegX();
    instance._ast = ast;
    instance._source = source;
    return instance;
  }

  function compileAndRunJava(source, imports) {
    var instance = compileJava(source);
    instance.generateWasm();
    return instance.instantiate(imports);
  }

  return {
    parse: parseJava,
    compile: compileJava,
    compileAndRun: compileAndRunJava
  };
}));
