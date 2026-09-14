/**
 * @file research/lib/chain/MathPrecision.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Extends the real, global Math.fround(x, type) with an
 *              optional second parameter -- interface polymorphism on a
 *              name every AI and every human already has memorized,
 *              rather than a parallel bespoke namespace (the same move
 *              this codebase already makes elsewhere: Node's fs over a
 *              new VFS, SharedArrayBufferX extending SharedArrayBuffer).
 *              type omitted preserves the exact native behavior -- the
 *              original native function is kept and called straight
 *              through, so no existing caller anywhere observes any
 *              difference. That backward-compatibility is what separates
 *              this from a breaking override: nothing that already works
 *              stops working, this only adds a capability that did not
 *              exist before.
 *
 *              Every format below except F32 (which just delegates to the
 *              preserved native Math.fround) is a caller-invoked, explicit
 *              choice -- Tensor's own arithmetic defaults to full double
 *              precision unless a caller opts into a coarser one, matching
 *              the "stay dumb, caller decides" contract already used by
 *              SystemAdapter/Geodesic/Torus.
 *
 *              F16 is the one IEEE 754-2008 standard format here (1 sign,
 *              5 exponent, 10 mantissa). F8/F4 are NOT IEEE formats --
 *              IEEE has no 8-bit or 4-bit float standard. They come from
 *              the 2022 NVIDIA/Arm/Intel "FP8 Formats for Deep Learning"
 *              whitepaper, now maintained by the Open Compute Project
 *              (OCP) Microscaling Formats specification:
 *                F8_E4M3 (1,4,3): less range, more precision, no Inf --
 *                  saturates at +-448 (the top exponent field's mantissa
 *                  value 7 is reserved for the format's single NaN
 *                  encoding, so only 6 of 8 mantissa codes are usable at
 *                  the top exponent -- max is (1+6/8)*2^8=448, not the
 *                  480 a naive (2-2^-3)*2^8 would give).
 *                F8_E5M2 (1,5,2): same exponent width as F16 (similar
 *                  range), far less precision, standard Inf/NaN handling
 *                  -- max is exactly 57344.
 *                F4_E2M1 (1,2,1): MXFP4 -- extremely coarse, no Inf, no
 *                  reserved NaN pattern (unlike E4M3) -- max is exactly 6.
 *                  Designed to be used with a shared per-block scale
 *                  factor in practice, not as a freestanding format; this
 *                  file rounds a single value to it, no scaling applied.
 * @principle "Interface Polymorphism" -- extend the name everyone already
 *   knows when the extension is fully backward-compatible; build a new
 *   object only when the native contract genuinely cannot be replicated
 *   (SharedArrayBufferX's internal-slot problem is the case where a new
 *   object is required -- Math.fround has no such constraint).
 * @example Math.fround(1.23456789); // unchanged native F32 behavior
 * @example Math.fround(1.23456789, MathPrecision.PRECISION.F16);
 * @example Math.fround(1000, MathPrecision.PRECISION.F8_E4M3); // 448 -- saturates, no Inf
 */
