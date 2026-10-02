import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { terminalInput, type TerminalInput, type TerminalOutput } from '../shared/terminal.js';
import type { Workbench } from './workbench.js';
import { socketHeartbeat } from './socket-heartbeat.js';

export class TerminalBridge {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: 65_536 });
  private readonly remotes = new Set<WebSocket>();
  constructor(readonly workbench: Workbench) { socketHeartbeat(this.server); }
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer, id: string) {
    const sandbox = this.workbench.sandbox(id);
    this.server.handleUpgrade(request, socket, head, client => {
      this.server.emit('connection', client, request);
      const remote = new WebSocket(sandbox.url.replace(/^http/, 'ws') + '/terminal', { headers: { Authorization: 'Bearer ' + sandbox.token }, maxPayload: 1_048_576, handshakeTimeout: 5000 });
      this.remotes.add(remote);
      const send = (event: TerminalOutput) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(event)); };
      const mode = () => send({ type: 'mode', writable: this.workbench.store.get(id).status === 'paused' });
      const unsubscribe = this.workbench.events.listen(id, event => { if (event.type === 'task') mode(); });
      let refresh: ReturnType<typeof setTimeout> | undefined;
      let initialSize: Extract<TerminalInput, { type: 'resize' }> | undefined;
      remote.on('open', () => { mode(); if (initialSize) remote.send(JSON.stringify(initialSize)); });
      remote.on('message', raw => {
        if (client.readyState !== WebSocket.OPEN) return;
        if (client.bufferedAmount > 524_288) { client.close(1013, '终端输出过快，请重新连接'); return; }
        client.send(raw.toString());
        if (!refresh) refresh = setTimeout(() => { refresh = undefined; this.workbench.events.publish(id, { type: 'files_changed' }); }, 500);
      });
      remote.on('error', () => { send({ type: 'error', message: '终端连接失败，请重新连接或重启任务环境' }); client.close(1011); });
      remote.on('close', () => { this.remotes.delete(remote); client.close(); });
      client.on('message', (raw, binary) => {
        try {
          if (binary) throw new Error('终端消息必须是文本');
          const input = terminalInput(JSON.parse(raw.toString()));
          if (input.type === 'input' && this.workbench.store.get(id).status !== 'paused') { mode(); throw new Error('请先接管电脑，再向终端输入'); }
          if (remote.readyState === WebSocket.CONNECTING && input.type === 'resize') { initialSize = input; return; }
          if (remote.readyState === WebSocket.CONNECTING && input.type === 'ack') return;
          if (remote.readyState !== WebSocket.OPEN) throw new Error('终端正在连接，请稍后重试');
          if (remote.bufferedAmount > 65_536) throw new Error('终端输入过快，请稍后重试');
          remote.send(JSON.stringify(input));
        } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : '终端输入无效' }); }
      });
      client.on('error', () => client.terminate());
      client.on('close', () => { unsubscribe(); clearTimeout(refresh); remote.terminate(); this.remotes.delete(remote); });
    });
  }
  close() {
    for (const client of this.server.clients) client.terminate();
    for (const remote of this.remotes) remote.terminate();
    this.server.close();
  }
}
