/**
 * @file FlowEntity.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description The single generic node class for the Flow graph (Flow —
 *              Complete Architecture Guide v9, "Entity Table — Generic Node
 *              Store"). Every Fund, Deal, SolarSite, ComputeNodeDeployment,
 *              FuelClient, RealEstateProperty, Lender/ABFProvider, Advisor,
 *              or Scenario is a FlowEntity whose `entityType` is a DATA VALUE
 *              (looked up in FlowTypeRegistry.js), not a hardcoded subclass —
 *              the exact fix the Prior-Take-Reference document called out:
 *              "design the entity schema correctly once and let every
 *              counterparty/asset type fall out of it as data, not
 *              structure."
 *
 *              Edges are NOT reinvented here — BaseClassX already ships the
 *              graph primitive this needs: linkTo()/unlinkFrom() populate
 *              inEdges/outEdges, and RelationalProjection reads them back
 *              (inEdges()/outEdges()/transitiveReferences()). FlowEdge.js
 *              (companion file) is a thin, typed/weighted/provenance wrapper
 *              on TOP of that primitive — matching the Architecture Guide's
 *              `edge` table (type, weight, ephemeral, decay_rate, provenance)
 *              — not a second, competing graph implementation.
 *
 *              `properties` is the flexible per-instance data bag (Architecture
 *              Guide 2.1's `properties ON entity TYPE object`) — this is
 *              intentionally NOT run through _schema/_fieldACL like a fixed
 *              class field would be, because its shape legitimately varies
 *              per entityType (a SolarSite's properties look nothing like a
 *              FuelClient's). FlowTypeRegistry's `expectedProperties` is
 *              informational/validation-hint only, not enforcement — the
 *              generic node stays generic.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './FieldACL.js', './FlowTypeRegistry.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./FieldACL.js'), require('./FlowTypeRegistry.js'));
  else root.FlowEntity = factory(root.BaseClassX, root.FieldACL, root.FlowTypeRegistry);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, FieldACL, FlowTypeRegistry) {
  'use strict';
  if (!BaseClassX) throw new Error('FlowEntity requires BaseClassX to be loaded first');

  class FlowEntity extends BaseClassX {
    static version = '1.0.0';
    static domain = 'flow.entity';
    static _schema = { properties: {
      entityType: { type: 'string', default: '' },     // e.g. 'Fund' | 'Deal' | 'SolarSite' | 'ComputeNodeDeployment' | 'FuelClient' | 'RealEstateProperty' | 'Lender' | 'ABFProvider' | 'Advisor' | 'Scenario' — see FlowTypeRegistry
      properties: { type: 'object', default: {} },      // flexible per-type data bag, shape varies by entityType (not schema-enforced)
      source: { type: 'string', default: '' },          // where this entity was ingested from, if any (e.g. 'manual', 'abf-crm', 'onomo-schema-test')
      sourceId: { type: 'string', default: '' },
      isHedge: { type: 'boolean', default: false }      // explicit hedge vs non-hedge classification (Sleeve C hedge vs a growth/yield investment like a solar farm)
    }};

    static _fieldACL = {
      entityType: FieldACL.build({ owner: 'rw-', group: 'r--', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'SEARCHABLE', 'REQUIRED', 'IMMUTABLE_AFTER_CREATE'] }),
      properties: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: [] }),
      source: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      sourceId: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      isHedge: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE'] })
    };

    constructor(options = {}) {
      const entityType = options.entityType || 'Unknown';
      if (typeof FlowTypeRegistry !== 'undefined' && !FlowTypeRegistry.getType(entityType)) {
        console.warn(`FlowEntity: entityType "${entityType}" is not in FlowTypeRegistry \u2014 allowed anyway (registry is a hint, not enforcement), but consider registering it.`);
      }
      super({
        type: 'flow.entity.' + entityType, name: options.name || entityType,
        schema: { entityType: 'string', properties: 'object', source: 'string', sourceId: 'string', isHedge: 'boolean' }
      });
      this.entityType = entityType;
      this.properties = options.properties || {};
      this.source = options.source || '';
      this.sourceId = options.sourceId || '';
      this.isHedge = !!options.isHedge;
    }

    /** Shorthand accessor into the flexible properties bag. */
    get(key, fallback) { return (key in this.properties) ? this.properties[key] : fallback; }
    set(key, value) { this.properties = { ...this.properties, [key]: value }; return this; }

    /** Registry lookup for this instance's declared type shape (hint only). */
    typeDef() { return (typeof FlowTypeRegistry !== 'undefined') ? FlowTypeRegistry.getType(this.entityType) : null; }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        entityType: this.entityType, properties: this.properties,
        source: this.source, sourceId: this.sourceId, isHedge: this.isHedge
      });
    }

    static fromJSON(data) { return new FlowEntity(data); }
  }

  return FlowEntity;
}));
