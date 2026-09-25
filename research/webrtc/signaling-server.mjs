import { WebSocketServer } from 'ws';

export function startSignalingServer(port = 0) {
  const wss = new WebSocketServer({ port });
  const rooms = new Map();               // room -> Set<ws>
  const seen = { offer: 0, answer: 0, ice: 0 };  // proof the relay actually carried traffic

  wss.on('connection', (ws) => {
    ws.on('message', (buf) => {
      let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (msg.type === 'join') {
        ws._room = msg.room; ws._peer = msg.peer;
        if (!rooms.has(msg.room)) rooms.set(msg.room, new Set());
        rooms.get(msg.room).add(ws);
        return;
      }
      if (seen[msg.type] !== undefined) seen[msg.type]++;
      // relay to every OTHER peer in the same room
      const peers = rooms.get(ws._room);
      if (peers) for (const p of peers) if (p !== ws && p.readyState === 1) p.send(buf.toString());
    });
    ws.on('close', () => { const s = rooms.get(ws._room); if (s) s.delete(ws); });
  });

  return new Promise((resolve) => {
    wss.on('listening', () => resolve({
      port: wss.address().port,
      stats: () => ({ ...seen }),
      close: () => wss.close()
    }));
  });
}
