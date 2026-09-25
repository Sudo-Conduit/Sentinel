# MSOS WebRTC transport

Machine-to-machine data-channel transport for MountainShiftOS federation
(roadmap D.2/D.3). Carries **POPCNT-encrypted** payloads over a **DTLS-encrypted**
WebRTC data channel — double-encrypted: the transport protects the link, the
app-layer POPCNT key (pre-shared between machines, never held by any relay)
protects the payload even from a TURN relay or a compromised signaling path.

```
peer A ──[ PopcntUnicode.encode ]──▶ ciphertext ─▶ RTCPeerConnection data channel
        (SCTP over DTLS) ─▶ peer B ──[ PopcntUnicode.decode, same key ]──▶ plaintext
```

## Files

- `signaling-server.mjs` — WebSocket signaling relay. Peers `join` a room; the
  server relays `offer`/`answer`/`ice` between them. This is the bootstrap
  channel WebRTC requires (and the MITM surface that peer-identity pinning —
  Ed25519, future — will harden).
- `webrtc-transport.js` — browser-side `WebRTCTransport`: real
  `RTCPeerConnection` over the signaling channel, `iceServers` configurable for
  STUN/TURN. `connect()` / `send()` / `onMessage()`; tallies ICE candidate types.
- `ice-config.example.js` — STUN + TURN config, including **TURN over TCP/TLS on
  443** for networks that allow only http(s).
- `test.mjs` — end-to-end test: two independent Chromium contexts (two real
  peers) connect through the real signaling server and exchange a POPCNT payload.

## Test (`npm test`)

Needs `playwright-core` + a Chromium binary (`CHROMIUM_PATH` to override the
default path). Two separate browser contexts = two independent peers.

Validated here (single machine):
- real WebSocket signaling actually relaying offer/answer/ICE,
- real ICE negotiation (host candidates) + real DTLS data channel,
- ciphertext-only on the wire, exact POPCNT round-trip on the far peer.

**Not** validated here (needs ≥2 machines on different networks): external STUN
reachability (server-reflexive candidates), TURN relay, real NAT traversal, and
peer identity/auth. The single container has no UDP path out and can't drive a
second browser.

## Two-machine runbook (the real cross-network test)

1. **Host the signaling server** somewhere both machines can reach, over `wss://`
   on 443 (put it behind TLS; a bare `ws://` won't load from an https page).
2. **Host coturn** with TLS on 443 and set credentials; expose
   `turns:YOUR_HOST:443?transport=tcp` (plus `stun:YOUR_HOST:3478`). Self-hosted
   keeps the relay under your control — no third-party relay ever holds the link.
3. **Point `iceServers`** at them (see `ice-config.example.js`).
4. **Open the peer page in two browsers on two networks** (e.g. this machine and
   yours). They discover candidates via STUN, connect directly if NAT allows,
   fall back to TURN/443 if not, and the POPCNT payload crosses — ciphertext on
   the wire the whole way.

The key stays machine-level and pre-shared (future: from the MemoryMap arena);
the relay and signaling server never see it, so even a fully-compromised relay
yields only POPCNT ciphertext.
