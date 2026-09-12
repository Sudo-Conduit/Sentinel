/**
 * @file research/lib/chain/Data.js
 * @author Will Fobbs
 * @version 1.1.0
 * @description Link 1 of Data -> Tensor -> Hilbert -> Hamiltonian -> Continuity -> VonNeumann -> Diagonal/Dense.
 *              Normalizes a raw source (json array/map, delimited text, db table,
 *              bitmap, unicode, or ascii) into a single canonical in-memory shape
 *              (rows, or a raw bit sequence for the bit-level sources) without
 *              imposing any algebraic structure on it. No index/order semantics
 *              are asserted here — that is Tensor's job, injected as a dependency
 *              downstream, not required here.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example const d = new Data().init([{x:1}], {type: Data.SOURCE_TYPES.JSON_ARRAY});
 * @example const d = new Data().init('w', {type: Data.SOURCE_TYPES.ASCII});
 */
(function (root, factory)
{
  if (typeof module === 'object' && module.exports)
  {
    module.exports = factory();
  }
  else if (typeof define === 'function' && define.amd)
  {
    define([], factory);
  }
  else
  {
    root.Chain = root.Chain || {};
    root.Chain.Data = factory();
  }
}(typeof self !== 'undefined' ? self : this, function ()
{
  'use strict';

  class Data
  {
    static name = 'Data';
    static author = 'Will Fobbs';
    static version = '1.1.0';
    static description = 'Normalizes json/delimited/db-table/bitmap/unicode/ascii sources into canonical rows or bit sequences.';
    static docs = ['research/lib/chain/docs/Data.md'];
    static tests = ['research/lib/chain/tests/Data.unit.js'];
    static config_default = { hasHeader: true, delimiter: ',', bitsPerChar: 7 };

    static SOURCE_TYPES = Object.freeze({
      JSON_ARRAY: 'json-array',   // [{...}, {...}]
      JSON_MAP: 'json-map',       // { key: {...}, key2: {...} } or { key: value }
      DELIMITED: 'delimited',     // CSV/TSV/etc as a raw string + delimiter
      DB_TABLE: 'db-table',       // { columns: [...], rows: [[...], [...]] }
      BITMAP: 'bitmap',           // { width, height, data: byte-iterable, channels? }
      UNICODE: 'unicode',         // string, or { text, encoding: 'utf-8'|'utf-16'|'utf-32' }
      ASCII: 'ascii',             // string, or { text }: strict 7-bit codepoints, 0-127 only
    });

    /**
     * Allocates an uninitialized Data instance. No source is read here —
     * call init() to actually parse and normalize a source. Splitting
     * allocation from initialization keeps the instance re-init-able and
     * keeps construction-time failures (bad source, bad opts) out of `new`.
     */
    constructor()
    {
      this.type = null;
      this.delimiter = ',';
      this.hasHeader = true;
      this.bitsPerChar = 7;
      this.source = null;
      this.columns = null;  // string[] | null (unordered/map sources)
      this.rows = null;     // array of plain records (objects, arrays, or bits)
      this.meta = null;     // e.g. {width,height,channels} for BITMAP, {encoding,byteLength} for UNICODE/ASCII
    }

    /**
     * Initializes this Data instance from a raw source.
     * @param {*} source - raw payload matching `opts.type`
     * @param {Object} opts
     * @param {string} opts.type - one of Data.SOURCE_TYPES
     * @param {string} [opts.delimiter=','] - required for DELIMITED
     * @param {boolean} [opts.hasHeader=true] - required for DELIMITED
     * @param {number} [opts.bitsPerChar=7] - ASCII only; 7 is the true spec width,
     *   pass 8 to get the byte-padded-in-memory form instead
     * @returns {Data} this, for chaining
     * @throws {TypeError} if source or opts.type is missing/invalid
     */
    init(source, opts)
    {
      if (source === undefined || source === null)
      {
        throw new TypeError('Data.init: source is required');
      }
      if (!opts || !opts.type)
      {
        throw new TypeError('Data.init: opts.type is required');
      }

      this.type = opts.type;
      this.delimiter = opts.delimiter || ',';
      this.hasHeader = opts.hasHeader !== false;
      this.bitsPerChar = opts.bitsPerChar || 7;
      this.source = source;

      const parsed = Data._normalize(source, this);
      this.columns = parsed.columns;
      this.rows = parsed.rows;
      this.meta = parsed.meta || null;

      return this;
    }

    static _normalize(source, self)
    {
      switch (self.type)
      {
        case Data.SOURCE_TYPES.JSON_ARRAY:
          return Data._fromJsonArray(source);
        case Data.SOURCE_TYPES.JSON_MAP:
          return Data._fromJsonMap(source);
        case Data.SOURCE_TYPES.DELIMITED:
          return Data._fromDelimited(source, self.delimiter, self.hasHeader);
        case Data.SOURCE_TYPES.DB_TABLE:
          return Data._fromDbTable(source);
        case Data.SOURCE_TYPES.BITMAP:
          return Data._fromBitmap(source);
        case Data.SOURCE_TYPES.UNICODE:
          return Data._fromUnicode(source);
        case Data.SOURCE_TYPES.ASCII:
          return Data._fromAscii(source, self.bitsPerChar);
        default:
          throw new TypeError('Data.init: unknown type "' + self.type + '"');
      }
    }

    // ── bit-level encoders (self-contained: no host TextEncoder dependency) ──

    /** MSB-first bit expansion of a byte sequence -> array of 0|1 */
    static _bytesToBits(bytes)
    {
      const bits = new Array(bytes.length * 8);
      let p = 0;
      for (let i = 0; i < bytes.length; i++)
      {
        const byte = bytes[i];
        for (let b = 7; b >= 0; b--)
        {
          bits[p++] = (byte >> b) & 1;
        }
      }
      return bits;
    }

    /** UTF-8: 1-4 bytes per code point, standard encoding */
    static _utf8Bytes(text)
    {
      const bytes = [];
      for (const ch of text)
      {
        const cp = ch.codePointAt(0);
        if (cp <= 0x7f)
        {
          bytes.push(cp);
        }
        else if (cp <= 0x7ff)
        {
          bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
        }
        else if (cp <= 0xffff)
        {
          bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        }
        else
        {
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
    static _utf16Bytes(text)
    {
      const bytes = [];
      for (let i = 0; i < text.length; i++)
      {
        const cu = text.charCodeAt(i);
        bytes.push((cu >> 8) & 0xff, cu & 0xff);
      }
      return bytes;
    }

    /** UTF-32: 4 bytes per code point (big-endian) */
    static _utf32Bytes(text)
    {
      const bytes = [];
      for (const ch of text)
      {
        const cp = ch.codePointAt(0);
        bytes.push((cp >>> 24) & 0xff, (cp >>> 16) & 0xff, (cp >>> 8) & 0xff, cp & 0xff);
      }
      return bytes;
    }

    static _fromJsonArray(arr)
    {
      if (!Array.isArray(arr))
      {
        throw new TypeError('Data: JSON_ARRAY source must be an array');
      }
      const columnSet = new Set();
      arr.forEach((rec) =>
      {
        if (rec && typeof rec === 'object')
        {
          Object.keys(rec).forEach((k) => columnSet.add(k));
        }
      });
      return { columns: columnSet.size ? Array.from(columnSet) : null, rows: arr.slice() };
    }

    static _fromJsonMap(map)
    {
      if (!map || typeof map !== 'object' || Array.isArray(map))
      {
        throw new TypeError('Data: JSON_MAP source must be a plain object');
      }
      const rows = Object.keys(map).map((key) => ({ key, value: map[key] }));
      return { columns: ['key', 'value'], rows };
    }

    static _fromDelimited(text, delimiter, hasHeader)
    {
      if (typeof text !== 'string')
      {
        throw new TypeError('Data: DELIMITED source must be a string');
      }
      const lines = text.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
      if (lines.length === 0)
      {
        return { columns: null, rows: [] };
      }

      const split = (line) => line.split(delimiter);
      let columns = null;
      let dataLines = lines;

      if (hasHeader)
      {
        columns = split(lines[0]);
        dataLines = lines.slice(1);
      }

      const rows = dataLines.map((line) =>
      {
        const cells = split(line);
        if (!columns)
        {
          return cells;
        }
        const rec = {};
        columns.forEach((c, i) =>
        {
          rec[c] = cells[i];
        });
        return rec;
      });

      return { columns, rows };
    }

    static _fromDbTable(table)
    {
      if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows))
      {
        throw new TypeError('Data: DB_TABLE source must be { columns, rows }');
      }
      const columns = table.columns.slice();
      const rows = table.rows.map((r) =>
      {
        const rec = {};
        columns.forEach((c, i) =>
        {
          rec[c] = r[i];
        });
        return rec;
      });
      return { columns, rows };
    }

    /**
     * ASCII is kept distinct from UTF-8 (rather than treated as its subset)
     * for two reasons that matter downstream:
     *   1. It is the clearest case that a character IS a bit array already —
     *      'w' = 1110111 is not "like" a bitmap, it is one, at whatever
     *      bitsPerChar width you fix, ready to reshape via Tensor.
     *   2. It strictly enforces the 7-bit range (0-127) that UTF-8 would
     *      silently widen past for anything above ASCII, so the width
     *      actually used is honest: 7 bits/char is the historical
     *      compression baseline (1 bit reclaimed per char vs. an 8-bit
     *      byte), which is also what makes fixed-width Unicode encodings
     *      (UTF-32's 32, or really just the 21 bits Unicode needs) worth
     *      comparing against — a handful of bits encoding a symbol like
     *      '∆' is drastically smaller than rasterizing that symbol as
     *      an actual pixel bitmap glyph would be.
     */
    static _asciiBits(text, bitsPerChar)
    {
      const bits = new Array(text.length * bitsPerChar);
      let p = 0;
      for (let i = 0; i < text.length; i++)
      {
        const cp = text.charCodeAt(i);
        if (cp > 127)
        {
          throw new RangeError(
            'Data: ASCII source has non-ASCII code point ' + cp + ' at index ' + i +
            ' — use SOURCE_TYPES.UNICODE for text outside 0-127'
          );
        }
        for (let b = bitsPerChar - 1; b >= 0; b--)
        {
          bits[p++] = (cp >> b) & 1;
        }
      }
      return bits;
    }

    static _fromAscii(source, bitsPerChar)
    {
      const isPlainString = typeof source === 'string';
      const text = isPlainString ? source : source.text;
      if (typeof text !== 'string')
      {
        throw new TypeError('Data: ASCII source must be a string or { text }');
      }
      const bits = Data._asciiBits(text, bitsPerChar);
      return {
        columns: null,
        rows: bits, // each row is a single bit (0|1)
        meta: { text, encoding: 'ascii-' + bitsPerChar, charLength: text.length, bitsPerChar, bitLength: bits.length },
      };
    }

    static _fromBitmap(source)
    {
      if (!source || typeof source !== 'object' || source.data == null)
      {
        throw new TypeError('Data: BITMAP source must be { width, height, data, channels? }');
      }
      const { width, height, channels } = source;
      if (typeof width !== 'number' || typeof height !== 'number')
      {
        throw new TypeError('Data: BITMAP source requires numeric width and height');
      }
      const bytes = Array.prototype.slice.call(source.data);
      const bits = Data._bytesToBits(bytes);
      return {
        columns: null,
        rows: bits, // each row is a single bit (0|1); reshape via Tensor's R1.shape
        meta: {
          width,
          height,
          channels: channels || (bytes.length / (width * height)) || 1,
          byteLength: bytes.length,
          bitLength: bits.length,
        },
      };
    }

    static _fromUnicode(source)
    {
      const isPlainString = typeof source === 'string';
      const text = isPlainString ? source : source.text;
      const encoding = (isPlainString ? 'utf-8' : source.encoding) || 'utf-8';
      if (typeof text !== 'string')
      {
        throw new TypeError('Data: UNICODE source must be a string or { text, encoding }');
      }

      let bytes;
      switch (encoding)
      {
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
    size()
    {
      return this.rows.length;
    }

    /** @returns {Array} shallow copy of normalized rows */
    toArray()
    {
      return this.rows.slice();
    }

    /** @returns {string[]|null} column names, if any could be inferred */
    schema()
    {
      return this.columns ? this.columns.slice() : null;
    }
  }

  return Data;
}));
