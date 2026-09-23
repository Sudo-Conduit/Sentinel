// ─── frontend_ocr.js — real OCR front-end for RegX ─────────────────────
//
// Same concept as frontend_c.js / frontend_php.js / frontend_python.js:
// translate a language's real "source" into the JS-shaped AST RegX's own
// unmodified parser/backend already compiles, then let RegX do the real
// WASM codegen and execution. Every other front-end's source is program
// text; OCR's source is a 9x8 mesh's on/off bit-pattern (a 72-character
// string of '0'/'1', row-major, exactly what the Base-3 null gate and the
// glyph font tables already produce upstream of this file).
//
// The "translation" is RulesEngine glyph rules, one per known reference
// character (see CANONICAL below): a rule matches only on an EXACT match
// against that glyph's canonical 72-bit pattern (a real RegExp, anchored
// ^...$, same mechanism as every other front-end's rules here -- this file
// does no fuzzy/partial matching by design). This is deliberately the
// DISCRETE base-identity layer only: "is this exactly a known glyph, and
// what score does it get." Fuzzy deviation-from-base is a separate,
// already-built BM25 layer (rgb_bm25.mjs) -- this file does not duplicate
// that job.
//
// On a match, the rule builds a REAL arithmetic expression from the actual
// input bits against the matched glyph's actual canonical bits --
// term_i = (2*bit_i - 1) * (2*canon_i - 1), which is +1 where the two
// agree and -1 where they disagree (both operands are 0/1, so this needs
// only the +, -, * RegX.js already supports -- no comparison operator
// exists in RegX's arithmetic subset, same constraint frontend_common's
// makePowCallRule works within). Summed over all 72 positions, a real
// match scores exactly 72. RegX's own WASM backend genuinely computes that
// sum at call time -- the rule only decides WHICH terms to write, same
// division of labor as frontend_php.js's M_PI substitution (parse-time
// text translation) versus RegX's own arithmetic codegen (runtime compute).

