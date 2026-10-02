import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';
import type { TerminalInput } from '../shared/terminal.js';

// Python's Unix PTY gives Bash a controlling terminal and job control without
// requiring a native Node addon in the host install.
const program = String.raw`
import os, sys, pty, fcntl, termios, struct, select, json, base64, signal
root = sys.argv[1]
def emit(value):
    print(json.dumps(value), flush=True)
def stop(signum, frame):
    raise SystemExit()
signal.signal(signal.SIGTERM, stop)
pid, fd = pty.fork()
if pid == 0:
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    os.chdir(root)
    env = dict(os.environ)
    env.pop('WORKER_TOKEN', None)
    env['TERM'] = 'xterm-256color'
    env['HISTFILE'] = os.path.join(root, '.picoding', 'terminal_history')
    env['HISTSIZE'] = '2000'
    env['HISTFILESIZE'] = '2000'
    env['PROMPT_COMMAND'] = "history -a; printf '\\033]133;A\\007'"
    env['PS1'] = r'\w \$ '
    os.execvpe('/bin/bash', ['bash', '--noprofile', '--norc', '-i'], env)
pending = b''
try:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
    while True:
        ready, _, _ = select.select([fd, 0], [], [])
        if fd in ready:
            try:
                data = os.read(fd, 8192)
            except OSError:
                break
            if not data:
                break
            emit({'type': 'data', 'data': base64.b64encode(data).decode('ascii')})
        if 0 in ready:
            data = os.read(0, 65536)
            if not data:
                break
            pending += data
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                message = json.loads(line)
                if message['type'] == 'input':
                    data = message['data'].encode('utf-8')
                    while data:
                        sent = os.write(fd, data)
                        data = data[sent:]
                elif message['type'] == 'resize':
                    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', message['rows'], message['cols'], 0, 0))
finally:
    try:
        foreground = os.tcgetpgrp(fd)
        if foreground > 1 and foreground != pid:
            os.killpg(foreground, signal.SIGHUP)
    except OSError:
        pass
    try:
        os.close(fd)
        os.killpg(pid, signal.SIGHUP)
    except OSError:
        pass
    _, status = os.waitpid(pid, 0)
    emit({'type': 'exit', 'code': os.waitstatus_to_exitcode(status)})
`;

export class TaskTerminal extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private transcript = '';
  private ended = false;
  private code: number | null = null;
  private markerTail = '';
  private promptVersion = 0;
  private readonly decoder = new StringDecoder('utf8');
  constructor(readonly root: string) { super(); }
  get snapshot() { return this.transcript; }
  get exited() { return this.ended; }
  get exitCode() { return this.code; }
  start() {
    if (this.child) return;
    this.child = spawn('python3', ['-u', '-c', program, this.root], { detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, WORKER_TOKEN: undefined } });
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', line => {
      try {
        const event = JSON.parse(line);
        if (event.type === 'data') this.output(this.decoder.write(Buffer.from(event.data, 'base64')));
        else if (event.type === 'exit') this.finish(event.code);
      } catch { this.emit('fault', '终端输出无法读取'); }
    });
    this.child.on('error', () => { this.emit('fault', '无法启动 Bash 终端，请检查 Python 环境'); this.finish(null); });
    this.child.on('close', code => { this.output(this.decoder.end()); this.finish(this.ended ? this.code : code); });
    this.child.stderr.resume();
  }
  private output(data: string) {
    if (!data) return;
    const marker = this.markerTail + data;
    const count = marker.split('\x1b]133;A\x07').length - 1;
    if (count) { this.promptVersion += count; this.emit('prompt'); }
    this.markerTail = marker.slice(-7);
    this.transcript = (this.transcript + data).slice(-262_144);
    this.emit('data', data);
  }
  private finish(code: number | null) {
    if (this.ended) return;
    this.ended = true; this.code = code; this.emit('exit', code);
  }
  send(input: Exclude<TerminalInput, { type: 'ack' }>) {
    if (this.ended || !this.child?.stdin.writable) throw new Error('终端会话已结束，请重新打开终端');
    if (this.child.stdin.writableLength > 65_536) throw new Error('终端输入过快，请稍后重试');
    this.child.stdin.write(JSON.stringify(input) + '\n');
  }
  pauseOutput(paused: boolean) { if (paused) this.child?.stdout.pause(); else this.child?.stdout.resume(); }
  async suspend() {
    if (!this.child || this.ended) return;
    const before = this.promptVersion;
    this.send({ type: 'input', data: '\x03' });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('终端前台程序未停止，请先按 Ctrl+C 或退出程序再归还电脑')); }, 3000);
      const done = () => { if (this.promptVersion > before || this.ended) { cleanup(); resolve(); } };
      const cleanup = () => { clearTimeout(timer); this.off('prompt', done); this.off('exit', done); };
      this.on('prompt', done); this.on('exit', done);
    });
  }
  async close() {
    if (!this.child || this.child.exitCode !== null || this.child.signalCode) return;
    this.pauseOutput(false); this.child.stdin.end(); this.child.kill('SIGTERM');
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => this.child?.kill('SIGKILL'), 2000);
      this.child!.once('close', () => { clearTimeout(timer); resolve(); });
    });
  }
}
