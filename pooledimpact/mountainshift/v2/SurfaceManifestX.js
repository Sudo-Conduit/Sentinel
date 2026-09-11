/**
 * @file SurfaceManifestX.js
 * @author Will Fobbs, Pooled Impact
 * @version 1.0.0
 * @description BaseClassX wrapper around a governed surface manifest
 *              (XML + its XSD contract + its XSL transform). Loading a
 *              manifest through this class \u2014 rather than raw
 *              DOMParser/XMLHttpRequest calls scattered in app code \u2014
 *              gives it fingerprinting, version history, and change
 *              trace for free, same as every other BaseClassX-governed
 *              object, so two environments' manifests (e.g. staging vs.
 *              production) can be diffed by fingerprint alone.
 *
 *              XSD validation here is a light, dependency-free structural
 *              check (required attrs present, requiredRole in the allowed
 *              enum) \u2014 a real XSD processor (e.g. server-side libxml2)
 *              should still gate what is accepted at ingestion time in
 *              production; this keeps the browser-side contract honest
 *              without pulling in a full schema engine.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.SurfaceManifestX = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('SurfaceManifestX requires BaseClassX to be loaded first');

  const ALLOWED_ROLES = ['admin', 'payroll-finance', 'case-worker', 'viewer'];

  class SurfaceManifestX extends BaseClassX {
    static version = '1.0.0';
    static domain = 'platform.surfaceManifest';
    static _schema = {
      type: 'surfaceManifest',
      properties: {
        release: { type: 'string', default: '' },
        tier: { type: 'string', default: '' },
        minAppVersion: { type: 'string', default: '' },
        rawXml: { type: 'string', default: '' },
        nav: { type: 'object', default: [] },      // resolved {group,items:[{id,label}]}[] the UI consumes
        validationErrors: { type: 'object', default: [] }
      }
    };

    constructor(options = {}) { super({ type: 'surfaceManifest', ...options }); }

    /** Parses + validates rawXml against the mechanical XSD rules, then flattens it to `nav`. */
    static fromXmlString(xmlText) {
      const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
      const parserError = doc.querySelector('parsererror');
      const errors = [];
      if (parserError) errors.push('XML parse error: ' + parserError.textContent.trim());
      const root = doc.documentElement;
      const manifest = new SurfaceManifestX({
        release: root ? root.getAttribute('release') || '' : '',
        tier: root ? root.getAttribute('tier') || '' : '',
        minAppVersion: root ? root.getAttribute('minAppVersion') || '' : '',
        rawXml: xmlText
      });
      if (root) {
        ['release', 'tier', 'minAppVersion'].forEach(attr => {
          if (!root.getAttribute(attr)) errors.push(`<surfaceManifest> missing required attribute "${attr}"`);
        });
        const groups = [];
        [...root.children].forEach(groupNode => {
          SurfaceManifestX._validateNode(groupNode, errors);
          const items = [...groupNode.children].map(itemNode => {
            SurfaceManifestX._validateNode(itemNode, errors);
            return { id: itemNode.getAttribute('id'), label: itemNode.getAttribute('label') };
          });
          groups.push({ group: groupNode.getAttribute('group'), items });
        });
        manifest.nav = groups;
      }
      manifest.validationErrors = errors;
      return manifest;
    }
    static _validateNode(node, errors) {
      ['id', 'label', 'group', 'requiredRole'].forEach(attr => {
        if (!node.getAttribute(attr)) errors.push(`<node> missing required attribute "${attr}"`);
      });
      const role = node.getAttribute('requiredRole');
      if (role && ALLOWED_ROLES.indexOf(role) === -1) errors.push(`<node id="${node.getAttribute('id')}"> has invalid requiredRole "${role}"`);
    }
    get isValid() { return this.validationErrors.length === 0; }

    /** SHA-256 fingerprint of the raw manifest text, hex-encoded \u2014 diff two
     * environments' manifests by comparing this alone. */
    async fingerprint() {
      const bytes = new TextEncoder().encode(this.rawXml);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
  }

  return SurfaceManifestX;
}));
