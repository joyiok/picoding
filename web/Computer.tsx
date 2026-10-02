import { useEffect, useRef, useState } from 'react';
import type { BrowserState, CommandResult, FileContent, FileEntry, Task } from '../shared/types';
import { api, ApiError, message, taskPath } from './api';
import { Icon } from './Icon';

type Tab = 'browser' | 'code' | 'terminal';
interface Props { task?: Task; revision: number; act: (action: string) => Promise<void>; report: (value: string) => void; onDirtyChange: (dirty: boolean) => void; }

export function Computer({ task, revision, act, report, onDirtyChange }: Props) {
  const [tab, setTab] = useState<Tab>('browser');
  const [browser, setBrowser] = useState<BrowserState>();
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const lastUrl = useRef('');
  const live = task && ['ready', 'running', 'paused', 'pausing'].includes(task.status);
  const takeover = task?.status === 'paused';
  useEffect(() => { setBrowser(undefined); setAddress(''); lastUrl.current = ''; }, [task?.id]);
  useEffect(() => {
    if (!task || !live) return;
    let cancelled = false;
    const update = () => api<BrowserState>(taskPath(task.id, 'browser')).then(state => { if (!cancelled) { setBrowser(state); if (lastUrl.current !== state.url) { lastUrl.current = state.url; setAddress(state.url === 'about:blank' ? '' : state.url); } } }).catch(() => {});
    void update(); const timer = setInterval(update, 2500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [task?.id, live]);
  async function control() {
    setBusy(true);
    try { await act(takeover ? 'release' : 'takeover'); }
    finally { setBusy(false); }
  }
  async function navigate(event: React.FormEvent) {
    event.preventDefault(); if (!task || !takeover || !address.trim()) return;
    setBusy(true);
    try { setBrowser(await api<BrowserState>(taskPath(task.id, 'browser'), { action: 'navigate', url: /^https?:\/\//.test(address) ? address : `https://${address}` })); }
    catch (error) { report(message(error)); }
    finally { setBusy(false); }
  }
  return <section className="computer" aria-label="任务电脑">
    <div className="computer-tabs" role="tablist" aria-label="电脑视图">
      {([['browser', '浏览器', 'browser'], ['code', '代码', 'code'], ['terminal', '终端', 'terminal']] as const).map(([id, label, icon]) => <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} tabIndex={tab === id ? 0 : -1} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)} onKeyDown={event => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); const tabs: Tab[] = ['browser', 'code', 'terminal']; const next = tabs[(tabs.indexOf(id) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]; setTab(next); document.getElementById(`tab-${next}`)?.focus(); }
      }}><Icon name={icon} size={16} />{label}</button>)}
      <span className="computer-title"><span className={`status-dot ${live ? 'online' : ''}`} />任务电脑</span>
    </div>
    <div className="computer-content" id="panel-browser" role="tabpanel" aria-labelledby="tab-browser" hidden={tab !== 'browser'}>
      <div className="browser-view">
        <div className="browser-toolbar">
          <form onSubmit={navigate} className="address-bar"><Icon name="browser" size={15} /><input aria-label="浏览器地址" placeholder={takeover ? '输入网址，按 Enter 打开' : browser?.title || '等待打开网页'} value={address} onChange={event => setAddress(event.target.value)} readOnly={!takeover} /></form>
          <button className={`button small ${takeover ? 'primary' : 'secondary'}`} disabled={!live || busy || task?.status === 'pausing'} onClick={() => void control()}><Icon name={takeover ? 'play' : 'hand'} size={15} />{busy ? '正在切换…' : takeover ? '归还浏览器' : '接管浏览器'}</button>
        </div>
        {live ? <><div className={`control-strip ${takeover ? 'human' : ''}`}><span className="status-dot online" />{takeover ? '你正在操作这台电脑' : task.status === 'running' ? 'pi 正在操作 · 你可以实时观看' : task.status === 'pausing' ? '正在等待当前操作停止…' : '浏览器已就绪 · 随时可以接管'}<span>Chromium</span></div><iframe className="desktop-frame" title="任务电脑的实时浏览器" src={`/api/tasks/${task.id}/desktop/vnc.html?autoconnect=true&resize=scale&view_only=${takeover ? 'false' : 'true'}&show_dot=true&path=api/tasks/${task.id}/desktop/websockify`} /></> : <ComputerEmpty tab="browser" task={task} />}
      </div>
    </div>
    <div className="computer-content" id="panel-code" role="tabpanel" aria-labelledby="tab-code" hidden={tab !== 'code'}><Files key={task?.id || 'empty'} task={task} live={Boolean(live)} revision={revision} report={report} onDirtyChange={onDirtyChange} /></div>
    <div className="computer-content" id="panel-terminal" role="tabpanel" aria-labelledby="tab-terminal" hidden={tab !== 'terminal'}><Terminal key={task?.id || 'empty'} task={task} live={Boolean(live)} report={report} /></div>
    <div className="computer-footer"><span><Icon name="folder" size={13} /> /workspace</span><span>独立环境<span className="footer-separator" />Linux</span></div>
  </section>;
}

function ComputerEmpty({ tab, task }: { tab: Tab; task?: Task }) {
  const preparing = task?.status === 'creating';
  return <div className="computer-empty"><div className={`empty-window ${preparing ? 'preparing' : ''}`}><div className="empty-window-bar"><i /><i /><i /><span /></div><div className="empty-window-body"><Icon name={tab === 'browser' ? 'browser' : tab === 'code' ? 'code' : 'terminal'} size={34} /></div></div>
    <h2>{preparing ? '正在准备你的任务电脑' : task?.status === 'stopped' ? '任务电脑已停止' : tab === 'browser' ? '给 pi 一台可以动手的电脑' : tab === 'code' ? '项目文件会出现在这里' : '命令和运行结果会出现在这里'}</h2>
    <p>{preparing ? '正在启动环境和浏览器，通常需要几秒钟。' : task?.status === 'stopped' ? '项目文件已保留。启动环境后，可以继续任务。' : tab === 'browser' ? '任务开始后，这里会显示真实的浏览器。\n你可以观看操作，也可以随时接管。' : tab === 'code' ? '启动任务后，查看、编辑代码，并检查改动。' : 'pi 和你执行的命令都会保留在终端记录中。'}</p>
    {tab === 'browser' && !preparing && <div className="environment-tools"><span>Chromium</span><span>Git</span><span>Node.js</span><span>Python</span></div>}
  </div>;
}

function Files({ task, live, revision, report, onDirtyChange }: { task?: Task; live: boolean; revision: number; report: (message: string) => void; onDirtyChange: (dirty: boolean) => void }) {
  const [directories, setDirectories] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [file, setFile] = useState<FileContent>();
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [diff, setDiff] = useState<string>();
  const [newName, setNewName] = useState<string>();
  const [changedOnDisk, setChangedOnDisk] = useState(false);
  const [diskFile, setDiskFile] = useState<FileContent>();
  const [comparing, setComparing] = useState(false);
  const dirty = Boolean(file && content !== file.content);
  const current = useRef({ file, content, dirty });
  current.current = { file, content, dirty };
  const editable = task && ['ready', 'paused'].includes(task.status);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!task || !live) return;
    let cancelled = false;
    Promise.all([...expanded].map(async path => [path, await api<FileEntry[]>(`${taskPath(task.id, 'files')}?path=${encodeURIComponent(path)}`)] as const)).then(entries => { if (!cancelled) setDirectories(Object.fromEntries(entries)); }).catch(error => { if (!cancelled) report(message(error)); });
    return () => { cancelled = true; };
  }, [task?.id, live, revision, expanded]);
  useEffect(() => {
    if (!task || !live || !file) return;
    let cancelled = false;
    void api<FileContent>(`${taskPath(task.id, 'file')}?path=${encodeURIComponent(file.path)}`).then(next => {
      if (cancelled || current.current.file?.path !== next.path) return;
      if (current.current.dirty) { setChangedOnDisk(current.current.file.version !== next.version); setDiskFile(next); }
      else { setFile(next); setContent(next.content); setDiskFile(undefined); setChangedOnDisk(false); }
    }).catch(error => { if (!cancelled) report(message(error)); });
    return () => { cancelled = true; };
  }, [task?.id, live, revision, file?.path]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  async function open(path: string) {
    if (!task || dirty && !confirm(path === file?.path ? '是否放弃当前草稿，重新载入电脑上的文件？' : '当前文件还未保存，是否放弃改动并打开另一个文件？')) return;
    setLoading(true);
    try { const next = await api<FileContent>(`${taskPath(task.id, 'file')}?path=${encodeURIComponent(path)}`); setFile(next); setContent(next.content); setDiff(undefined); setChangedOnDisk(false); setDiskFile(undefined); setComparing(false); }
    catch (error) { report(message(error)); }
    finally { setLoading(false); }
  }
  async function save() {
    if (!task || !file) return;
    setBusy(true);
    try { const saved = await api<{ version: string }>(taskPath(task.id, 'file'), { path: file.path, content, expectedVersion: file.version }); setFile({ ...file, content, version: saved.version }); setChangedOnDisk(false); setDiskFile(undefined); }
    catch (error) { if (error instanceof ApiError && error.status === 409) setChangedOnDisk(true); report(message(error)); }
    finally { setBusy(false); }
  }
  async function changes() {
    if (!task) return; setLoading(true);
    try { setDiff((await api<CommandResult>(taskPath(task.id, 'diff'))).output || '目前没有文件改动。'); }
    catch (error) { report(message(error)); }
    finally { setLoading(false); }
  }
  async function compare() {
    if (!task || !file) return;
    setBusy(true);
    try { setDiskFile(await api<FileContent>(`${taskPath(task.id, 'file')}?path=${encodeURIComponent(file.path)}`)); setComparing(true); setDiff(undefined); }
    catch (error) { report(message(error)); }
    finally { setBusy(false); }
  }
  function acceptMergedDraft() {
    if (!diskFile || !file || diskFile.path !== file.path) return;
    setFile(diskFile); setChangedOnDisk(false); setDiskFile(undefined); setComparing(false);
  }
  async function create(event: React.FormEvent) {
    event.preventDefault(); if (!task || !newName?.trim()) return;
    setBusy(true);
    try { await api(taskPath(task.id, 'file'), { path: newName.trim(), content: '', createOnly: true }); const path = newName.trim(); setNewName(undefined); await open(path); setExpanded(new Set(expanded)); }
    catch (error) { report(message(error)); }
    finally { setBusy(false); }
  }
  function tree(path: string, level = 0): React.ReactNode {
    return directories[path]?.map(entry => <div key={entry.path}><button className={`tree-entry ${file?.path === entry.path && diff === undefined ? 'active' : ''}`} disabled={busy || loading} aria-expanded={entry.type === 'directory' ? expanded.has(entry.path) : undefined} style={{ paddingLeft: 12 + level * 14 }} onClick={() => {
      if (entry.type === 'directory') { const next = new Set(expanded); next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path); setExpanded(next); } else void open(entry.path);
    }}><Icon name={entry.type === 'directory' ? expanded.has(entry.path) ? 'down' : 'chevron' : 'file'} size={13} /><span>{entry.name}</span></button>{entry.type === 'directory' && expanded.has(entry.path) && tree(entry.path, level + 1)}</div>);
  }
  if (!live) return <ComputerEmpty tab="code" task={task} />;
  return <div className="file-workspace">
    <aside className="file-tree">
      <div className="file-tree-heading"><span>项目文件</span><button className="icon-button" aria-label="新建文件" title="新建文件" disabled={!editable || busy} onClick={() => setNewName('')}><Icon name="plus" size={15} /></button></div>
      {newName !== undefined && <form className="new-file-form" onSubmit={create}><input aria-label="新文件路径" autoFocus placeholder="例如 src/app.ts" value={newName} onChange={event => setNewName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setNewName(undefined); }} /><button type="submit" disabled={busy || !newName.trim()} aria-label="创建文件"><Icon name="check" size={14} /></button></form>}
      {tree('')}{!directories['']?.length && <p className="tree-empty">还没有项目文件</p>}
    </aside>
    <div className="editor-area">
      <div className="editor-toolbar"><span className="file-path">{diff !== undefined ? '项目改动' : file?.path || '选择一个文件'}{dirty && <i aria-label="未保存" />}</span><button className="button small secondary" onClick={() => void changes()} disabled={loading || busy}>查看改动</button>{file && diff === undefined && <button className="button small primary" onClick={() => void save()} disabled={!dirty || !editable || busy || changedOnDisk}>{busy ? '保存中…' : '保存'}</button>}</div>
      {changedOnDisk && <div className="file-conflict" role="status"><span>电脑上的文件已变化，你的草稿仍在。对比后合并，再保存。</span><div><button className="text-button" onClick={() => void compare()} disabled={busy}>对比改动</button><button className="text-button" onClick={() => file && void open(file.path)} disabled={busy}>重新载入</button>{comparing && diskFile && <button className="text-button" onClick={acceptMergedDraft} disabled={!editable || busy}>我已合并</button>}</div></div>}
      {comparing && diskFile && <div className="disk-comparison"><span>电脑上的版本 · 下方编辑框保留你的草稿</span><pre>{diskFile.content || '(空文件)'}</pre></div>}
      {loading ? <div className="editor-loading">正在读取…</div> : diff !== undefined ? <pre className="diff-output">{diff.split('\n').map((line, index) => <span className={line.startsWith('+') ? 'addition' : line.startsWith('-') ? 'deletion' : ''} key={index}>{line}{'\n'}</span>)}</pre> : file ? <div className="code-editor"><pre className="line-numbers" aria-hidden="true">{content.split('\n').map((_, index) => index + 1).join('\n')}</pre><textarea aria-label={`编辑 ${file.path}`} spellCheck={false} value={content} readOnly={!editable} onChange={event => setContent(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); if (editable && dirty && !busy && !changedOnDisk) void save(); } }} /></div> : <div className="editor-empty"><Icon name="code" size={26} /><p>从左侧选择文件，查看或编辑代码。</p></div>}
    </div>
  </div>;
}

