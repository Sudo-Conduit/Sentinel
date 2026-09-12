/**
 * Data.js
 *
 * Link 1 of Data -> Tensor -> Hilbert -> Hamiltonian -> Continuity -> VonNeumann -> Diagonal/Dense
 *
 * Data is the object-level ingestion boundary: it takes a raw source in one
 * of several concrete formats and normalizes it to a single canonical
 * in-memory shape (an array of row-records) without imposing any algebraic
 * structure on it. No index/order semantics are asserted here — that is
 * Tensor's job, injected as a dependency downstream, not required here.
 *
 * UMD, no requires. Browser global falls back to `window.Chain.Data`.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.Chain = root.Chain || {};
    root.Chain.Data = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SOURCE_TYPES = Object.freeze({
    JSON_ARRAY: 'json-array',   // [{...}, {...}]
    JSON_MAP: 'json-map',       // { key: {...}, key2: {...} } or { key: value }
    DELIMITED: 'delimited',     // CSV/TSV/etc as a raw string + delimiter
    DB_TABLE: 'db-table',       // { columns: [...], rows: [[...], [...]] }
  });

  class Data {
    /**
     * @param {*} source - raw payload matching `type`
     * @param {Object} opts
     * @param {string} opts.type - one of SOURCE_TYPES
     * @param {string} [opts.delimiter=','] - required for DELIMITED
     * @param {boolean} [opts.hasHeader=true] - required for DELIMITED
     */
    constructor(source, opts) {
      if (source === undefined || source === null) {
        throw new TypeError('Data: source is required');
      }
      if (!opts || !opts.type) {
        throw new TypeError('Data: opts.type is required');
      }
      this.type = opts.type;
      this.delimiter = opts.delimiter || ',';
      this.hasHeader = opts.hasHeader !== false;
      this.source = source;

      const parsed = Data._normalize(source, this);
      this.columns = parsed.columns;   // string[] | null (unordered/map sources)
      this.rows = parsed.rows;         // array of plain records (objects or arrays)
    }

    static get SOURCE_TYPES() {
      return SOURCE_TYPES;
    }

    static _normalize(source, self) {
      switch (self.type) {
        case SOURCE_TYPES.JSON_ARRAY:
          return Data._fromJsonArray(source);
        case SOURCE_TYPES.JSON_MAP:
          return Data._fromJsonMap(source);
        case SOURCE_TYPES.DELIMITED:
          return Data._fromDelimited(source, self.delimiter, self.hasHeader);
        case SOURCE_TYPES.DB_TABLE:
          return Data._fromDbTable(source);
        default:
          throw new TypeError('Data: unknown type "' + self.type + '"');
      }
    }

    static _fromJsonArray(arr) {
      if (!Array.isArray(arr)) {
        throw new TypeError('Data: JSON_ARRAY source must be an array');
      }
      const columnSet = new Set();
      arr.forEach((rec) => {
        if (rec && typeof rec === 'object') {
          Object.keys(rec).forEach((k) => columnSet.add(k));
        }
      });
      return { columns: columnSet.size ? Array.from(columnSet) : null, rows: arr.slice() };
    }

    static _fromJsonMap(map) {
      if (!map || typeof map !== 'object' || Array.isArray(map)) {
        throw new TypeError('Data: JSON_MAP source must be a plain object');
      }
      const rows = Object.keys(map).map((key) => ({ key, value: map[key] }));
      return { columns: ['key', 'value'], rows };
    }

    static _fromDelimited(text, delimiter, hasHeader) {
      if (typeof text !== 'string') {
        throw new TypeError('Data: DELIMITED source must be a string');
      }
      const lines = text.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
      if (lines.length === 0) return { columns: null, rows: [] };

      const split = (line) => line.split(delimiter);
      let columns = null;
      let dataLines = lines;

      if (hasHeader) {
        columns = split(lines[0]);
        dataLines = lines.slice(1);
      }

      const rows = dataLines.map((line) => {
        const cells = split(line);
        if (!columns) return cells;
        const rec = {};
        columns.forEach((c, i) => { rec[c] = cells[i]; });
        return rec;
      });

      return { columns, rows };
    }

    static _fromDbTable(table) {
      if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
        throw new TypeError('Data: DB_TABLE source must be { columns, rows }');
      }
      const columns = table.columns.slice();
      const rows = table.rows.map((r) => {
        const rec = {};
        columns.forEach((c, i) => { rec[c] = r[i]; });
        return rec;
      });
      return { columns, rows };
    }

    /** @returns {number} row count */
    size() {
      return this.rows.length;
    }

    /** @returns {Array} shallow copy of normalized rows */
    toArray() {
      return this.rows.slice();
    }

    /** @returns {string[]|null} column names, if any could be inferred */
    schema() {
      return this.columns ? this.columns.slice() : null;
    }
  }

  return Data;
});
