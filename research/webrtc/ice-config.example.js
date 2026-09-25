// ICE server configuration for real machine-to-machine WebRTC.
//
// In-container / same-machine: iceServers: []  -> host candidates only.
//
// Cross-network: add STUN (candidate discovery) and TURN (relay fallback).
// When a network allows ONLY http/https (port 80/443), the relay that still
// works is TURN over TCP/TLS on 443 -- this is how WebRTC traverses firewalls
// that block UDP. Self-host coturn to keep the relay under your control
// ("machine-level, not cloud").
export const iceServers = [
  { urls: 'stun:YOUR_HOST:3478' },                       // discovery (UDP)
  {                                                       // relay fallback...
    urls: [
      'turn:YOUR_HOST:3478?transport=udp',               // ...UDP if allowed
      'turn:YOUR_HOST:443?transport=tcp',                // ...TCP/443 if UDP blocked
      'turns:YOUR_HOST:443?transport=tcp'                // ...TLS/443 for http(s)-only nets
    ],
    username: 'USER',
    credential: 'SECRET'
  }
];
