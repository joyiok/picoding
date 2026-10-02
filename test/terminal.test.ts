import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TaskTerminal } from '../sandbox/terminal.js';
import { terminalInput } from '../shared/terminal.js';

function waitFor(terminal: TaskTerminal, condition: () => boolean) {
  return new Promise<void>((resolve, reject) => {
    const done = () => { if (condition()) { cleanup(); resolve(); } };
    const timer = setTimeout(() => { cleanup(); reject(new Error('PTY test timed out')); }, 5000);
    const cleanup = () => { clearTimeout(timer); terminal.off('data', done); terminal.off('exit', done); };
    terminal.on('data', done); terminal.on('exit', done); done();
  });
}
async function command(terminal: TaskTerminal, data: string) {
  const offset = terminal.snapshot.length;
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Bash prompt timed out')), 5000);
    terminal.once('prompt', () => { clearTimeout(timer); resolve(); });
  });
  terminal.send({ type: 'input', data: data + '\r' }); await done;
  return terminal.snapshot.slice(offset);
}

test('terminal messages bound input, acknowledgements and dimensions', () => {
  assert.deepEqual(terminalInput({ type: 'resize', cols: 80, rows: 24 }), { type: 'resize', cols: 80, rows: 24 });
  assert.deepEqual(terminalInput({ type: 'input', data: '中文\r' }), { type: 'input', data: '中文\r' });
  for (const input of [null, { type: 'input', data: 'x'.repeat(16_385) }, { type: 'resize', cols: 0, rows: 24 }, { type: 'resize', cols: 80, rows: 201 }, { type: 'resize', cols: '80', rows: 24 }, { type: 'ack', count: -1 }]) assert.throws(() => terminalInput(input));
});

test('real Bash PTY preserves state, resizes, filters worker credentials and cancels foreground jobs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'picoding-pty-'));
  await mkdir(join(root, '.picoding')); await mkdir(join(root, 'subdir'));
  const previous = process.env.WORKER_TOKEN;
  process.env.WORKER_TOKEN = 'terminal-test-worker-secret';
  const terminal = new TaskTerminal(root);
  t.after(async () => { await terminal.close(); if (previous === undefined) delete process.env.WORKER_TOKEN; else process.env.WORKER_TOKEN = previous; await rm(root, { recursive: true, force: true }); });
  terminal.start(); await waitFor(terminal, () => terminal.snapshot.includes('\x1b]133;A\x07'));
  assert.match(await command(terminal, 'python3 -c "import os,sys; print(sys.stdin.isatty(), bool(os.getenv(\'WORKER_TOKEN\')))"'), /\r(?:\n)?True False\r\n/);
  terminal.send({ type: 'resize', cols: 91, rows: 33 });
  assert.match(await command(terminal, 'stty size'), /\r(?:\n)?33 91\r\n/);
  await command(terminal, 'cd subdir; export PICODING_PTY_VALUE=会话保留');
  const state = await command(terminal, 'printf "%s\\n" "$PICODING_PTY_VALUE"; pwd');
  assert.match(state, /\r(?:\n)?会话保留\r\n/); assert.ok(state.includes(root + '/subdir\r\n'));
  const cancel = waitFor(terminal, () => /\r(?:\n)?PTY_CHILD=\d+\r\n/.test(terminal.snapshot));
  terminal.send({ type: 'input', data: 'python3 -c "import os,time; print(\'PTY_CHILD=\'+str(os.getpid()),flush=True); time.sleep(60)"\r' });
  await cancel;
  const pid = Number(/\r(?:\n)?PTY_CHILD=(\d+)\r\n/.exec(terminal.snapshot)![1]);
  await terminal.suspend();
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  assert.match(await command(terminal, 'printf "after-interrupt\\n"'), /\r(?:\n)?after-interrupt\r\n/);
  terminal.send({ type: 'input', data: 'exit\r' });
  await waitFor(terminal, () => terminal.exited);
  assert.equal(terminal.exited, true);
});
