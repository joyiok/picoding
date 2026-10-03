import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { EventHub } from '../server/events.js';

function response() {
  const output = new EventEmitter() as EventEmitter & { destroyed: boolean; writeHead: () => void; write: (frame: string) => boolean; end: () => void; frames: string[] };
  output.destroyed = false; output.frames = []; output.writeHead = () => {};
  output.write = frame => { output.frames.push(frame); return true; };
  output.end = () => { output.destroyed = true; output.emit('close'); };
  return output;
}

test('reconnected event streams start with a fresh task snapshot', () => {
  const hub = new EventHub(); const first = response(); const second = response();
  hub.subscribe('task', first as unknown as ServerResponse, { type: 'files_changed' });
  hub.publish('task', { type: 'browser', state: { url: 'http://localhost:3000', title: 'Updated', tabs: [] } });
  first.end();
  hub.subscribe('task', second as unknown as ServerResponse, { type: 'browser', state: { url: 'http://localhost:3000', title: 'Snapshot', tabs: [] } });
  assert.equal(second.frames.length, 1); assert.match(second.frames[0], /Snapshot/);
  hub.publish('task', { type: 'files_changed' });
  assert.equal(first.frames.length, 2); assert.equal(second.frames.length, 2);
  hub.close(); assert.equal(second.destroyed, true);
});

test('forgetting a deleted task closes its streams and detaches its listeners only', () => {
  const hub = new EventHub(); const deleted = response(); const retained = response();
  let calls = 0;
  const unsubscribe = hub.listen('deleted', () => { calls++; });
  hub.subscribe('deleted', deleted as unknown as ServerResponse, { type: 'files_changed' });
  hub.subscribe('retained', retained as unknown as ServerResponse, { type: 'files_changed' });
  hub.forget('deleted'); hub.forget('deleted');
  assert.equal(deleted.destroyed, true); assert.equal(retained.destroyed, false);
  hub.publish('deleted', { type: 'files_changed' }); assert.equal(calls, 0);
  hub.listen('deleted', () => { calls++; });
  unsubscribe(); hub.publish('deleted', { type: 'files_changed' }); assert.equal(calls, 1);
  hub.publish('retained', { type: 'files_changed' }); assert.equal(retained.frames.length, 2);
  hub.close();
});