(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../RegX.js'), require('../RulesEngine.js'), require('../frontend_common.js'));
  } else {
    root.FrontendOCR = factory(root.RegX, root.RulesEngine, root.FrontendCommon);
  }
}(typeof self !== 'undefined' ? self : this, function(RegX, RulesEngine, common) {
  'use strict';

  var CELL_W = 9, CELL_H = 8, MESH_BITS = CELL_W * CELL_H;

  // Same 5x7 font used to render 90x80_001_ng.png, centered the same way
  // (2px left margin, 1px top margin in a 9x8 cell) -- CANONICAL below is
  // derived from this, not hand-transcribed, so it can't drift from what
  // the image actually contains.
  // Reverted the "connectivity-fixed" '3' (row1/row2/row3 doubled up) --
  // it made recognize()'s exact-match glyph a blocky vertical blob (reads
  // as a "J"), because it thickened three consecutive rows to force 4-
  // connectivity. Exact bit-matching never needed 4-connectivity to begin
  // with; only contour tracing (Phase 5's vectorize.js) does. That's fixed
  // there now, as a minimal render-time bridge pixel, not by distorting
  // this glyph's actual shape. This is the original, visually-correct
  // pattern -- diagonal-only connectivity between several row pairs is a
  // real property of it, and is fine for recognition.
  var FONT_5x7 = {
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001']
  };

  function canonicalBits(glyphChar) {
    var rows = FONT_5x7[glyphChar];
    if (!rows) throw new Error('no known canonical pattern for glyph "' + glyphChar + '"');
    var grid = [];
    for (var y = 0; y < CELL_H; y++) {
      var row = [];
      for (var x = 0; x < CELL_W; x++) row.push('0');
      grid.push(row);
    }
    var originX = 2, originY = 1; // matches gen_90x80.mjs's drawGlyph centering
    for (var r = 0; r < rows.length; r++) {
      for (var c = 0; c < rows[r].length; c++) {
        if (rows[r][c] === '1') grid[originY + r][originX + c] = '1';
      }
    }
    return grid.map(function(row) { return row.join(''); }).join('');
  }

  var KNOWN_GLYPHS = Object.keys(FONT_5x7);
  var CANONICAL = {};
  KNOWN_GLYPHS.forEach(function(g) { CANONICAL[g] = canonicalBits(g); });

  // Rule FACTORY: exact-match recognizer for one known glyph. `match` is a
  // real anchored RegExp test (no escaping needed -- canonical patterns are
  // '0'/'1' only). `reduce` writes the real per-position agreement
  // expression and consumes the whole string (empty result), which both
  // satisfies RulesEngine's "must change the text" invariant and ends the
  // pipeline immediately -- one glyph rule can win per input.
  function makeGlyphRule(glyphChar) {
    var pattern = CANONICAL[glyphChar];
    var re = new RegExp('^' + pattern + '$');
    return {
      ruleId: 'glyph-' + glyphChar,
      match: function(text) {
        return re.test(text) ? { index: 0, length: text.length } : null;
      },
      reduce: function(text, m, state) {
        var terms = [];
        for (var i = 0; i < text.length; i++) {
          var b = text[i] === '1' ? 1 : 0;
          var p = pattern[i] === '1' ? 1 : 0;
          // NOT wrapped in an extra outer paren: RegX.js's ParenRule only
          // resolves one level of nesting per pass via placeholder tokens,
          // and compileAtomToWasm can't read a placeholder token back as an
          // operand -- `(2*b-1)*(2*p-1)` compiles fine (two top-level
          // parens combined by the pipeline's own MulRule), an extra
          // `(...)` around that whole product does not. Verified directly
          // against RegX.js before settling on this shape.
          terms.push('(2*' + b + '-1)*(2*' + p + '-1)');
        }
        state.recognizedGlyph = glyphChar;
        state.printStmts.push('console.log(' + glyphChar.charCodeAt(0) + ');');
        state.returnExpr = terms.join(' + ');
        return '';
      }
    };
  }

  // Catch-all: no known glyph matched exactly. Sentinel score -1 (the
  // null/no-match code), same on/off/null vocabulary as the Base 3 work
  // this sits on top of.
  var UnknownRule = {
    ruleId: 'glyph-unknown',
    match: function(text) {
      return text.length > 0 ? { index: 0, length: text.length } : null;
    },
    reduce: function(text, m, state) {
      state.recognizedGlyph = null;
      state.printStmts.push('console.log(-1);');
      state.returnExpr = '-1';
      return '';
    }
  };

  var GLYPH_RULES = KNOWN_GLYPHS.map(makeGlyphRule).concat([UnknownRule]);

  function parseOCR(bitString) {
    if (typeof bitString !== 'string' || bitString.length !== MESH_BITS || !/^[01]+$/.test(bitString)) {
      throw new Error('OCR source must be exactly ' + MESH_BITS + ' bits of 0/1 (a ' + CELL_W + 'x' + CELL_H + ' mesh), got: ' +
        (typeof bitString === 'string' ? bitString.length + ' chars' : typeof bitString));
    }
    var state = { printStmts: [], returnExpr: null, recognizedGlyph: undefined };
    new RulesEngine(GLYPH_RULES).run(bitString, state);
    var bodyText = common.buildBraceBody(state.printStmts, state.returnExpr);
    return { name: 'recognize', params: [], bodyText: bodyText, recognizedGlyph: state.recognizedGlyph };
  }

  // Fast path: still the real RulesEngine pattern recognizer (same
  // GLYPH_RULES, same regex-anchored match() as parseOCR), just without the
  // RegX WASM compile+instantiate round trip after it. That round trip only
  // earns its cost when a compiled function has to run repeatedly over
  // DIFFERENT runtime inputs -- here every term's operands (the input bits
  // AND the matched glyph's canonical bits) are already known once the rule
  // has matched, so the score is knowable immediately: an exact match is
  // always MESH_BITS, no match is always -1. Compiling that to WASM and
  // calling in would spend real compile time computing a number the rule
  // match already determined. RulesEngine still does the recognition;
  // RegX's backend is simply the wrong tool for a compile-time-constant
  // result, so it's skipped.
  var FAST_RULES = KNOWN_GLYPHS.map(function(g) {
    return {
      ruleId: 'fast-glyph-' + g,
      match: function(text) { return new RegExp('^' + CANONICAL[g] + '$').test(text) ? { index: 0, length: text.length } : null; },
      reduce: function(text, m, state) { state.glyph = g; state.score = MESH_BITS; return ''; }
    };
  }).concat([{
    ruleId: 'fast-glyph-unknown',
    match: function(text) { return text.length > 0 ? { index: 0, length: text.length } : null; },
    reduce: function(text, m, state) { state.glyph = null; state.score = -1; return ''; }
  }]);

  // Phase 1: recognize() is now Promise-returning. The computation itself
  // is unchanged (still runs synchronously, inside the executor) -- this is
  // deliberately just the interface change, not real off-thread work. Two
  // reasons to do this now rather than when real async backing (worker
  // threads / async WASM) arrives: (1) lock the calling contract in while
  // there are only two callers (the benchmark, the verifier), so nothing
  // downstream (Phase 2's Promise.all() batching, and whatever eventually
  // replaces this body with genuine off-thread AMX/VNNI dispatch) has to
  // change its call shape later; (2) this trivial wrapper's own overhead
  // (Promise construction + microtask scheduling, zero real parallelism)
  // becomes a measured baseline, so a future real-parallelism number can be
  // credited correctly instead of conflating "async" with "faster."
  function recognize(bitString) {
    return new Promise(function(resolve, reject) {
      if (typeof bitString !== 'string' || bitString.length !== MESH_BITS || !/^[01]+$/.test(bitString)) {
        reject(new Error('OCR source must be exactly ' + MESH_BITS + ' bits of 0/1 (a ' + CELL_W + 'x' + CELL_H + ' mesh), got: ' +
          (typeof bitString === 'string' ? bitString.length + ' chars' : typeof bitString)));
        return;
      }
      var state = { glyph: undefined, score: undefined };
      new RulesEngine(FAST_RULES).run(bitString, state);
      resolve({ glyph: state.glyph, score: state.score });
    });
  }

  function compileOCR(bitString) {
    var parsed = parseOCR(bitString);
    var ast = common.buildAst(parsed.name, parsed.params, parsed.bodyText, bitString);
    var instance = new RegX();
    instance._ast = ast;
    instance._source = bitString;
    return instance;
  }

  function compileAndRunOCR(bitString, imports) {
    var instance = compileOCR(bitString);
    instance.generateWasm();
    return instance.instantiate(imports);
  }

  return {
    CELL_W: CELL_W,
    CELL_H: CELL_H,
    MESH_BITS: MESH_BITS,
    FONT_5x7: FONT_5x7,
    CANONICAL: CANONICAL,
    recognize: recognize,
    parse: parseOCR,
    compile: compileOCR,
    compileAndRun: compileAndRunOCR
  };
}));
