// ICE-server adapters. STUN is discovery-only (reveals public IP:port, never
// sees payload or relays data) -- so public STUN is fine and needs no hosting.
// TURN relays actual traffic + sees metadata, so self-host that. Adapters keep
// the source swappable (Interface Polymorphism): pick per deployment.
(function (root) {
  'use strict';
  var IceAdapters = {
    // Public STUN only. Default for most cases: candidate discovery, no relay.
    'public': function () {
      return [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ];
    },
    // Self-hosted: your STUN + your TURN (relay under your control, incl. 443).
    selfHosted: function (host, turn) {
      var list = [{ urls: 'stun:' + host + ':3478' }];
      if (turn) list.push({
        urls: [
          'turn:' + host + ':3478?transport=udp',
          'turn:' + host + ':443?transport=tcp',
          'turns:' + host + ':443?transport=tcp'
        ],
        username: turn.username,
        credential: turn.credential
      });
      return list;
    },
    // Same-machine / host candidates only (tests).
    none: function () { return []; },

    // Resolve an adapter by name or pass through an explicit array/fn.
    resolve: function (spec, args) {
      if (Array.isArray(spec)) return spec;
      if (typeof spec === 'function') return spec.apply(null, args || []);
      if (typeof spec === 'string' && IceAdapters[spec]) return IceAdapters[spec].apply(null, args || []);
      return [];
    }
  };
  if (typeof module === 'object' && module.exports) module.exports = IceAdapters;
  else root.IceAdapters = IceAdapters;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