(function (root, factory)
{
  if (typeof module === 'object' && module.exports)
  {
    module.exports = factory(typeof Math !== 'undefined' ? Math : undefined);
  }
  else if (typeof define === 'function' && define.amd)
  {
    define([], function () { return factory(Math); });
  }
  else
  {
    root.MathPrecision = factory(Math);
  }
}(typeof self !== 'undefined' ? self : this, function (MathGlobal)
{
  'use strict';

  const PRECISION = Object.freeze({
    F32: 'f32',
    F16: 'f16',
    F8_E4M3: 'f8e4m3',
    F8_E5M2: 'f8e5m2',
    F4_E2M1: 'f4e2m1',
  });

  const FORMATS = Object.freeze({
    [PRECISION.F16]: { expBits: 5, manBits: 10, hasInf: true, maxFiniteOverride: null },
    [PRECISION.F8_E4M3]: { expBits: 4, manBits: 3, hasInf: false, maxFiniteOverride: 448 },
    [PRECISION.F8_E5M2]: { expBits: 5, manBits: 2, hasInf: true, maxFiniteOverride: null },
    [PRECISION.F4_E2M1]: { expBits: 2, manBits: 1, hasInf: false, maxFiniteOverride: null },
  });

  /**
   * Round-to-nearest quantization of a double to a (signBit=1, expBits,
   * manBits) float format. Correct for standard IEEE-style formats
   * (hasInf=true: top exponent field reserved for Inf/NaN) and for
   * OCP-style finite/"FN" formats (hasInf=false: the top exponent field
   * is used for additional finite range instead). maxFiniteOverride
   * exists solely for F8_E4M3's single-reserved-NaN-pattern quirk, which
   * the generic formula cannot express (see file header).
   * @param {number} x
   * @param {number} expBits
   * @param {number} manBits
   * @param {boolean} hasInf
   * @param {number|null} maxFiniteOverride
   * @returns {number}
   */
  function quantizeFloat(x, expBits, manBits, hasInf, maxFiniteOverride)
  {
    if (typeof x !== 'number')
    {
      throw new TypeError('MathPrecision: value must be a number');
    }
    if (Number.isNaN(x))
    {
      return NaN;
    }
    if (x === 0)
    {
      return x; // preserves signed zero (+0 vs -0)
    }

    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x);
    const bias = Math.pow(2, expBits - 1) - 1;
    const maxExpField = Math.pow(2, expBits) - 1;
    const minNormalExp = 1 - bias;
    const maxNormalExp = (hasInf ? maxExpField - 1 : maxExpField) - bias;
    const genericMaxFinite = (2 - Math.pow(2, -manBits)) * Math.pow(2, maxNormalExp);
    const maxFinite = maxFiniteOverride !== null && maxFiniteOverride !== undefined ? maxFiniteOverride : genericMaxFinite;

    if (!Number.isFinite(absX))
    {
      return hasInf ? sign * Infinity : sign * maxFinite;
    }

    // Round-half-up at the boundary decides overflow before computing e,
    // so a value that rounds UP into the next (unrepresentable) exponent
    // saturates/overflows rather than silently landing one ULP past maxFinite.
    if (absX >= maxFinite + Math.pow(2, maxNormalExp - manBits - 1))
    {
      return hasInf ? sign * Infinity : sign * maxFinite;
    }

    let e = Math.floor(Math.log2(absX));
    // Math.log2 can be off by one at exact powers of two due to floating-point error.
    if (Math.pow(2, e) > absX)
    {
      e -= 1;
    }
    while (Math.pow(2, e + 1) <= absX)
    {
      e += 1;
    }

    const clampedExp = Math.max(minNormalExp, Math.min(e, maxNormalExp));
    const unit = Math.pow(2, clampedExp - manBits);
    let result = Math.round(absX / unit) * unit;

    if (result > maxFinite)
    {
      result = hasInf ? Infinity : maxFinite;
    }
    return sign * (result === Infinity ? Infinity : result);
  }

  /**
   * @param {number} x
   * @param {string} type one of PRECISION's values; omitted/F32 delegates to native fround
   * @returns {number}
   */
  function quantize(x, type)
  {
    if (type === undefined || type === PRECISION.F32)
    {
      return _nativeFround(x);
    }
    const format = FORMATS[type];
    if (!format)
    {
      throw new TypeError('MathPrecision: unknown precision type "' + type + '"');
    }
    return quantizeFloat(x, format.expBits, format.manBits, format.hasInf, format.maxFiniteOverride);
  }

  // ─── Extend the real, global Math.fround ──────────────────────────
  const _nativeFround = MathGlobal.fround;
  if (!MathGlobal.fround.__precisionAware)
  {
    const extended = function fround(x, type)
    {
      return quantize(x, type);
    };
    extended.__precisionAware = true;
    extended.__native = _nativeFround;
    MathGlobal.fround = extended;
  }

  return {
    name: 'MathPrecision',
    author: 'Will Fobbs',
    version: '1.0.0',
    description: 'Extends the global Math.fround(x, type) with F16/F8_E4M3/F8_E5M2/F4_E2M1, backward-compatible when type is omitted.',
    docs: ['research/lib/chain/docs/MathPrecision.md'],
    tests: ['research/lib/chain/tests/MathPrecision.unit.js'],
    config_default: { defaultType: undefined },
    PRECISION,
    FORMATS,
    quantize,
    quantizeFloat,
  };
}));
