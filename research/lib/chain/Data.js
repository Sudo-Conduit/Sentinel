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
    BITMAP: 'bitmap',           // { width, height, data: byte-iterable, channels? }
    UNICODE: 'unicode',         // string, or { text, encoding: 'utf-8'|'utf-16'|'utf-32' }
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
      this.meta = parsed.meta || null; // e.g. {width,height,channels} for BITMAP, {encoding,byteLength} for UNICODE
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
        case SOURCE_TYPES.BITMAP:
          return Data._fromBitmap(source);
        case SOURCE_TYPES.UNICODE:
          return Data._fromUnicode(source);
        default:
          throw new TypeError('Data: unknown type "' + self.type + '"');
      }
    }

    // ── bit-level encoders (self-contained: no host TextEncoder dependency) ──

    /** MSB-first bit expansion of a byte sequence -> array of 0|1 */
    static _bytesToBits(bytes) {
      const bits = new Array(bytes.length * 8);
      let p = 0;
      for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i];
        for (let b = 7; b >= 0; b--) {
          bits[p++] = (byte >> b) & 1;
        }
      }
      return bits;
    }

    /** UTF-8: 1-4 bytes per code point, standard encoding */
    static _utf8Bytes(text) {
      const bytes = [];
      for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp <= 0x7f) {
          bytes.push(cp);
        } else if (cp <= 0x7ff) {
          bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
        } else if (cp <= 0xffff) {
          bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        } else {
          bytes.push(
            0xf0 | (cp >> 18),
            0x80 | ((cp >> 12) & 0x3f),
            0x80 | ((cp >> 6) & 0x3f),
            0x80 | (cp & 0x3f)
          );
        }
      }
      return bytes;
    }

    /** UTF-16: 2 bytes per code unit (big-endian), surrogate pairs preserved as-is */
    static _utf16Bytes(text) {
      const bytes = [];
      for (let i = 0; i < text.length; i++) {
        const cu = text.charCodeAt(i);
        bytes.push((cu >> 8) & 0xff, cu & 0xff);
      }
      return bytes;
    }

    /** UTF-32: 4 bytes per code point (big-endian) */
    static _utf32Bytes(text) {
      const bytes = [];
      for (const ch of text) {
        const cp = ch.codePointAt(0);
        bytes.push((cp >>> 24) & 0xff, (cp >>> 16) & 0xff, (cp >>> 8) & 0xff, cp & 0xff);
      }
      return bytes;
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

    static _fromBitmap(source) {
      if (!source || typeof source !== 'object' || source.data == null) {
        throw new TypeError('Data: BITMAP source must be { width, height, data, channels? }');
      }
      const { width, height, channels } = source;
      if (typeof width !== 'number' || typeof height !== 'number') {
        throw new TypeError('Data: BITMAP source requires numeric width and height');
      }
      const bytes = Array.prototype.slice.call(source.data);
      const bits = Data._bytesToBits(bytes);
      return {
        columns: null,
        rows: bits, // each row is a single bit (0|1); reshape via Tensor's opts.shape
        meta: {
          width,
          height,
          channels: channels || (bytes.length / (width * height)) || 1,
          byteLength: bytes.length,
          bitLength: bits.length,
        },
      };
    }

    static _fromUnicode(source) {
      const isPlainString = typeof source === 'string';
      const text = isPlainString ? source : source.text;
      const encoding = (isPlainString ? 'utf-8' : source.encoding) || 'utf-8';
      if (typeof text !== 'string') {
        throw new TypeError('Data: UNICODE source must be a string or { text, encoding }');
      }

      let bytes;
      switch (encoding) {
        case 'utf-8':
          bytes = Data._utf8Bytes(text);
          break;
        case 'utf-16':
          bytes = Data._utf16Bytes(text);
          break;
        case 'utf-32':
          bytes = Data._utf32Bytes(text);
          break;
        default:
          throw new TypeError('Data: unknown UNICODE encoding "' + encoding + '"');
      }

      const bits = Data._bytesToBits(bytes);
      return {
        columns: null,
        rows: bits, // each row is a single bit (0|1)
        meta: { text, encoding, byteLength: bytes.length, bitLength: bits.length },
      };
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
