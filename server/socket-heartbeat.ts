import type { WebSocket, WebSocketServer } from 'ws';

export function socketHeartbeat(server: WebSocketServer) {
  const alive = new WeakSet<WebSocket>();
  server.on('connection', client => { alive.add(client); client.on('pong', () => alive.add(client)); });
  const timer = setInterval(() => {
    for (const client of server.clients) {
      if (!alive.has(client)) client.terminate();
      else { alive.delete(client); client.ping(); }
    }
  }, 30_000);
  timer.unref(); server.on('close', () => clearInterval(timer));
}
