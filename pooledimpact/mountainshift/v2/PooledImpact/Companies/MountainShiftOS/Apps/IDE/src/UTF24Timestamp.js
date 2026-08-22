// UTF24Timestamp.js — in-memory 24-byte tuple form of UTF-19, with lossless
// conversion to/from the 19-byte serialized (dense, bit-packed) UTF-19 format
// and standard epoch milliseconds / Date.
//
// UTF-19 (serialized, 152 bits, no padding):
//   A(1) sentinel | B(4) overflow | C+D(8) seconds | E(2) fractional | F(3) meta | RES(1)
//
// UTF-24 (in-memory, byte-aligned tuple, 24 bytes):
//   0      sentinel            (1 byte,  0x01)
//   1-8    seconds             (8 bytes, Int64, Unix epoch seconds, signed)
//   9-10   fractional          (2 bytes, Uint16, unit = precision field)
//   11     precision type      (1 byte,  0=ns 1=us 2=ms)
//   12     UTC offset          (1 byte,  signed quarter-hours, -12h..+14h)
//   13     extended flags      (1 byte)
//   14-17  overflow / era      (4 bytes, Uint32 — non-Unix-epoch / calendar extension)
//   18-22  reserved            (5 bytes, extensibility headroom)
//   23     reserved terminator (1 byte,  0x00)
//
// Every field starts on a byte boundary (no cross-byte bit-packing), which is
// what makes this the right in-memory shape — a plain, alignable tuple —
// while still round-tripping exactly to the dense 19-byte wire format.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.UTF24Timestamp = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const PRECISION = { NANOSECONDS: 0x00, MICROSECONDS: 0x01, MILLISECONDS: 0x02 };

  class UTF24Timestamp {
    static SIZE = 24;
    static SENTINEL = 0x01;
    static RESERVED = 0x00;
    static PRECISION = PRECISION;

    constructor(source) {
      this.buffer = new ArrayBuffer(24);
      this.view = new DataView(this.buffer);
      this.bytes = new Uint8Array(this.buffer);

      if (source instanceof Uint8Array && source.length === 24) {
        this.bytes.set(source);
      } else if (source instanceof Uint8Array && source.length === 19) {
        this._fromUTF19(source);
      } else if (typeof source === 'bigint') {
        this._fromEpochMs(source);
      } else if (typeof source === 'number') {
        this._fromEpochMs(BigInt(Math.round(source)));
      } else if (source instanceof Date) {
        this._fromEpochMs(BigInt(source.getTime()));
      } else {
        this._fromEpochMs(BigInt(Date.now()));
      }
    }

    _fromEpochMs(ms) {
      const seconds = ms >= 0n ? ms / 1000n : -((-ms + 999n) / 1000n);
      const fracMs = Number(((ms % 1000n) + 1000n) % 1000n);
      this.view.setUint8(0, UTF24Timestamp.SENTINEL);
      this.view.setBigInt64(1, seconds, false);
      this.view.setUint16(9, fracMs, false);
      this.view.setUint8(11, PRECISION.MILLISECONDS);
      this.view.setInt8(12, 0);
      this.view.setUint8(13, 0);
      this.view.setUint32(14, 0, false);
      for (let i = 18; i < 23; i++) this.view.setUint8(i, 0);
      this.view.setUint8(23, UTF24Timestamp.RESERVED);
    }

    _fromUTF19(bytes19) {
      const v = new DataView(bytes19.buffer, bytes19.byteOffset, 19);
      const sentinel = v.getUint8(0);
      const overflow = v.getUint32(1, false);
      const seconds = v.getBigInt64(5, false);
      const fractional = v.getUint16(13, false);
      const utcOffset = v.getInt8(15);
      const precision = v.getUint8(16);
      const flags = v.getUint8(17);

      this.view.setUint8(0, sentinel);
      this.view.setBigInt64(1, seconds, false);
      this.view.setUint16(9, fractional, false);
      this.view.setUint8(11, precision);
      this.view.setInt8(12, utcOffset);
      this.view.setUint8(13, flags);
      this.view.setUint32(14, overflow, false);
      for (let i = 18; i < 23; i++) this.view.setUint8(i, 0);
      this.view.setUint8(23, UTF24Timestamp.RESERVED);
    }

    // ---- Field accessors ----
    get seconds() { return this.view.getBigInt64(1, false); }
    get fractional() { return this.view.getUint16(9, false); }
    get precision() { return this.view.getUint8(11); }
    set precision(p) { this.view.setUint8(11, p); }
    get utcOffsetQuarterHours() { return this.view.getInt8(12); }
    set utcOffsetQuarterHours(q) { this.view.setInt8(12, q); }
    get flags() { return this.view.getUint8(13); }
    set flags(f) { this.view.setUint8(13, f); }
    get overflow() { return this.view.getUint32(14, false); }
    set overflow(v) { this.view.setUint32(14, v >>> 0, false); }

    // ---- Conversions ----
    toEpochMs() {
      return this.seconds * 1000n + BigInt(this.fractional);
    }

    toDate() { return new Date(Number(this.toEpochMs())); }
    toISOString() { return this.toDate().toISOString(); }

    toUTF19() {
      const out = new Uint8Array(19);
      const v = new DataView(out.buffer);
      v.setUint8(0, this.view.getUint8(0));
      v.setUint32(1, this.overflow, false);
      v.setBigInt64(5, this.seconds, false);
      v.setUint16(13, this.fractional, false);
      v.setInt8(15, this.utcOffsetQuarterHours);
      v.setUint8(16, this.precision);
      v.setUint8(17, this.flags);
      v.setUint8(18, UTF24Timestamp.RESERVED);
      return out;
    }

    isValid() {
      return this.view.getUint8(0) === UTF24Timestamp.SENTINEL && this.view.getUint8(23) === UTF24Timestamp.RESERVED;
    }

    toHex() {
      return Array.from(this.bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // ---- Static constructors ----
    static now() { return new UTF24Timestamp(BigInt(Date.now())); }
    static fromEpochMs(ms) { return new UTF24Timestamp(typeof ms === 'bigint' ? ms : BigInt(Math.round(ms))); }
    static fromDate(date) { return new UTF24Timestamp(date); }
    static fromUTF19Bytes(bytes19) { return new UTF24Timestamp(bytes19); }

    static fromUTF19Hex(hex) {
      const bytes = new Uint8Array(19);
      for (let i = 0; i < 19; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
      return new UTF24Timestamp(bytes);
    }

    static fromHex(hex24) {
      const bytes = new Uint8Array(24);
      for (let i = 0; i < 24; i++) bytes[i] = parseInt(hex24.substr(i * 2, 2), 16);
      return new UTF24Timestamp(bytes);
    }
  }

  return UTF24Timestamp;
}));
