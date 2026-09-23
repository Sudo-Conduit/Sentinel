// ─── frontend_common.js — shared, language-agnostic infra for the per-
// language RegX front-ends (frontend_c.js, frontend_java.js, frontend_php.js,
// frontend_python.js, frontend_typescript.js) ───────────────────────────
//
// Plays the exact same role for the front-ends that ExtendX.js/RulesEngine.js
// play for RegX.js itself: shared plumbing every language file pulls in,
// never a place where LANGUAGE-SPECIFIC grammar lives. Each front-end file
// still defines its OWN ordered RulesEngine rule arrays for its own real
// syntax (see each file's header comment) -- this module only supplies the
// text-scanning primitives and rule FACTORIES common to more than one
// language (e.g. C's `pow(x,2)` and Java's `Math.pow(x,2)` need the
// identical two-arg/integer-exponent translation against two different
// callee names, so that translation is lifted here as a factory rather
// than copy-pasted).
//
// This module does NOT touch RegX.js and is not required by it -- RegX.js
// stays completely unaware these front-ends exist, same as before.

(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./RulesEngine.js'));
  } else {
    root.FrontendCommon = factory(root.RulesEngine);
  }
}(typeof self !== 'undefined' ? self : this, function(RulesEngine) {
  'use strict';

  // JS's own Math.PI, textualized to full double precision -- the SAME
  // literal text RegX's own compileAtomToWasm would parseFloat() for a JS
  // source that wrote the constant out longhand, so f64ConstBytes produces
  // the identical bit pattern real Math.PI already has.
  var PI_LITERAL = String(Math.PI); // "3.141592653589793"

  function findMatchingBrace(text, openIdx) {
    var depth = 0;
    for (var i = openIdx; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    throw new Error('unbalanced braces: no matching "}" for "{" at index ' + openIdx);
  }

  function findMatchingParen(text, openIdx) {
    var start = text.indexOf('(', openIdx);
    var depth = 0;
    for (var i = start; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
    throw new Error('unbalanced parens: no matching ")" for "(" at index ' + openIdx);
  }

  function splitTopLevelArgs(text) {
    var args = [];
    var depth = 0, start = 0;
    for (var i = 0; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      else if (text[i] === ',' && depth === 0) {
        args.push(text.slice(start, i).trim());
        start = i + 1;
      }
    }
    var last = text.slice(start).trim();
    if (last) args.push(last);
    return args;
  }

  // Index of the first `ch` at top-level paren depth 0, at-or-after
  // `start` -- mirrors RegX.js's own findStatementEnd depth-tracking, for
  // the same reason: a statement terminator search must not stop at a
  // char that's actually inside a NESTED call's own parens. Used by
  // statement forms with no enclosing call parens of their own (PHP's
  // `echo $x;` is a language construct, not a function call).
  function findTopLevelChar(text, ch, start) {
    var depth = 0;
    for (var i = start; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      else if (depth === 0 && text[i] === ch) return i;
    }
    return -1;
  }

  function stripLineComments(source, marker) {
    return source.split('\n').map(function(line) {
      var idx = line.indexOf(marker);
      return idx === -1 ? line : line.slice(0, idx);
    }).join('\n');
  }

  function stripBlockComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '');
  }

  // Extracts (name, paramNames[], exprText-of-the-return-statement) from a
  // C-family `KEYWORD NAME(params) { ... return EXPR; ... }` declaration,
  // given a header regex that captures name+params up to and including the
  // opening '{'. Shared by C/Java/TypeScript, which only differ in that
  // header regex and in how one param token maps to a bare name. Only the
  // DECLARATION shape (name/params/brace) is a single fixed regex here --
  // once inside the body, each language's own file takes over via its own
  // RulesEngine rule array (see each file's PrintRule/ReturnRule).
  function extractBraceFunction(source, headerRegex, paramToName) {
    var m = headerRegex.exec(source);
    if (!m) {
      throw new Error('no recognizable function declaration found (expected NAME(params) { ... })');
    }
    var openBrace = m.index + m[0].length - 1;
    var closeBrace = findMatchingBrace(source, openBrace);
    var interior = source.slice(openBrace + 1, closeBrace);
    var name = m[1];
    var paramsText = m[2].trim();
    var params = paramsText ? splitTopLevelArgs(paramsText).map(paramToName) : [];
    return { name: name, params: params, interior: interior };
  }

  // Builds the exact ast shape RegX's own JS parser produces for a
  // single-method class (see frontend_c.js's header comment) -- one
  // synthetic class block wrapping one real method, so
  // buildClassUnit/buildWasmBinary (entirely unmodified) compile it exactly
  // as they would a JS class with one method and no constructor. `bodyText`
  // is real, already-JS-shaped statement text -- RegX's own, UNMODIFIED
  // parseStatements/parseStatementList parses it downstream exactly as it
  // would any other method body (see buildFunctionBody's method.body use),
  // which is what makes a print statement here reach the SAME
  // console.log/KNOWN_IMPORTS machinery every other RegX source does.
  function buildAst(name, params, bodyText, rawSource) {
    var className = 'FE_' + name;
    return {
      type: 'Program',
      blocks: [{ type: 'class', name: className, extendsName: null, body: '', start: 0, end: 0, line: 1, column: 0 }],
      methods: [{
        name: name,
        params: params,
        body: bodyText,
        start: 0, end: 0, line: 1, column: 0,
        className: className
      }],
      properties: [], staticProperties: [], statements: [], expressions: [],
      calls: [], comments: [], literals: [], lines: [], raw: rawSource
    };
  }

  // Rule FACTORY (not a fixed rule): matches `CALLEE(base, non-negative-
  // integer-literal exponent)` anywhere in expression text and reduces it
  // to RegX's own real `**` operator text -- `pow(x, 2)` -> `(x**2)`.
  // RegX's own PowRule already requires a compile-time-constant non-
  // negative integer exponent, so this only ever produces text the
  // existing, unmodified backend was already built to accept; a non-2-arg
  // or non-integer-literal-exponent call is a genuine input error and
  // throws instead of guessing. `calleeNamePattern` is a REGEX-ESCAPED
  // literal (caller's responsibility, e.g. 'Math\\.pow') since `.` in a
  // real callee name (Math.pow) must match literally, not "any char".
  function makePowCallRule(ruleId, calleeNamePattern) {
    var re = new RegExp(calleeNamePattern + '\\(');
    return {
      ruleId: ruleId,
      match: function(text) {
        var m = re.exec(text);
        if (!m) return null;
        var openParen = m.index + m[0].length - 1;
        var close;
        try { close = findMatchingParen(text, m.index); } catch (e) { return null; }
        return { index: m.index, length: close + 1 - m.index, argsText: text.slice(openParen + 1, close) };
      },
      reduce: function(text, m) {
        var args = splitTopLevelArgs(m.argsText);
        if (args.length !== 2) {
          throw new Error('pow(...) expects exactly 2 arguments, got ' + args.length + ': ' + text.slice(m.index, m.index + m.length));
        }
        if (!/^\d+$/.test(args[1])) {
          throw new Error('pow(...) requires a compile-time non-negative integer exponent, got: ' + args[1]);
        }
        var replacement = '(' + args[0] + '**' + args[1] + ')';
        return text.slice(0, m.index) + replacement + text.slice(m.index + m.length);
      }
    };
  }

  // Rule FACTORY: replaces every occurrence of a bare constant name
  // (M_PI, Math.PI, math.pi) with RegX's own full-precision pi literal
  // text. `namePattern` is REGEX-ESCAPED (caller's responsibility, same
  // convention as makePowCallRule).
  function makeConstantRule(ruleId, namePattern, literalText) {
    var re = new RegExp('\\b' + namePattern + '\\b');
    return {
      ruleId: ruleId,
      match: function(text) {
        var m = re.exec(text);
        if (!m) return null;
        return { index: m.index, length: m[0].length };
      },
      reduce: function(text, m) {
        return text.slice(0, m.index) + literalText + text.slice(m.index + m.length);
      }
    };
  }

  // Joins a language's already-translated print statements (each a real,
  // full `console.log(EXPR);` string -- see each file's PrintRule) with
  // the function's single `return EXPR;` into one JS-shaped method body,
  // in source order. This is the ONLY place that text gets handed to
  // buildAst -- everything downstream (RegX's own parseStatements/
  // parseStatementList, buildFunctionBody, generateWasm) is completely
  // unmodified, unaware this body text didn't come from real JS source.
  function buildBraceBody(printStmts, returnExpr) {
    return '{ ' + printStmts.concat(['return ' + returnExpr + ';']).join(' ') + ' }';
  }

  // Runs a language's own [PrintRule, ReturnRule] pair (see each file) to
  // a fixed point over one function's body-interior text, PrintRule first
  // so every print statement is stripped (and its translated text
  // recorded, in source order) before ReturnRule looks for the one
  // remaining `return` -- the ordering mirrors RegX.js's own
  // highest-precedence-first rule array in compileArithmeticToWasm
  // (paren, then ^, then *, then +): each rule here fully resolves its
  // own construct before the next rule's pattern is even searched for.
  function compileStatements(interiorText, printRule, returnRule, functionName) {
    var state = { printStmts: [], returnExpr: null };
    new RulesEngine([printRule, returnRule]).run(interiorText, state);
    if (state.returnExpr === null) {
      throw new Error('function "' + functionName + '" has no `return EXPR;` statement (only the single-return, print-statements-before-it shape is supported)');
    }
    return buildBraceBody(state.printStmts, state.returnExpr);
  }

  return {
    PI_LITERAL: PI_LITERAL,
    findMatchingBrace: findMatchingBrace,
    findMatchingParen: findMatchingParen,
    splitTopLevelArgs: splitTopLevelArgs,
    findTopLevelChar: findTopLevelChar,
    stripLineComments: stripLineComments,
    stripBlockComments: stripBlockComments,
    extractBraceFunction: extractBraceFunction,
    buildAst: buildAst,
    buildBraceBody: buildBraceBody,
    compileStatements: compileStatements,
    makePowCallRule: makePowCallRule,
    makeConstantRule: makeConstantRule
  };
}));
