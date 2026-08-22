/**
 * @file WorkLedger.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description The "Work" leg of the Compute/Work/Capital simulation triad. Real project
 *              tasks (Fund build-out milestones, code commits/features shipped, project tasks
 *              completed) are logged here as completedTasks — each one feeds CVCEngine.recordWork
 *              as real units, not a synthetic task generator. Nothing here fabricates work;
 *              it's a ledger of tasks the user/team actually marks done.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.WorkLedger = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('WorkLedger requires BaseClassX to be loaded first');

  class WorkLedger extends BaseClassX {
    static version = '1.0.0';
    static _schema = {
      properties: {
        actorId: { type: 'string', default: '' },
        category: { type: 'string', default: '' }, // 'fund_buildout' | 'code' | 'project_task'
        completedTasks: { type: 'array', default: () => [] } // { taskName, units, qualityScore, complexityMultiplier, completedAt }
      }
    };

    constructor(options = {}) {
      super({ type: 'cvc.work_ledger', name: 'WorkLedger', ...options });
      this.actorId = options.actorId || '';
      this.category = options.category || '';
      this.completedTasks = options.completedTasks || [];
    }

    // Logs a real completed task. units/qualityScore/complexityMultiplier are the caller's own
    // honest assessment of the work (e.g. 1 task = 1 unit, quality 0-1 self/peer-reviewed) \u2014
    // this ledger doesn't invent a scoring formula, it just records what's reported and hands
    // it to CVCEngine.recordWork verbatim.
    logTask(taskName, units, qualityScore, complexityMultiplier) {
      const entry = { taskName, units, qualityScore: Math.max(0, Math.min(1, qualityScore)), complexityMultiplier: complexityMultiplier || 1, completedAt: Date.now() };
      this.completedTasks = [...this.completedTasks, entry];
      return entry;
    }

    totalUnits() {
      return this.completedTasks.reduce((sum, t) => sum + t.units, 0);
    }
  }

  return WorkLedger;
}));
