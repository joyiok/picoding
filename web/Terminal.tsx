import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Terminal as Xterm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Task } from '../shared/types';
import type { TerminalInput, TerminalOutput } from '../shared/terminal';
import { Icon } from './Icon';

export default function Terminal({ task, live, active, act, history, empty }: { task?: Task; live: boolean; active: boolean; act: (action: string) => Promise<void>; history: ReactNode; empty: ReactNode }) {
  const [view, setView] = useState<'shell' | 'history'>('shell');
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'disconnected' | 'exited'>('connecting');
  const [serverWritable, setServerWritable] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [readerMode, setReaderMode] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Xterm>(undefined);
  const fit = useRef<FitAddon>(undefined);
  const socket = useRef<WebSocket>(undefined);
  const writable = task?.status === 'paused' && serverWritable && connection === 'connected';
  const allowed = useRef(false); allowed.current = writable;
  function send(message: TerminalInput) {
    const client = socket.current;
    if (client?.readyState === WebSocket.OPEN && (message.type !== 'input' || allowed.current)) client.send(JSON.stringify(message));
  }
  useEffect(() => {
    if (!live || !host.current) return;
    const term = new Xterm({ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: window.innerWidth < 600 ? 11 : 12, cursorBlink: false, disableStdin: true, scrollback: 5000, theme: { background: '#20252c', foreground: '#e3e8ee', cursor: '#9cd1b5', selectionBackground: '#9cd1b5', selectionForeground: '#20252c' } });
    const addon = new FitAddon(); term.loadAddon(addon); term.open(host.current);
    term.textarea?.setAttribute('aria-label', '交互终端输入');
    terminal.current = term; fit.current = addon;
    const input = term.onData(data => send({ type: 'input', data }));
    const size = () => { if (host.current && host.current.clientWidth && host.current.clientHeight) { addon.fit(); send({ type: 'resize', cols: term.cols, rows: term.rows }); } };
    const observer = new ResizeObserver(size); observer.observe(host.current); size();
    return () => { observer.disconnect(); input.dispose(); term.dispose(); terminal.current = undefined; fit.current = undefined; };
  }, [live]);
  useEffect(() => {
    if (terminal.current) { terminal.current.options.disableStdin = !writable; terminal.current.options.cursorBlink = writable; }
  }, [writable]);
  useEffect(() => { if (terminal.current) terminal.current.options.screenReaderMode = readerMode; }, [readerMode, live]);
  useEffect(() => {
    if (!live || !task || !active || view !== 'shell') return;
    let disposed = false; let timer: ReturnType<typeof setTimeout>; let attempts = 0;
    function connect() {
      if (disposed) return;
      setConnection('connecting'); setServerWritable(false); setError('');
      const client = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/tasks/' + task!.id + '/terminal');
      socket.current = client;
      client.onopen = () => {
        if (disposed) { client.close(); return; }
        attempts = 0; setConnection('connected');
        if (terminal.current && host.current?.clientWidth) { fit.current?.fit(); send({ type: 'resize', cols: terminal.current.cols, rows: terminal.current.rows }); }
      };
      client.onmessage = event => {
        if (disposed) return;
        try {
          const message = JSON.parse(event.data) as TerminalOutput;
          if (message.type === 'data' || message.type === 'snapshot') {
            if (message.type === 'snapshot') terminal.current?.reset();
            terminal.current?.write(message.data, () => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'ack', count: message.data.length })); });
          } else if (message.type === 'mode') setServerWritable(message.writable);
          else if (message.type === 'exit') { setConnection('exited'); setServerWritable(false); }
          else if (message.type === 'error') setError(message.message);
        } catch { setError('终端输出无法读取，请重新连接'); }
      };
      client.onerror = () => { if (!disposed) setError('终端暂时无法连接，正在重试。'); };
      client.onclose = () => {
        if (disposed) return;
        setConnection('disconnected'); setServerWritable(false);
        timer = setTimeout(connect, Math.min(8000, 1000 * 2 ** attempts++));
      };
    }
    connect();
    return () => { disposed = true; clearTimeout(timer); socket.current?.close(); socket.current = undefined; };
  }, [task?.id, live, active, view, retry]);
  async function control() {
    setBusy(true); try { await act(task?.status === 'paused' ? 'release' : 'takeover'); }
    finally { setBusy(false); }
  }
  if (!live) return empty;
  return <div className="terminal-workspace">
    <div className="terminal-toolbar">
      <div className="terminal-selector" role="group" aria-label="终端内容"><button className={view === 'shell' ? 'active' : ''} aria-pressed={view === 'shell'} onClick={() => setView('shell')}>交互终端</button><button className={view === 'history' ? 'active' : ''} aria-pressed={view === 'history'} onClick={() => setView('history')}>执行记录</button></div>
      <button className={'button small ' + (task?.status === 'paused' ? 'primary' : 'secondary')} disabled={busy || task?.status === 'pausing'} onClick={() => void control()}><Icon name={task?.status === 'paused' ? 'play' : 'hand'} size={15} />{busy ? '正在切换…' : task?.status === 'paused' ? '归还电脑' : '接管电脑'}</button>
    </div>
    <div className="terminal-mode-panel" hidden={view !== 'shell'}>
      <div className="terminal-help"><span>{connection === 'exited' ? 'Bash 会话已结束' : connection === 'connected' ? writable ? '已接管 · 可输入命令' : '接管电脑后可输入命令' : connection === 'connecting' ? '正在连接终端…' : '连接已断开 · 正在重试…'}</span>{['disconnected', 'exited'].includes(connection) && <button className="text-button" onClick={() => setRetry(value => value + 1)}>重新连接</button>}<label className="terminal-reader"><input type="checkbox" checked={readerMode} onChange={event => setReaderMode(event.target.checked)} />读屏输出</label><small>归还时停止前台命令，后台服务继续运行。</small></div>
      {error && <div className="terminal-error" role="status">{error}</div>}
      <div className="terminal-screen" ref={host} />
      <div className="terminal-keys" role="group" aria-label="终端快捷键">{[['Ctrl+C', '\x03'], ['Tab', '\t'], ['Enter', '\r']].map(([label, data]) => <button key={label} disabled={!writable} onClick={() => { send({ type: 'input', data }); terminal.current?.focus(); }}>{label}</button>)}<span>/workspace · Bash</span></div>
    </div>
    <div className="terminal-mode-panel" hidden={view !== 'history'}>{history}</div>
  </div>;
}
