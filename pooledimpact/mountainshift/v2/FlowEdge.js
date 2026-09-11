/**
 * @file FlowEdge.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Typed/weighted/provenance-tracked edge between two FlowEntity
 *              instances (Flow Architecture Guide 2.2 "Edge Table"). Wraps
 *              BaseClassX's existing linkTo()/unlinkFrom() graph primitive —
 *              does not reimplement graph storage. A FlowEdge is itself a
 *              FlowEntity-adjacent record (its own BaseClassX instance) so it
 *              carries the same trace/fingerprint/history guarantees as any
 *              other node, per the Architecture Guide's requirement that
 *              provenance be a first-class, auditable field on every edge.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './FieldACL.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./FieldACL.js'));
  else root.FlowEdge = factory(root.BaseClassX, root.FieldACL);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, FieldACL) {
  'use strict';
  if (!BaseClassX) throw new Error('FlowEdge requires BaseClassX to be loaded first');

  class FlowEdge extends BaseClassX {
    static version = '1.0.0';
    static domain = 'flow.edge';
    static _schema = { properties: {
      edgeType: { type: 'string', default: '' },        // e.g. 'invests_in', 'hosts_compute', 'supplies_fuel', 'financed_by', 'advises'
      sourceEntityId: { type: 'string', default: '' },
      targetEntityId: { type: 'string', default: '' },
      weight: { type: 'number', default: 1 },
      ephemeral: { type: 'boolean', default: false },
      decayRate: { type: 'number', default: 0 },
      properties: { type: 'object', default: {} },
      provenance: { type: 'object', default: {} }        // { assertedBy, assertedAt, confidence, evidenceUrl, reasoning } — per Architecture Guide 2.2
    }};

    static _fieldACL = {
      edgeType: FieldACL.build({ owner: 'rw-', group: 'r--', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'REQUIRED', 'IMMUTABLE_AFTER_CREATE'] }),
      sourceEntityId: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['IMMUTABLE_AFTER_CREATE'] }),
      targetEntityId: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['IMMUTABLE_AFTER_CREATE'] }),
      weight: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: [] }),
      ephemeral: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      decayRate: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      properties: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: [] }),
      provenance: FieldACL.build({ owner: 'r--', group: 'r--', other: 'r--', flags: ['IMMUTABLE_AFTER_CREATE'] })
    };

    constructor(options = {}) {
      super({
        type: 'flow.edge.' + (options.edgeType || 'unknown'), name: options.name || (options.edgeType || 'edge'),
        schema: { edgeType: 'string', sourceEntityId: 'string', targetEntityId: 'string', weight: 'number', ephemeral: 'boolean', decayRate: 'number', properties: 'object', provenance: 'object' }
      });
      this.edgeType = options.edgeType || '';
      this.sourceEntityId = options.sourceEntityId || '';
      this.targetEntityId = options.targetEntityId || '';
      this.weight = options.weight ?? 1;
      this.ephemeral = !!options.ephemeral;
      this.decayRate = options.decayRate ?? 0;
      this.properties = options.properties || {};
      this.provenance = options.provenance || {};
    }

    /** Creates this edge AND wires the real BaseClassX graph primitive
     * (linkTo) between the two live instances, so RelationalProjection's
     * inEdges()/outEdges()/transitiveReferences() see it too \u2014 the
     * FlowEdge record and the underlying graph link never drift apart. */
    static connect(sourceInstance, targetInstance, edgeType, opts = {}) {
      const edge = new FlowEdge({
        edgeType, sourceEntityId: sourceInstance.id, targetEntityId: targetInstance.id,
        weight: opts.weight, ephemeral: opts.ephemeral, decayRate: opts.decayRate,
        properties: opts.properties, provenance: opts.provenance
      });
      sourceInstance.linkTo(targetInstance, edgeType);
      return edge;
    }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        edgeType: this.edgeType, sourceEntityId: this.sourceEntityId, targetEntityId: this.targetEntityId,
        weight: this.weight, ephemeral: this.ephemeral, decayRate: this.decayRate,
        properties: this.properties, provenance: this.provenance
      });
    }

    static fromJSON(data) { return new FlowEdge(data); }
  }

  return FlowEdge;
}));
