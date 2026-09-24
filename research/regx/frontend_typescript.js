// ─── frontend_typescript.js — real TypeScript front-end for RegX (Stage 4A, per-language) ──
//
// Real TypeScript: `function calc(x: number, y: number): number { ... }`.
// TS shares real JS's actual `**` exponentiation operator (unlike C/Java/
// PHP, `^` genuinely isn't even relevant here since TS never repurposes it
// either way) and Math.PI, and its real print statement IS `console.log
// (EXPR);` -- already exactly the text shape RegX's own KNOWN_IMPORTS
// machinery expects, so recognizing it is close to free: the PrintRule
// below only has to find the statement and pull out its one argument, with
// no syntax translation at all (contrast frontend_c.js/frontend_java.js,
// where the print call itself has to be rewritten into `console.log`).
// So the only real front-end work overall is stripping TS-only type
// annotations (`: number` on params and the return type) before the text
// is otherwise plain JS-shaped.
//
// Structured as the same two RulesEngine pipelines as every other front-end
// file here (see frontend_c.js's header comment for the full rationale):
// a statement pipeline (PrintRule, ReturnRule) and an expression pipeline
// (ConstantRule only -- TS needs no pow()/sigil rewrite, real `**` already
// works), the latter reused for both the return expression and the logged
// one.

(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./RegX.js'), require('./RulesEngine.js'), require('./frontend_common.js'));
  } else {
    root.FrontendTypeScript = factory(root.RegX, root.RulesEngine, root.FrontendCommon);
  }
}(typeof self !== 'undefined' ? self : this, function(RegX, RulesEngine, common) {
  'use strict';

  // ─── Expression pipeline: real TS constant syntax -> RegX text ─────────
  var ConstantRule = common.makeConstantRule('const-math-pi', 'Math\\.PI', common.PI_LITERAL);
  var exprEngine = new RulesEngine([ConstantRule]);
  function translateExpr(exprText) {
    return exprEngine.run(exprText, {}).text;
  }

  // ─── Statement pipeline: console.log(EXPR); and return EXPR; ───────────
  var PrintRule = {
    ruleId: 'console-log-stmt',
    match: function(text) {
      var m = /\bconsole\.log\s*\(/.exec(text);
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
        throw new Error('console.log(...) is only supported with exactly one argument, got ' + args.length + ': console.log(' + m.argsText + ')');
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

  function parseTypeScript(source) {
    var cleaned = common.stripBlockComments(source);
    cleaned = common.stripLineComments(cleaned, '//');
    var headerRegex = /function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*[\w<>\[\]., ]+\s*)?\{/;
    var result = common.extractBraceFunction(cleaned, headerRegex, function(p) {
      var pm = /^(\w+)\s*(?::\s*[\w<>\[\]., ]+)?$/.exec(p.trim());
      if (!pm) throw new Error('malformed TypeScript parameter (expected "name" or "name: Type"): ' + p);
      return pm[1];
    });
    var bodyText = common.compileStatements(result.interior, PrintRule, ReturnRule, result.name);
    return { name: result.name, params: result.params, bodyText: bodyText };
  }

  function compileTypeScript(source) {
    var parsed = parseTypeScript(source);
    var ast = common.buildAst(parsed.name, parsed.params, parsed.bodyText, source);
    var instance = new RegX();
    instance._ast = ast;
    instance._source = source;
    return instance;
  }

  function compileAndRunTypeScript(source, imports) {
    var instance = compileTypeScript(source);
    instance.generateWasm();
    return instance.instantiate(imports);
  }

  return {
    parse: parseTypeScript,
    compile: compileTypeScript,
    compileAndRun: compileAndRunTypeScript
  };
}));
