/**
 * @file Environment.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Machine-end "read environment" step (Kernel-Machine-Architecture.md
 *   boot sequence, step 3): what BIOS has no way to know without asking the
 *   host runtime. In-browser, pulled from navigator; in Node, from process/os.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.Environment = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('Environment requires BaseClassX to be loaded first');

  class Environment extends BaseClassX {
    static version = '1.0.0';
    static domain = 'machine.environment';
    static _schema = { properties: {
      runtime: { type: 'string', default: 'unknown' },
      platform: { type: 'string', default: '' },
      userAgent: { type: 'string', default: '' },
      language: { type: 'string', default: '' },
      timezoneOffsetMin: { type: 'number', default: 0 },
      cores: { type: 'number', default: 1 },
      deviceMemoryGB: { type: 'number', default: 0 },
      online: { type: 'boolean', default: true },
      nodeVersion: { type: 'string', default: '' },
      detectedAt: { type: 'number', default: 0 }
    }};

    constructor(options = {}) {
      super({ type: 'machine.environment', name: 'Environment' });
      this.runtime = options.runtime || 'unknown';
      this.platform = options.platform || '';
      this.userAgent = options.userAgent || '';
      this.language = options.language || '';
      this.timezoneOffsetMin = options.timezoneOffsetMin || 0;
      this.cores = options.cores || 1;
      this.deviceMemoryGB = options.deviceMemoryGB || 0;
      this.online = options.online !== undefined ? options.online : true;
      this.nodeVersion = options.nodeVersion || '';
      this.detectedAt = options.detectedAt || Date.now();
    }

    static detect() {
      if (typeof navigator !== 'undefined') {
        return new Environment({
          runtime: typeof window !== 'undefined' ? 'browser' : 'worker',
          platform: navigator.platform || '',
          userAgent: navigator.userAgent || '',
          language: navigator.language || '',
          timezoneOffsetMin: new Date().getTimezoneOffset(),
          cores: navigator.hardwareConcurrency || 1,
          deviceMemoryGB: navigator.deviceMemory || 0,
          online: navigator.onLine !== undefined ? navigator.onLine : true
        });
      }
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        var os = null;
        try { os = require('os'); } catch (e) {}
        return new Environment({
          runtime: 'node',
          platform: process.platform || '',
          nodeVersion: process.version || '',
          cores: os ? os.cpus().length : 1,
          deviceMemoryGB: os ? Math.round(os.totalmem() / Math.pow(1024, 3)) : 0,
          timezoneOffsetMin: new Date().getTimezoneOffset(),
          online: true
        });
      }
      return new Environment();
    }
  }

  return Environment;
}));
