/**
 * @file FieldACL.js
 * @author Will Fobbs, Pooled Impact
 * @version 1.0.0
 * @description Per-field access-control descriptor — POSIX-inspired
 *              permission bits plus config flags, packed into a fixed
 *              16-byte (128-bit) value per schema field.
 *
 *              Subjects are REAL per-record ownership, not viewpoint
 *              roles:
 *                owner = the record's actual creator (instance.createdBy)
 *                group = the acting user's department/role matches the
 *                        record's own department/role association
 *                other = neither of the above
 *
 *              Byte layout (LSB-first bit numbering within each byte):
 *                Byte  0   — permission bits, bits 0-8 used:
 *                  bit 0: other-x   bit 1: other-w   bit 2: other-r
 *                  bit 3: group-x   bit 4: group-w   bit 5: group-r
 *                  bit 6: owner-x   bit 7: owner-w
 *                Byte  1   — bit 0: owner-r, bits 1-7 reserved (perm region)
 *                Bytes 2-3 — config flags (16 bits, 5 used):
 *                  bit 0 (=16): VISIBLE_COMPACT
 *                  bit 1 (=17): SORTABLE
 *                  bit 2 (=18): SEARCHABLE
 *                  bit 3 (=19): REQUIRED
 *                  bit 4 (=20): IMMUTABLE_AFTER_CREATE
 *                  bits 5-15 (=21-31): reserved for future flags
 *                Bytes 4-15 — reserved (12 bytes / 96 bits) for future
 *                  use (extended ACL entries, schema versioning, per-org
 *                  custom flags). Always zeroed by this version.
 *
 *              "Execute" on a field has no filesystem meaning here; it is
 *              repurposed as COMPUTED/DERIVED — a field with x set is
 *              produced by a method (e.g. PayrollRecord.totalCostToOrg()),
 *              never directly writable regardless of the w bit. No field
 *              in the current schemas sets x yet; the bit exists for that
 *              purpose when a report/CRUD form needs to distinguish a
 *              stored value from a computed one.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FieldACL = factory();
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  const CONFIG_BITS = {
    VISIBLE_COMPACT: 0,
    SORTABLE: 1,
    SEARCHABLE: 2,
    REQUIRED: 3,
    IMMUTABLE_AFTER_CREATE: 4
  };
  const PERM_BIT = {
    'other-x': 0, 'other-w': 1, 'other-r': 2,
    'group-x': 3, 'group-w': 4, 'group-r': 5,
    'owner-x': 6, 'owner-w': 7, 'owner-r': 8
  };

  class FieldACL {
    constructor(bytes) {
      this.bytes = bytes || new Uint8Array(16); // 16 bytes = 128 bits, fixed
    }

    _getBit(bitIndex) {
      const byteIdx = bitIndex >> 3, bitInByte = bitIndex & 7;
      return (this.bytes[byteIdx] >> bitInByte) & 1;
    }
    _setBit(bitIndex, on) {
      const byteIdx = bitIndex >> 3, bitInByte = bitIndex & 7;
      if (on) this.bytes[byteIdx] |= (1 << bitInByte);
      else this.bytes[byteIdx] &= ~(1 << bitInByte);
      return this;
    }

    setPerm(subject, perm, on) { return this._setBit(PERM_BIT[`${subject}-${perm}`], on); }
    hasPerm(subject, perm) { return !!this._getBit(PERM_BIT[`${subject}-${perm}`]); }
    setFlag(name, on) { return this._setBit(16 + CONFIG_BITS[name], on); }
    hasFlag(name) { return !!this._getBit(16 + CONFIG_BITS[name]); }

    /** subject must already be resolved by the caller — 'owner'|'group'|'other'. */
    can(subject, perm) { return this.hasPerm(subject, perm); }

    toHex() { return [...this.bytes].map(b => b.toString(16).padStart(2, '0')).join(''); }
    static fromHex(hex) {
      const bytes = new Uint8Array(16);
      for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16) || 0;
      return new FieldACL(bytes);
    }

    /** Convenience builder: chmod-style 'rwx'/'r--' triads (owner/group/other) + a flags array. */
    static build({ owner = '---', group = '---', other = '---', flags = [] } = {}) {
      const acl = new FieldACL();
      const apply = (subject, triad) => {
        acl.setPerm(subject, 'r', triad[0] === 'r');
        acl.setPerm(subject, 'w', triad[1] === 'w');
        acl.setPerm(subject, 'x', triad[2] === 'x');
      };
      apply('owner', owner); apply('group', group); apply('other', other);
      flags.forEach(f => acl.setFlag(f, true));
      return acl;
    }

    /** Resolve which subject `session` is, for `instance`. */
    static resolveSubject(instance, session) {
      if (!session) return 'other';
      if (instance && instance.createdBy && instance.createdBy === session.staffId) return 'owner';
      const recordDept = instance ? (instance.department || instance.roleTitle || null) : null;
      if (recordDept && session.department && recordDept === session.department) return 'group';
      return 'other';
    }
  }

  FieldACL.CONFIG_BITS = CONFIG_BITS;
  FieldACL.PERM_BIT = PERM_BIT;
  return FieldACL;
}));
