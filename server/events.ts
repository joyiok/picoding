import type { ServerResponse } from 'node:http';
import type { EventEnvelope, TaskEvent } from '../shared/types.js';

export class EventHub {
  private subscribers = new Map<string, Set<ServerResponse>>();
  private history = new Map<string, EventEnvelope[]>();
  private sequence = 0;

  publish(taskId: string, event: TaskEvent) {
    const item = { sequence: ++this.sequence, event };
    const entries = this.history.get(taskId) || [];
    entries.push(item);
    if (entries.length > 400) entries.shift();
    this.history.set(taskId, entries);
    for (const subscriber of this.subscribers.get(taskId) || []) {
      if (!subscriber.destroyed) subscriber.write(this.frame(item));
    }
  }

  subscribe(taskId: string, response: ServerResponse, snapshot: TaskEvent) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    response.write(this.frame({ sequence: this.sequence, event: snapshot }));
    const subscribers = this.subscribers.get(taskId) || new Set();
    subscribers.add(response);
    this.subscribers.set(taskId, subscribers);
    const heartbeat = setInterval(() => { if (!response.destroyed) response.write(': heartbeat\n\n'); }, 15_000);
    response.on('close', () => { clearInterval(heartbeat); subscribers.delete(response); });
  }

  private frame(item: EventEnvelope) { return `id: ${item.sequence}\ndata: ${JSON.stringify(item)}\n\n`; }

  close() {
    for (const group of this.subscribers.values()) for (const response of group) response.end();
    this.subscribers.clear();
  }
}
