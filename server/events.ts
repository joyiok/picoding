import type { ServerResponse } from 'node:http';
import type { EventEnvelope, TaskEvent } from '../shared/types.js';

export class EventHub {
  private listeners = new Map<string, Set<(event: TaskEvent) => void>>();
  private subscribers = new Map<string, Set<ServerResponse>>();
  private sequence = 0;

  publish(taskId: string, event: TaskEvent) {
    for (const listener of this.listeners.get(taskId) || []) listener(event);
    const item = { sequence: ++this.sequence, event };
    for (const subscriber of this.subscribers.get(taskId) || []) {
      if (!subscriber.destroyed) subscriber.write(this.frame(item));
    }
  }

  listen(taskId: string, listener: (event: TaskEvent) => void) {
    const group = this.listeners.get(taskId) || new Set();
    group.add(listener); this.listeners.set(taskId, group);
    return () => { group.delete(listener); if (!group.size && this.listeners.get(taskId) === group) this.listeners.delete(taskId); };
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
    response.on('close', () => {
      clearInterval(heartbeat); subscribers.delete(response);
      if (!subscribers.size && this.subscribers.get(taskId) === subscribers) this.subscribers.delete(taskId);
    });
  }

  private frame(item: EventEnvelope) { return `id: ${item.sequence}\ndata: ${JSON.stringify(item)}\n\n`; }

  forget(taskId: string) {
    for (const response of this.subscribers.get(taskId) || []) response.end();
    this.subscribers.delete(taskId); this.listeners.delete(taskId);
  }

  close() {
    for (const group of this.subscribers.values()) for (const response of group) response.end();
    this.subscribers.clear();
    this.listeners.clear();
  }
}
