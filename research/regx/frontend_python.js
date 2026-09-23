// ─── frontend_python.js — real Python front-end for RegX (Stage 4A, per-language) ──
//
// Real Python: `def calc(x, y): return x * y + (x ** 2) - math.pi / y`
// (single-line form) or the equivalent indented block form, now also
// supporting a real `print(EXPR)` statement before the return. Python's
// real `**` is exponentiation (same operator text RegX's PowRule already
// understands, no translation needed) -- Python is the one language here
// that genuinely never uses `^` for anything arithmetic either (real
// Python `^` is also bitwise XOR, but that's moot: this parser only ever
// looks for `**`/`*`, never touches `^` at all). math.pi is Python's real
// `math` module constant.
//
// Structured as the same two RulesEngine pipelines as every other front-end
// file here (see frontend_c.js's header comment for the full rationale):
// a statement pipeline (PrintRule, ReturnRule) and an expression pipeline
// (ConstantRule only -- Python needs no sigil-stripping or pow() rewrite),
// the latter reused for both the return expression and the printed one.
// Only the header (`def NAME(params):`) is a single fixed regex, same as
// every other file here -- everything inside the body goes through the
// rule pipeline instead.

(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./RegX.js'), require('./RulesEngine.js'), require('./frontend_common.js'));
  } else {
    root.FrontendPython = factory(root.RegX, root.RulesEngine, root.FrontendCommon);
  }
}(typeof self !== 'undefined' ? self : this, function(RegX, RulesEngine, common) {
  'use strict';

  // ─── Expression pipeline: real Python constant syntax -> RegX text ─────
  var ConstantRule = common.makeConstantRule('const-math-pi', 'math\\.pi', common.PI_LITERAL);
  var exprEngine = new RulesEngine([ConstantRule]);
  function translateExpr(exprText) {
    return exprEngine.run(exprText, {}).text;
  }

  // ─── Statement pipeline: print(EXPR) and return EXPR ────────────────────
  //
  // Python has no statement-terminating `;` -- a statement's own text ends
  // at the next real newline (or end of source), never at a semicolon, so
  // neither rule below looks for one the way the C-family rules do.
  var PrintRule = {
    ruleId: 'print-stmt',
    match: function(text) {
      var m = /\bprint\s*\(/.exec(text);
      if (!m) return null;
      var openParen = m.index + m[0].length - 1;
      var close;
      try { close = common.findMatchingParen(text, m.index); } catch (e) { return null; }
      return { index: m.index, length: close + 1 - m.index, argsText: text.slice(openParen + 1, close) };
    },
    reduce: function(text, m, state) {
      var args = common.splitTopLevelArgs(m.argsText);
      if (args.length !== 1) {
        throw new Error('print(...) is only supported with exactly one argument, got ' + args.length + ': print(' + m.argsText + ')');
      }
      state.printStmts.push('console.log(' + translateExpr(args[0]) + ');');
      return text.slice(0, m.index) + text.slice(m.index + m.length);
    }
  };

  var ReturnRule = {
    ruleId: 'return-stmt',
    match: function(text) {
      var m = /return\s+([^\n]+)/.exec(text);
      if (!m) return null;
      return { index: m.index, length: m[0].length, exprText: m[1].trim() };
    },
    reduce: function(text, m, state) {
      state.returnExpr = translateExpr(m.exprText);
      return text.slice(0, m.index) + text.slice(m.index + m.length);
    }
  };

  function parsePython(source) {
    var cleaned = common.stripLineComments(source, '#');
    var headerRegex = /def\s+(\w+)\s*\(([^)]*)\)\s*:/;
    var m = headerRegex.exec(cleaned);
    if (!m) {
      throw new Error('no recognizable Python function declaration found (expected "def NAME(params): ...")');
    }
    var paramsText = m[2].trim();
    var params = paramsText ? common.splitTopLevelArgs(paramsText) : [];
    for (var i = 0; i < params.length; i++) {
      if (!/^[a-zA-Z_]\w*$/.test(params[i])) {
        throw new Error('malformed Python parameter (expected a bare name): ' + params[i]);
      }
    }
    var rest = cleaned.slice(m.index + m[0].length);
    var restLine = rest.split('\n')[0].trim();
    var interior;
    if (restLine) {
      // single-line form: `def calc(x, y): return EXPR` (or, more
      // generally, whatever statement text follows the colon on that
      // same physical line -- handed to the same rule pipeline as the
      // block form below, so a single-line `print(...); return EXPR`
      // works too, not just the historically-only-supported return).
      interior = restLine;
    } else {
      // block form: every non-blank line after the header is one
      // statement, in source order -- not just the first (that
      // restriction is exactly what made a print-before-return
      // impossible before this file existed).
      var bodyLines = rest.split('\n').slice(1).filter(function(l) { return l.trim(); }).map(function(l) { return l.trim(); });
      if (!bodyLines.length) {
        throw new Error('function "' + m[1] + '" has no body statement after the header');
      }
      interior = bodyLines.join('\n');
    }
    var bodyText = common.compileStatements(interior, PrintRule, ReturnRule, m[1]);
    return { name: m[1], params: params, bodyText: bodyText };
  }

  function compilePython(source) {
    var parsed = parsePython(source);
    var ast = common.buildAst(parsed.name, parsed.params, parsed.bodyText, source);
    var instance = new RegX();
    instance._ast = ast;
    instance._source = source;
    return instance;
  }

  function compileAndRunPython(source, imports) {
    var instance = compilePython(source);
    instance.generateWasm();
    return instance.instantiate(imports);
  }

  return {
    parse: parsePython,
    compile: compilePython,
    compileAndRun: compileAndRunPython
  };
}));
