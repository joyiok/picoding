import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { terminalInput, type TerminalOutput } from '../shared/terminal.js';
import { TaskTerminal } from './terminal.js';
import { socketHeartbeat } from '../server/socket-heartbeat.js';

export class TerminalSockets {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: 65_536 });
  private terminal?: TaskTerminal;
  private readonly pending = new Map<WebSocket, number>();
  constructor(readonly root: string) {
    socketHeartbeat(this.server);
    this.server.on('connection', client => this.connect(client));
  }
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    this.server.handleUpgrade(request, socket, head, client => this.server.emit('connection', client, request));
  }
  private send(client: WebSocket, event: TerminalOutput) {
    if (client.readyState !== WebSocket.OPEN) return;
    if (client.bufferedAmount > 524_288) { client.close(1013, '终端输出过快，请重新连接'); return; }
    if (event.type === 'data' || event.type === 'snapshot') this.pending.set(client, (this.pending.get(client) || 0) + event.data.length);
    client.send(JSON.stringify(event));
  }
  private broadcast(event: TerminalOutput) { for (const client of this.server.clients) this.send(client, event); this.flow(); }
  private flow() { this.terminal?.pauseOutput([...this.pending.values()].some(count => count > 131_072)); }
  private create() {
    const terminal = new TaskTerminal(this.root); this.terminal = terminal;
    terminal.on('data', (data: string) => this.broadcast({ type: 'data', data }));
    terminal.on('exit', (code: number | null) => this.broadcast({ type: 'exit', code }));
    terminal.on('fault', (message: string) => this.broadcast({ type: 'error', message }));
    for (const client of this.server.clients) this.send(client, { type: 'snapshot', data: '' });
    terminal.start();
    return terminal;
  }
  private connect(client: WebSocket) {
    const terminal = !this.terminal || this.terminal.exited ? this.create() : this.terminal;
    this.send(client, { type: 'snapshot', data: terminal.snapshot }); this.flow();
    client.on('message', (raw, binary) => {
      try {
        if (binary) throw new Error('终端消息必须是文本');
        const message = terminalInput(JSON.parse(raw.toString()));
        if (message.type === 'ack') {
          this.pending.set(client, Math.max(0, (this.pending.get(client) || 0) - message.count)); this.flow();
        } else this.terminal!.send(message);
      } catch (error) { this.send(client, { type: 'error', message: error instanceof Error ? error.message : '终端输入无效' }); }
    });
    client.on('error', () => client.terminate());
    client.on('close', () => { this.pending.delete(client); this.flow(); });
  }
  suspend() { return this.terminal?.suspend() || Promise.resolve(); }
  async close() {
    for (const client of this.server.clients) client.terminate();
    this.server.close(); await this.terminal?.close();
  }
}