function Terminal({ task, live, report }: { task?: Task; live: boolean; report: (value: string) => void }) {
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingCommand, setPendingCommand] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [task?.terminal.length, busy]);
  async function run(event: React.FormEvent) {
    event.preventDefault(); if (!task || !command.trim()) return;
    setBusy(true); setPendingCommand(command); setCommand('');
    try { await api(taskPath(task.id, 'command'), { command }); }
    catch (error) { report(message(error)); }
    finally { setBusy(false); setPendingCommand(''); }
  }
  if (!live) return <ComputerEmpty tab="terminal" task={task} />;
  return <div className="terminal-view"><div className="terminal-output" ref={scroll}>{!task?.terminal.length && !busy && <div className="terminal-welcome"><p>任务电脑的终端已就绪。</p><p>工作目录 /workspace · Bash · Node.js · Python</p></div>}{task?.terminal.map(entry => <div className="terminal-entry" key={entry.id}><div className="terminal-command"><span>$</span> {entry.command}<small>{entry.exitCode === 0 ? '完成' : `退出 ${entry.exitCode ?? '已取消'}`}</small></div><pre>{entry.output || '(无输出)'}</pre></div>)}{busy && <div className="terminal-entry"><div className="terminal-command"><span>$</span> {pendingCommand}</div><p className="terminal-pending">命令正在运行…<button onClick={() => { if (task) void api(taskPath(task.id, 'abort'), {}).catch(error => report(message(error))); }}>停止</button></p></div>}</div><form className="terminal-input" onSubmit={run}><span>$</span><input aria-label="终端命令" placeholder={task?.status === 'running' ? 'agent 正在运行，停止后可执行命令' : '输入命令，按 Enter 执行'} value={command} onChange={event => setCommand(event.target.value)} disabled={busy || !['ready', 'paused'].includes(task?.status || '')} autoComplete="off" spellCheck={false} /><button type="submit" className="icon-button" disabled={busy || !command.trim() || !['ready', 'paused'].includes(task?.status || '')} aria-label="执行命令"><Icon name="play" size={15} /></button></form></div>;
}
