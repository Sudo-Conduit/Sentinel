/**
 * @file research/lib/chain/Torus.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description A p x q torus is a projection of an already-unity-normalized
 *              system, not a data-owning node in the chain. Any source that
 *              can be represented as 1 -- a probability distribution, a
 *              normalized Hilbert state (||psi||=1), a full revolution
 *              (t in [0,1)), a plain linear-algebra Tensor -- subdivides
 *              into p*q equal parts arranged on the same grid, regardless
 *              of which system produced the 1. This file never normalizes
 *              anything itself: normalization is the caller's job (via
 *              whatever is domain-appropriate -- Hilbert.normalize(),
 *              dividing by a sum, wrap()), and project() only ever accepts
 *              an already-unity source. That is a deliberate encapsulation
 *              boundary, not an oversight -- staying dumb here is what
 *              keeps this reusable across systems that have nothing else
 *              in common (Unix philosophy: composability over cleverness).
 *
 *              p and q need not be coprime, but componentCount(p,q) =
 *              gcd(p,q) tells you up front what you get if they aren't:
 *              gcd=1 means a single connected p*q-point structure (the
 *              diagonal (row+1 mod p, col+1 mod q) walk visits every point
 *              exactly once, by the CRT isomorphism ZZ/p x ZZ/q = ZZ/pq);
 *              gcd>1 means that same walk splits into gcd(p,q) disjoint
 *              cycles instead of covering all p*q points.
 *
 *              9x8 is this system's own named instance -- chosen because
 *              8=2^3 and 9=3^2 are the unique pair of consecutive nontrivial
 *              perfect powers in the integers (Catalan's conjecture,
 *              proved by Mihailescu, 2002) -- not because the class
 *              requires whole numbers or requires 9 and 8 specifically.
 *              Another system picks its own (p,q) and gets the identical
 *              machinery.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example const t98 = new Torus().init({ p: 9, q: 8 });
 * @example t98.componentCount(); // 1 -- gcd(9,8), a single connected strip
 * @example t98.project(normalizedFlatArrayOf72Numbers); // {data, shape:[9,8], nested}
 * @example Torus.wrap(1.25); // 0.25 -- t=0 and t=1 are the same point (empty === infinity)
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
    root.Chain.Torus = factory();
  }
}(typeof self !== 'undefined' ? self : this, function ()
{
  'use strict';

  /** @param {number} a @param {number} b @returns {number} gcd(|a|,|b|), Euclidean algorithm */
  function gcd(a, b)
  {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b !== 0)
    {
      const t = b;
      b = a % b;
      a = t;
    }
    return a;
  }

  /** @param {number} t @returns {number} t mod 1, always in [0,1) -- the point where t=0 and t=1 coincide */
  function wrap(t)
  {
    let x = t % 1;
    if (x < 0)
    {
      x += 1;
    }
    return x;
  }

  /** @param {number} a @param {number} b @returns {number} shortest circular distance in [0,1) parameter space, always in [0,0.5] */
  function circDist(a, b)
  {
    const r = Math.abs(wrap(a) - wrap(b));
    return Math.min(r, 1 - r);
  }

  /** @param {number} from @param {number} to @returns {number} signed shortest direction from `from` to `to` around the circle, in [-0.5,0.5] */
  function shortestDir(from, to)
  {
    let d = wrap(to) - wrap(from);
    if (d > 0.5)
    {
      d -= 1;
    }
    if (d < -0.5)
    {
      d += 1;
    }
    return d;
  }

  /** @param {number} i flat index @param {number} q @returns {number} row = floor(i/q) */
  function row(i, q)
  {
    return Math.floor(i / q);
  }

  /** @param {number} i flat index @param {number} q @returns {number} col = i mod q */
  function col(i, q)
  {
    return i % q;
  }

  /** @param {number} r @param {number} c @param {number} q @returns {number} flat index = r*q + c */
  function index(r, c, q)
  {
    return r * q + c;
  }

  /** @param {number} p @param {number} q @returns {number} gcd(p,q) -- number of disjoint components the diagonal walk splits into (1 = single connected p*q-point structure) */
  function componentCount(p, q)
  {
    return gcd(p, q);
  }

  /**
   * Extracts a flat buffer from any source: a Tensor-like object exposing
   * .toFlat().data, a plain array, or an object exposing .data directly.
   * No normalization, no interpretation -- just enough duck-typing to
   * accept the shapes the rest of this chain already produces.
   * @param {*} source
   * @returns {Array} flat buffer
   */
  function extractFlat(source)
  {
    if (Array.isArray(source))
    {
      return source;
    }
    if (source && typeof source.toFlat === 'function')
    {
      return source.toFlat().data;
    }
    if (source && Array.isArray(source.data))
    {
      return source.data;
    }
    throw new TypeError('Torus: source must be an array, a Tensor-like object (.toFlat().data), or {data: [...]}');
  }

  /**
   * @param {*} source see extractFlat
   * @param {number} p
   * @param {number} q
   * @returns {{data: Array, shape: number[], nested: Array[]}}
   */
  function project(source, p, q)
  {
    const flat = extractFlat(source);
    if (flat.length !== p * q)
    {
      throw new RangeError('Torus.project: source has ' + flat.length + ' elements, expected p*q = ' + (p * q));
    }
    const nested = new Array(p);
    for (let r = 0; r < p; r++)
    {
      nested[r] = flat.slice(r * q, r * q + q);
    }
    return { data: flat, shape: [p, q], nested };
  }

  class Torus
  {
    static name = 'Torus';
    static author = 'Will Fobbs';
    static version = '1.0.0';
    static description = 'A p x q torus is a projection of an already-unity-normalized system -- not a data-owning node, a stateless lens shared across whichever systems can be represented as 1.';
    static docs = ['research/lib/chain/docs/Torus.md'];
    static tests = ['research/lib/chain/tests/Torus.unit.js'];
    static config_default = { p: 9, q: 8 };

    // Static pure functions -- usable without an instance, for one-off calls.
    static gcd = gcd;
    static wrap = wrap;
    static circDist = circDist;
    static shortestDir = shortestDir;
    static row = row;
    static col = col;
    static index = index;
    static componentCount = componentCount;
    static project = project;

    constructor()
    {
    }

    /**
     * @param {object} opts
     * @param {number} opts.p
     * @param {number} opts.q
     * @returns {Torus} this, for chaining
     */
    init(opts)
    {
      const options = opts || {};
      if (!Number.isInteger(options.p) || options.p <= 0 || !Number.isInteger(options.q) || options.q <= 0)
      {
        throw new TypeError('Torus.init: p and q must be positive integers');
      }
      this.p = options.p;
      this.q = options.q;
      return this;
    }

    /** @param {number} i flat index @returns {number} */
    row(i)
    {
      return row(i, this.q);
    }

    /** @param {number} i flat index @returns {number} */
    col(i)
    {
      return col(i, this.q);
    }

    /** @param {number} r @param {number} c @returns {number} flat index */
    index(r, c)
    {
      return index(r, c, this.q);
    }

    /** @returns {number} gcd(p,q) */
    componentCount()
    {
      return componentCount(this.p, this.q);
    }

    /** @returns {boolean} true iff componentCount()===1 -- a single connected p*q-point diagonal strip */
    isClosed()
    {
      return this.componentCount() === 1;
    }

    /** @param {*} source see extractFlat @returns {{data: Array, shape: number[], nested: Array[]}} */
    project(source)
    {
      return project(source, this.p, this.q);
    }
  }

  return Torus;
}));
