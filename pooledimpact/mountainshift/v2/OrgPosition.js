/**
 * @file OrgPosition.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Leadership org-chart hierarchy, modeled with BaseClassX's
 *              own native tree/parent-child support rather than a flat
 *              reportsTo id — each OrgPosition IS a tree node, so the org
 *              chart is just BaseClassX's tree, walked and rendered.
 *              Distinct from Staff.js (operational/shift-scheduled roles) —
 *              a position can optionally point at the Staff.id filling it.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.OrgPosition = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('OrgPosition requires BaseClassX to be loaded first');

  class OrgPosition extends BaseClassX {
    static version = '1.0.0';
    static domain = 'org.position';
    static _schema = { properties: {
      title: { type: 'string', default: '' },        // e.g. 'Executive Director'
      personName: { type: 'string', default: '' },   // display name from the chart, e.g. 'Katonya Jones'
      staffId: { type: 'string', default: '' },       // '' if not yet linked to an operational Staff record
      estimatedStaffCount: { type: 'number', default: 0 },
      filled: { type: 'boolean', default: true }      // dashed boxes on the chart (e.g. 'Director of Shelters', 'Nurses') = vacant/planned
    }};

    constructor(options = {}) {
      super({
        type: 'org.position',
        name: 'OrgPosition',
        schema: { title: 'string', personName: 'string', staffId: 'string', estimatedStaffCount: 'number', filled: 'boolean' }
      });
      this.title = options.title || '';
      this.personName = options.personName || '';
      this.staffId = options.staffId || '';
      this.estimatedStaffCount = options.estimatedStaffCount || 0;
      this.filled = options.filled !== undefined ? options.filled : true;
    }

    /** Adds a child position under this one using BaseClassX's own tree — no separate reportsTo bookkeeping needed. */
    addReport(position) { this.addChild(position); return position; }

    /** Flattens this node + all descendants into an array — the whole org chart as one query result. */
    flatten() {
      const out = [this];
      (this.children || []).forEach(child => { out.push(...child.flatten()); });
      return out;
    }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        title: this.title, personName: this.personName, staffId: this.staffId,
        estimatedStaffCount: this.estimatedStaffCount, filled: this.filled
      });
    }

    static fromJSON(data) { return new OrgPosition(data); }

    /** Builds the HOPE Shelters chart (Summary View) as one BaseClassX tree. */
    static buildHopeSheltersChart() {
      const board = new OrgPosition({ title: 'ECDC Board of Directors' });
      const president = new OrgPosition({ title: 'President', personName: 'Hugh Daniel Smith' });
      board.addReport(president);
      const ed = new OrgPosition({ title: 'Executive Director', personName: 'Katonya Jones' });
      president.addReport(ed);
      const dataQuality = new OrgPosition({ title: 'Director of Data Quality', personName: 'Tracy Mulvany' });
      const coo = new OrgPosition({ title: 'Chief Operating Officer', personName: 'Natalee Hessell' });
      ed.addReport(dataQuality);
      ed.addReport(coo);
      const dirShelters = new OrgPosition({ title: 'Director of Shelters', filled: false });
      coo.addReport(dirShelters);

      const adultMgr = new OrgPosition({ title: 'Asst. Mgr, Adult Shelter', personName: 'Tina Eden' });
      const leadNav = new OrgPosition({ title: 'Lead Navigator', personName: 'Latosha Beard' });
      const recupMgr = new OrgPosition({ title: 'Asst. Mgr, Recuperative Shelter', personName: 'Jamie Short' });
      dirShelters.addReport(adultMgr);
      dirShelters.addReport(leadNav);
      dirShelters.addReport(recupMgr);

      adultMgr.addReport(new OrgPosition({ title: 'Service Coordinator', estimatedStaffCount: 14 }));
      adultMgr.addReport(new OrgPosition({ title: 'Peer Support', estimatedStaffCount: 0 }));
      leadNav.addReport(new OrgPosition({ title: 'Service Navigator', estimatedStaffCount: 1 }));
      leadNav.addReport(new OrgPosition({ title: 'Service Navigator', estimatedStaffCount: 1 }));
      const nurses = new OrgPosition({ title: 'Nurses', estimatedStaffCount: 1, filled: false });
      recupMgr.addReport(nurses);
      nurses.addReport(new OrgPosition({ title: 'Service Coordinator', estimatedStaffCount: 9 }));

      return board;
    }
  }

  return OrgPosition;
}));
