import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventEnvelope, Health, PublicSettings, Task } from '../shared/types';
import { api, message, taskPath } from './api';
import { Chat } from './Chat';
import { Computer } from './Computer';
import { Icon, PiMark } from './Icon';
import { Settings } from './Settings';
import { Project } from './Project';

const statuses: Record<string, string> = { creating: '正在准备', ready: '环境就绪', running: '正在执行', pausing: '正在暂停', paused: '你已接管', error: '启动失败', stopped: '环境已停止' };

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [health, setHealth] = useState<Health>();
  const [settings, setSettings] = useState<PublicSettings>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 1000px)').matches);
  const [editorDirty, setEditorDirty] = useState(false);
  const [checkingEnvironment, setCheckingEnvironment] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'chat' | 'computer'>('chat');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);
  const [revision, setRevision] = useState(0);
  const [copied, setCopied] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const task = tasks.find(task => task.id === activeId);
  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([api<Task[]>('/tasks'), api<Health>('/health'), api<PublicSettings>('/settings')]);
    if (results[0].status === 'fulfilled') { setTasks(results[0].value); setConnected(true); } else { setConnected(false); setError('无法连接工作台后端。请确认 npm run dev 正在运行，然后重试。'); }
    if (results[1].status === 'fulfilled') setHealth(results[1].value);
    if (results[2].status === 'fulfilled') setSettings(results[2].value);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1000px)');
    const change = () => { setMobile(query.matches); if (!query.matches) setSidebarOpen(false); };
    query.addEventListener('change', change); return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!mobile || !sidebarOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    sidebar.current?.querySelector<HTMLButtonElement>('.new-task')?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setSidebarOpen(false); }
      if (event.key === 'Tab') {
        const controls = [...sidebar.current!.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), [tabindex="0"]')];
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keys);
    return () => { document.removeEventListener('keydown', keys); if (previous?.isConnected) previous.focus(); };
  }, [mobile, sidebarOpen]);
  const checkEnvironment = useCallback(async () => {
    setCheckingEnvironment(true);
    try { setHealth(await api<Health>('/health')); }
    catch (error) { setError(message(error)); }
    finally { setCheckingEnvironment(false); }
  }, []);
  useEffect(() => {
    if (health?.docker.imageReady) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void checkEnvironment(); }, 10_000);
    return () => clearInterval(timer);
  }, [health?.docker.imageReady, checkEnvironment]);
  useEffect(() => {
    if (!activeId) return;
    const events = new EventSource(`/api${taskPath(activeId, 'events')}`);
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.onmessage = event => {
      const { event: update } = JSON.parse(event.data) as EventEnvelope;
      if (update.type === 'files_changed') { setRevision(value => value + 1); return; }
      setTasks(tasks => tasks.map(task => {
        if (task.id !== activeId) return task;
        if (update.type === 'task') return update.task;
        if (update.type === 'message') {
          const exists = task.messages.some(message => message.id === update.message.id);
          return { ...task, messages: exists ? task.messages.map(message => message.id === update.message.id ? update.message : message) : [...task.messages, update.message] };
        }
        if (update.type === 'tool') {
          const exists = task.tools.some(tool => tool.id === update.tool.id);
          return { ...task, tools: exists ? task.tools.map(tool => tool.id === update.tool.id ? update.tool : tool) : [...task.tools, update.tool] };
        }
        if (update.type === 'terminal') return { ...task, terminal: task.terminal.some(entry => entry.id === update.entry.id) ? task.terminal : [...task.terminal, update.entry] };
        if (update.type === 'browser') return { ...task, browserUrl: update.state.url };
        return task;
      }));
    };
    return () => events.close();
  }, [activeId]);
  useEffect(() => {
    if (!composer.current) return;
    composer.current.style.height = 'auto'; composer.current.style.height = `${Math.min(composer.current.scrollHeight, 180)}px`;
  }, [draft]);
  function allowNavigation() { return !editorDirty || confirm('代码中还有未保存的改动，是否放弃改动并切换任务？'); }
  function newTask(force = false) { if (!force && !allowNavigation()) return; setEditorDirty(false); setActiveId(undefined); setDraft(''); setError(''); setSidebarOpen(false); setMobilePanel('chat'); composer.current?.focus(); }
  async function send(event?: React.FormEvent) {
    event?.preventDefault(); if (!draft.trim() || busy) return;
    if (!settings?.configured) { setSettingsOpen(true); return; }
    if (editorDirty && !confirm('代码中还有未保存的改动。继续执行可能修改这些文件，你的草稿会保留，是否继续？')) return;
    if (!health?.docker.available || !health.docker.imageReady) { setError(health?.docker.message || '请先启动 Docker 并构建任务环境'); return; }
    setBusy(true); setError('');
    try {
      if (task) await api(taskPath(task.id, 'messages'), { text: draft.trim() });
      else {
        const created = await api<Task>('/tasks', { prompt: draft.trim(), title: draft.trim().slice(0, 36) });
        setTasks(tasks => [created, ...tasks]); setActiveId(created.id);
      }
      setDraft('');
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  async function act(action: string) {
    if (!task) return;
    try { await api(taskPath(task.id, action), {}); const next = await api<Task>(`/tasks/${task.id}`); setTasks(tasks => tasks.map(task => task.id === next.id ? next : task)); setRevision(value => value + 1); }
    catch (error) { setError(message(error)); }
  }
  async function remove() {
    if (!task || !confirm('删除此任务及其项目文件？此操作无法恢复。')) return;
    setBusy(true);
    try { await api(`/tasks/${task.id}`, undefined, 'DELETE'); setTasks(tasks => tasks.filter(item => item.id !== task.id)); newTask(true); }
    catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  const canCompose = !task || task.status === 'ready';
  const needsSetup = !health?.docker.imageReady || !settings?.configured;
  return <div className="app-shell">
    {sidebarOpen && <button className="sidebar-backdrop" aria-label="关闭任务列表" onClick={() => setSidebarOpen(false)} />}
    <aside ref={sidebar} id="task-navigation" className={`sidebar ${sidebarOpen ? 'open' : ''}`} aria-label="任务导航" inert={mobile && !sidebarOpen} role={mobile ? 'dialog' : undefined} aria-modal={mobile && sidebarOpen ? true : undefined}>
      <a className="brand" href="#" onClick={event => { event.preventDefault(); newTask(); }}><PiMark /><span>PiCoding</span></a>
      <button className="drawer-close icon-button mobile-only" aria-label="关闭任务列表" onClick={() => setSidebarOpen(false)}><Icon name="close" size={17} /></button>
      <button className="new-task" onClick={() => newTask()}><Icon name="plus" size={17} />新任务<span className="new-task-key">开始</span></button>
      <div className="task-list-heading">最近任务<span>{tasks.length > 0 ? tasks.length : ''}</span></div>
      <nav className="task-list">{loading ? <div className="task-skeleton"><i /><i /><i /></div> : tasks.length ? tasks.map(item => <button key={item.id} className={`task-nav-item ${item.id === activeId ? 'active' : ''}`} aria-current={item.id === activeId ? 'page' : undefined} onClick={() => { if (item.id === activeId) { setSidebarOpen(false); return; } if (!allowNavigation()) return; setEditorDirty(false); setActiveId(item.id); setSidebarOpen(false); setDraft(''); setError(''); }}><Icon name="chat" size={15} /><span>{item.title}</span><span className={`task-indicator ${item.status}`} title={statuses[item.status]} /></button>) : <div className="task-list-empty"><Icon name="clock" size={17} /><p>你的任务会保存在这里。</p><span>从第一件想做的事开始。</span></div>}</nav>
      <div className="sidebar-bottom"><button className="settings-nav" onClick={() => { setSidebarOpen(false); setSettingsOpen(true); }}><Icon name="settings" size={17} />模型设置<Icon name="chevron" size={14} /></button><div className="local-profile"><span className="profile-avatar">我</span><div><strong>本地工作台</strong><small><span className={`status-dot ${connected ? 'online' : ''}`} />{connected ? '仅在你的电脑上运行' : '正在重新连接…'}</small></div></div></div>
    </aside>
    <main className="main-workspace" inert={mobile && sidebarOpen}>
      <header className="workspace-header"><div className="header-title"><button className="icon-button mobile-only" aria-label="打开任务列表" aria-expanded={sidebarOpen} aria-controls="task-navigation" onClick={() => setSidebarOpen(true)}><Icon name="menu" /></button><span>{task?.title || '新的开始'}</span>{task && <span className={`task-status ${task.status}`}><span className="status-dot" />{statuses[task.status]}</span>}</div><div className="header-actions"><button className="model-button" onClick={() => setSettingsOpen(true)}><span className={`status-dot ${settings?.configured ? 'online' : ''}`} /><span>{settings?.configured ? settings.model || (settings.protocol === 'anthropic' ? 'Anthropic 格式' : 'OpenAI 格式') : '连接模型'}</span><Icon name="down" size={13} /></button>{task && <><button className="icon-button" aria-label="下载项目" title="下载项目" disabled={!['ready', 'paused', 'running'].includes(task.status)} onClick={() => { window.location.href = `/api${taskPath(task.id, 'archive')}`; }}><Icon name="download" /></button><button className="icon-button" aria-label="删除任务" title="删除任务" disabled={busy || ['creating', 'running', 'pausing'].includes(task.status)} onClick={() => void remove()}><Icon name="trash" size={17} /></button></>}</div></header>
      {error && <div className="error-banner" role="alert"><Icon name="alert" size={17} /><span>{error}</span>{!connected && <button onClick={() => { setError(''); void refresh(); }}>重试</button>}<button className="icon-button" aria-label="关闭提示" onClick={() => setError('')}><Icon name="close" size={15} /></button></div>}
      <div className="mobile-switch" role="group" aria-label="工作区视图"><button className={mobilePanel === 'chat' ? 'active' : ''} onClick={() => setMobilePanel('chat')}><Icon name="chat" size={15} />对话</button><button className={mobilePanel === 'computer' ? 'active' : ''} onClick={() => setMobilePanel('computer')}><Icon name="browser" size={15} />任务电脑</button></div>
      <div className={`workbench-grid mobile-${mobilePanel}`}>
        <section className="conversation" aria-label="与 pi 对话"><div className="conversation-title"><span><PiMark size={20} />对话</span><span>{task ? statuses[task.status] : '从这里开始'}</span></div>
          <Chat task={task} suggest={value => { setDraft(value); composer.current?.focus(); }} openProject={() => setProjectOpen(true)} />
          <div className="conversation-bottom">
            {!task && !loading && needsSetup && <div className="setup-guide"><div className="setup-heading"><Icon name="settings" size={15} /><strong>准备好，就可以开始了</strong></div><div className="setup-row"><span className={`setup-check ${health?.docker.imageReady ? 'done' : ''}`}><Icon name={health?.docker.imageReady ? 'check' : 'terminal'} size={14} /></span><div><strong>{health?.docker.imageReady ? '任务环境已就绪' : '准备任务环境'}</strong><small>{health?.docker.available ? '在项目目录运行，预装浏览器和工具' : '启动 Docker，然后在项目目录运行'}</small></div><button className="copy-command" onClick={() => { void navigator.clipboard.writeText('npm run sandbox:build').then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => setError('构建命令：npm run sandbox:build')); }} title="复制构建命令"><Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? '已复制' : '构建命令'}</button></div><code className="setup-command">npm run sandbox:build</code><div className="setup-row"><span className={`setup-check ${settings?.configured ? 'done' : ''}`}><Icon name={settings?.configured ? 'check' : 'settings'} size={14} /></span><div><strong>{settings?.configured ? '模型已配置' : '连接一个模型'}</strong><small>使用你的 API Key 和模型</small></div><button className="text-button" onClick={() => setSettingsOpen(true)}>{settings?.configured ? '更改' : '去设置'}<Icon name="chevron" size={13} /></button></div></div>}
            {task?.error && <div className="task-error" role="alert"><Icon name="alert" size={15} /><span>{task.error}</span></div>}
            {task && ['stopped', 'error'].includes(task.status) && <button className="button secondary restart-button" onClick={() => void act('start')}><Icon name="play" size={15} />启动环境</button>}
            <form className="composer" onSubmit={event => void send(event)}><textarea ref={composer} aria-label="向 pi 描述任务" placeholder={task?.status === 'paused' ? '归还浏览器后，可以继续任务' : task?.status === 'running' ? 'pi 正在工作，你可以先写好下一条消息…' : '描述你想做的事…'} value={draft} onChange={event => setDraft(event.target.value)} rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canCompose && !busy) void send(); } }} /><div className="composer-actions"><span><Icon name="folder" size={14} />{task ? '任务工作区' : '独立任务电脑'}</span>{task?.status === 'running' ? <button className="send-button stop-button" type="button" onClick={() => void act('abort')} aria-label="停止 agent"><Icon name="stop" size={15} /></button> : <button className="send-button" type="submit" disabled={!draft.trim() || busy || !canCompose || loading || !connected} aria-label="发送任务"><Icon name="arrow" size={19} /></button>}</div></form>
            <div className="composer-caption"><span>pi 负责执行，你随时掌控。</span><span>Enter 发送</span></div>
          </div>
        </section>
        <Computer task={task} revision={revision} act={act} report={setError} onDirtyChange={setEditorDirty} />
      </div>
      <footer className="workspace-footer"><button className="environment-check" disabled={checkingEnvironment} onClick={() => void checkEnvironment()} title="重新检查 Docker 和任务环境"><span className={`status-dot ${health?.docker.imageReady ? 'online' : ''}`} />{checkingEnvironment ? '正在检查环境…' : health?.docker.imageReady ? '任务环境已就绪' : health?.docker.available ? '环境镜像待构建 · 重新检查' : '等待 Docker · 重新检查'}</button>{task && !['creating', 'pausing', 'stopped'].includes(task.status) && <button onClick={() => void act('stop')}><Icon name="stop" size={12} />停止环境</button>}<span>Powered by pi</span></footer>
    </main>
    {settingsOpen && <Settings initial={settings} onClose={() => setSettingsOpen(false)} onSaved={value => { setSettings(value); void refresh(); }} />}
    {projectOpen && <Project onClose={() => setProjectOpen(false)} onCreated={created => { setTasks(tasks => [created, ...tasks]); setActiveId(created.id); setError(''); setMobilePanel('computer'); }} />}
  </div>;
}
