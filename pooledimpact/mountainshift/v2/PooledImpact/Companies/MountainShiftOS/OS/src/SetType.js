/**
 * @file SetType.js
 * @author Will Fobbs, Pooled Impact
 * @version 1.0.0
 * @description A schema field primitive mirroring SQL's SET(...) column
 *              type: a fixed, ordered list of up to 64 named options,
 *              stored as a single 64-bit bitmask (one bit per option,
 *              option[0] = bit 0). This is the same trick MySQL's SET
 *              uses internally (packed into a BIGINT UNSIGNED) — it maps
 *              cleanly onto a DB column, stores as one integer/BigInt
 *              column, and membership tests are a single bitwise AND
 *              instead of a join or a CSV-string LIKE scan.
 *
 *              Declare a field this way in a class's _schema.properties:
 *                status: { type: 'bigint', kind: 'set',
 *                          options: ['pending','processing','shipped','delivered','cancelled'],
 *                          default: 0n }
 *              `type: 'bigint'` is what BaseClassX's generic typeof-based
 *              property validator checks against — no core BaseClassX
 *              change needed. `kind: 'set'` + `options` are read by the
 *              UI layer (CRUD engine) to render/format the field.
 *
 *              A SET field's *value* is always a BigInt bitmask (typeof
 *              'bigint'), never the raw string array — keep the array
 *              form (SetType.toArray/fromArray) at the UI/API boundary.
 *
 *              LOGICAL DELETE, not hard delete: retiring an option must
 *              never remove or renumber its bit position — existing rows
 *              already have that bit set in their stored bitmask, and
 *              deleting/shifting the option out from under them corrupts
 *              every record that used it ("DB breaks"). Instead mark the
 *              option retired in place: `{ label: 'cancelled', retired: true }`.
 *              A retired option keeps its bit and keeps decoding correctly
 *              forever; only the entry UI stops offering it for NEW
 *              selections (SetType.activeOptions), while it still renders
 *              on any record that already has it set.
 *
 *              EXCLUSIVE (single-select) sets, e.g. Active | Inactive |
 *              Blank: pass `exclusive: true` (+ `allowBlank: true`, the
 *              default). Blank — bitmask 0n, no option chosen — is a real,
 *              intentional third state here (matches a nullable DB column),
 *              not an error or a forced default; the UI renders this as
 *              radio buttons with an explicit "Blank" choice rather than
 *              silently defaulting to the first option.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SetType = factory();
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  const MAX_OPTIONS = 64;

  // Options may be a plain string ('pending') or { label, retired } for a
  // logically-deleted option that must keep its bit position forever.
  function optLabel(opt) { return typeof opt === 'string' ? opt : opt.label; }
  function optRetired(opt) { return typeof opt === 'string' ? false : !!opt.retired; }

  function assertOptions(options) {
    if (!Array.isArray(options) || options.length === 0) throw new Error('SetType: options must be a non-empty array');
    if (options.length > MAX_OPTIONS) throw new Error(`SetType: max ${MAX_OPTIONS} options, got ${options.length}`);
  }

  const SetType = {
    MAX_OPTIONS,

    /** Bit value (BigInt) for a single named option — throws on an unknown label (typo guard). */
    bitFor(options, label) {
      const idx = options.findIndex(o => optLabel(o) === label);
      if (idx === -1) throw new Error(`SetType: "${label}" is not one of [${options.map(optLabel).join(', ')}]`);
      return 1n << BigInt(idx);
    },

    /** Options still offered for NEW selections — excludes retired (logically-deleted) ones, whose bit stays reserved but hidden from entry. */
    activeOptions(options) {
      return options.filter(o => !optRetired(o)).map(optLabel);
    },
    isRetired(options, label) {
      const o = options.find(o => optLabel(o) === label);
      return o ? optRetired(o) : false;
    },

    /** labels[] → packed BigInt bitmask. */
    fromArray(options, labels) {
      assertOptions(options);
      return (labels || []).reduce((mask, label) => mask | SetType.bitFor(options, label), 0n);
    },

    /** bitmask → labels[] in option-declaration order (retired options included if their bit is set, so existing data still shows). */
    toArray(options, mask) {
      assertOptions(options);
      mask = BigInt(mask || 0);
      return options.map(optLabel).filter((_, i) => (mask & (1n << BigInt(i))) !== 0n);
    },

    has(options, mask, label) {
      return (BigInt(mask || 0) & SetType.bitFor(options, label)) !== 0n;
    },

    toggle(options, mask, label) {
      const bit = SetType.bitFor(options, label);
      mask = BigInt(mask || 0);
      return (mask & bit) !== 0n ? mask & ~bit : mask | bit;
    },

    /** For display: "shipped, delivered" — or a placeholder when empty (Blank is a real state, not an error). */
    label(options, mask, emptyLabel) {
      const arr = SetType.toArray(options, mask);
      return arr.length ? arr.join(', ') : (emptyLabel || 'Blank');
    }
  };

  return SetType;
}));
