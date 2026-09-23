// ─── RulesEngine.js — generic pattern -> rule -> action pipeline ──────
//
// Domain-agnostic. Does not know about code, WASM, or RegX at all. A Rule
// is any object exposing:
//   ruleId  : stable string id
//   match(text, state)   -> match-info, or null if this rule doesn't apply
//                            anywhere in `text` right now
//   reduce(text, match, state) -> new text, with ONE occurrence reduced
//
// The engine runs an ORDERED list of rules. For each rule in order, it
// repeatedly match+reduce until match() returns null (a fixed point for
// that rule), then moves to the next rule. `state` is shared, mutable
// scratch space threaded through every rule in the pipeline — the
// intended use is a placeholder/side-table (see definePlaceholderTable
// below), letting a rule replace an already-resolved chunk of text with
// an opaque token so later rules can't see into it.
//
// This is the general mechanism: regular expressions can't express
// recursive/nested structure directly (that's a real regular-vs-context-
// free language distinction), so recursion is achieved by ITERATING flat
// (regular) reduction passes instead — each pass only ever solves a
// non-recursive sub-problem, and the previously-resolved structure is
// hidden behind an atomic placeholder so the next pass can't corrupt it.
// The same shape applies whether the "text" is a math expression, a
// template with embedded foreign languages (HTML with JS/CSS/XML), or any
// other staged reduction problem — RegX's expression-precedence pipeline
// is one instance of this engine, not the engine itself.

(function(root, factory) {
  'use strict';

  if (typeof define === 'function' && define.amd) {
    define(['ExtendX'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./ExtendX'));
  } else {
    root.RulesEngine = factory(root.ExtendX || (typeof window !== 'undefined' && window.ExtendX));
  }
}(typeof self !== 'undefined' ? self : this, function(ExtendX) {
  'use strict';

  var MAX_ITERATIONS = 100000;

  function RulesEngine(rules) {
    this.rules = rules || [];
  }

  // Runs every rule, in order, each to its own fixed point, threading one
  // shared `state` object through the whole pipeline. Returns the final
  // text and the (possibly mutated) state.
  RulesEngine.prototype.run = function(input, state) {
    state = state || {};
    var text = input;

    for (var i = 0; i < this.rules.length; i++) {
      var rule = this.rules[i];
      var guard = 0;

      while (true) {
        var m = rule.match(text, state);
        if (!m) break;

        var next = rule.reduce(text, m, state);
        if (next === text) {
          throw new Error('RulesEngine: rule "' + rule.ruleId + '" matched but did not change the text — would loop forever');
        }
        text = next;

        guard++;
        if (guard > MAX_ITERATIONS) {
          throw new Error('RulesEngine: rule "' + rule.ruleId + '" did not reach a fixed point within ' + MAX_ITERATIONS + ' iterations (possible non-terminating rule)');
        }
      }
    }

    return { text: text, state: state };
  };

  // A placeholder table: intern(payload) replaces a chunk of already-
  // resolved structure with an opaque token so later rules see it as one
  // atom, not text they might re-match into. resolve(token) looks a
  // payload back up. U+2726 is deliberately outside any expression
  // grammar this engine's known consumers use, to avoid collisions.
  RulesEngine.definePlaceholderTable = function() {
    var table = [];
    var MARK = '✦';
    return {
      table: table,
      intern: function(payload) {
        var id = table.length;
        table.push(payload);
        return MARK + id + MARK;
      },
      isPlaceholder: function(text) {
        return new RegExp('^' + MARK + '\\d+' + MARK + '$').test(text);
      },
      resolve: function(placeholderText) {
        var m = new RegExp(MARK + '(\\d+)' + MARK).exec(placeholderText);
        if (!m) return undefined;
        return table[parseInt(m[1], 10)];
      }
    };
  };

  return RulesEngine;
}));
