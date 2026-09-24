// ─── frontend_php.js — real PHP front-end for RegX (Stage 4A, per-language) ──
//
// Real PHP: `function calc($x, $y) { return $x * $y + ($x ** 2) - M_PI / $y; }`,
// with a real `echo EXPR;` statement before the return. PHP DOES have a
// real `**` operator (added in PHP 5.6) -- no pow() translation needed,
// unlike C/Java. The only real front-end work on the expression side is
// PHP's `$` variable sigil: stripped from both the parameter list and
// every reference in the body (but NOT from `M_PI`, which never carries a
// `$` in real PHP -- it's a bare global constant, not a variable). `echo`
// is a real PHP LANGUAGE CONSTRUCT, not a function call -- no parens
// required (`echo $x;`), which is why its own rule below scans for a
// top-level `;` instead of a matching `)` the way every other language's
// print rule here does.
//
// Structured as the same two RulesEngine pipelines as every other front-end
// file here (see frontend_c.js's header comment for the full rationale):
// a statement pipeline (PrintRule, ReturnRule) and an expression pipeline
// (SigilRule, ConstantRule), the latter reused for both the return
// expression and the echo'd expression.

(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./RegX.js'), require('./RulesEngine.js'), require('./frontend_common.js'));
  } else {
    root.FrontendPHP = factory(root.RegX, root.RulesEngine, root.FrontendCommon);
  }
}(typeof self !== 'undefined' ? self : this, function(RegX, RulesEngine, common) {
  'use strict';

  // ─── Expression pipeline: real PHP $-sigil/constant syntax -> RegX text ─
  //
  // SigilRule runs to its own fixed point (one `$name` -> `name` per
  // reduce) before ConstantRule, same ordering frontends_multilang.js's
  // single parsePHP function always applied (strip sigils, THEN swap in
  // M_PI) -- M_PI itself never carries a sigil, so order between the two
  // rules doesn't actually change the result, but matching the established
  // order keeps this file's intent legible against the original.
  var SigilRule = {
    ruleId: 'var-sigil',
    match: function(text) {
      var m = /\$(\w+)/.exec(text);
      if (!m) return null;
      return { index: m.index, length: m[0].length, name: m[1] };
    },
    reduce: function(text, m) {
      return text.slice(0, m.index) + m.name + text.slice(m.index + m.length);
    }
  };
  var ConstantRule = common.makeConstantRule('const-m-pi', 'M_PI', common.PI_LITERAL);
  var exprEngine = new RulesEngine([SigilRule, ConstantRule]);
  function translateExpr(exprText) {
    return exprEngine.run(exprText, {}).text;
  }

  // ─── Statement pipeline: echo EXPR; and return EXPR; ───────────────────
  var PrintRule = {
    ruleId: 'echo-stmt',
    match: function(text) {
      var m = /\becho\s+/.exec(text);
      if (!m) return null;
      var exprStart = m.index + m[0].length;
      var semi = common.findTopLevelChar(text, ';', exprStart);
      if (semi === -1) return null;
      return { index: m.index, length: semi + 1 - m.index, exprText: text.slice(exprStart, semi).trim() };
    },
    reduce: function(text, m, state) {
      state.printStmts.push('console.log(' + translateExpr(m.exprText) + ');');
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

  function parsePHP(source) {
    var cleaned = common.stripBlockComments(source);
    cleaned = common.stripLineComments(cleaned, '//');
    cleaned = cleaned.replace(/^\s*<\?php/, '').replace(/\?>\s*$/, '');
    var headerRegex = /function\s+(\w+)\s*\(([^)]*)\)\s*\{/;
    var result = common.extractBraceFunction(cleaned, headerRegex, function(p) {
      var pm = /^\$(\w+)$/.exec(p.trim());
      if (!pm) throw new Error('malformed PHP parameter (expected "$name"): ' + p);
      return pm[1];
    });
    var bodyText = common.compileStatements(result.interior, PrintRule, ReturnRule, result.name);
    return { name: result.name, params: result.params, bodyText: bodyText };
  }

  function compilePHP(source) {
    var parsed = parsePHP(source);
    var ast = common.buildAst(parsed.name, parsed.params, parsed.bodyText, source);
    var instance = new RegX();
    instance._ast = ast;
    instance._source = source;
    return instance;
  }

  function compileAndRunPHP(source, imports) {
    var instance = compilePHP(source);
    instance.generateWasm();
    return instance.instantiate(imports);
  }

  return {
    parse: parsePHP,
    compile: compilePHP,
    compileAndRun: compileAndRunPHP
  };
}));
