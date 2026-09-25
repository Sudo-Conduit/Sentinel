(function (root) {
  'use strict';
  function WebRTCTransport(opts) {
    this.url = opts.url; this.room = opts.room; this.peer = opts.peer;
    this.initiator = !!opts.initiator;
    this.iceServers = opts.iceServers || [];       // [] = host candidates; add STUN/TURN here
    this.candidateTypes = {};                      // host/srflx/relay tally (honesty about ICE)
    this._onmsg = function () {};
  }
  WebRTCTransport.prototype.onMessage = function (cb) { this._onmsg = cb; };
  WebRTCTransport.prototype.send = function (data) { this.dc.send(data); };
  WebRTCTransport.prototype.connect = function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      var ws = new WebSocket(self.url);
      var pc = new RTCPeerConnection({ iceServers: self.iceServers });
      self.pc = pc;
      var opened = function () { resolve({ candidateTypes: self.candidateTypes }); };

      pc.onicecandidate = function (e) {
        if (e.candidate) {
          var t = (e.candidate.candidate.match(/ typ (\w+)/) || [])[1] || 'unknown';
          self.candidateTypes[t] = (self.candidateTypes[t] || 0) + 1;
          ws.send(JSON.stringify({ type: 'ice', candidate: e.candidate }));
        }
      };
      function wireChannel(dc) { self.dc = dc; dc.onopen = opened; dc.onmessage = function (m) { self._onmsg(m.data); }; }
      if (self.initiator) wireChannel(pc.createDataChannel('secure'));
      else pc.ondatachannel = function (e) { wireChannel(e.channel); };

      ws.onopen = function () {
        ws.send(JSON.stringify({ type: 'join', room: self.room, peer: self.peer }));
        if (self.initiator) pc.createOffer().then(function (o) {
          return pc.setLocalDescription(o).then(function () { ws.send(JSON.stringify({ type: 'offer', sdp: o })); });
        });
      };
      ws.onmessage = function (ev) {
        var msg = JSON.parse(ev.data);
        if (msg.type === 'offer') {
          pc.setRemoteDescription(msg.sdp)
            .then(function () { return pc.createAnswer(); })
            .then(function (a) { return pc.setLocalDescription(a).then(function () { ws.send(JSON.stringify({ type: 'answer', sdp: a })); }); });
        } else if (msg.type === 'answer') {
          pc.setRemoteDescription(msg.sdp);
        } else if (msg.type === 'ice') {
          pc.addIceCandidate(msg.candidate).catch(function () {});
        }
      };
      ws.onerror = reject;
    });
  };
  root.WebRTCTransport = WebRTCTransport;
})(typeof window !== 'undefined' ? window : this);
