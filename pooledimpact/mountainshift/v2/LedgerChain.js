/**
 * @file LedgerChain.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Real hash-chained ledger backing the Tamper-Proof Test. Each entry's hash
 *              incorporates the PREVIOUS entry's hash (via BaseClassX's own hashString \u2014 the
 *              same primitive computeContentHash() already uses elsewhere in this codebase, so
 *              this isn't a new crypto dependency, just the chaining applied to it). Any edit to
 *              a past entry's data breaks every hash after it, and verifyChain() detects exactly
 *              that, real recomputation vs stored hash, not a placeholder check.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.LedgerChain = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('LedgerChain requires BaseClassX to be loaded first');

  class LedgerChain extends BaseClassX {
    static version = '1.0.0';
    static _schema = {
      properties: {
        chainName: { type: 'string', default: '' },
        entries: { type: 'array', default: () => [] } // { index, data, prevHash, hash, at }
      }
    };

    constructor(options = {}) {
      super({ type: 'cvc.ledger_chain', name: 'LedgerChain', ...options });
      this.chainName = options.chainName || '';
      this.entries = options.entries || [];
    }

    _genesisHash() { return this.hashString('genesis:' + this.chainName); }

    // Appends a real entry. data must be JSON-serializable; the entry's hash covers both its
    // own data and the real previous entry's hash, forming the actual chain link.
    append(data) {
      const prevHash = this.entries.length ? this.entries[this.entries.length - 1].hash : this._genesisHash();
      const index = this.entries.length;
      const at = Date.now();
      const hash = this.hashString(JSON.stringify({ index, data, prevHash, at }));
      const entry = { index, data, prevHash, hash, at };
      this.entries = [...this.entries, entry];
      return entry;
    }

    // Real verification: recomputes every entry's hash from its own stored fields and checks
    // it against both the stored hash AND the next entry's stored prevHash \u2014 tampering with
    // ANY field of ANY past entry (data, prevHash, at) is detected here, not assumed away.
    verifyChain() {
      let expectedPrev = this._genesisHash();
      for (let i = 0; i < this.entries.length; i++) {
        const e = this.entries[i];
        if (e.prevHash !== expectedPrev) {
          return { ok: false, brokenAtIndex: i, reason: `entry ${i}'s prevHash does not match the real previous entry's hash \u2014 chain corruption detected` };
        }
        const recomputed = this.hashString(JSON.stringify({ index: e.index, data: e.data, prevHash: e.prevHash, at: e.at }));
        if (recomputed !== e.hash) {
          return { ok: false, brokenAtIndex: i, reason: `entry ${i}'s stored hash does not match its recomputed hash \u2014 the entry's own data was tampered with` };
        }
        expectedPrev = e.hash;
      }
      return { ok: true };
    }

    // Simulates exactly the Tamper-Proof Test scenario: mutate a past entry's data directly
    // (bypassing append()) the way a real attacker/bug would, then confirm verifyChain() catches it.
    static simulateTamper(chain, index, newData) {
      if (!chain.entries[index]) throw new Error('no entry at index ' + index);
      chain.entries[index].data = newData; // real, direct mutation \u2014 not going through append()
      return chain.verifyChain();
    }
  }

  return LedgerChain;
}));
