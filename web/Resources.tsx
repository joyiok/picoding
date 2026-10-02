import { useEffect, useRef, useState } from 'react';
import type { PiPackageAction, PiResourceCatalog } from '../shared/resources';
import { api, message } from './api';
import { Icon } from './Icon';
import './Resources.css';

export function Resources({ onClose, onUse }: { onClose: () => void; onUse: (command: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [catalog, setCatalog] = useState<PiResourceCatalog>();
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  async function load(signal?: AbortSignal) {
    setLoading(true); setError('');
    try { const value = await api<PiResourceCatalog>('/resources', undefined, 'GET', signal); if (!signal?.aborted) setCatalog(value); }
    catch (error) { if (!signal?.aborted) setError(message(error)); }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => {
    dialog.current?.showModal();
    const controller = new AbortController(); void load(controller.signal);
    return () => controller.abort();
  }, []);
  async function change(action: PiPackageAction, value: string) {
    if (busy) return;
    setBusy(true); setError(''); setFeedback('');
    try {
      setCatalog(await api<PiResourceCatalog>('/resources/packages', { action, source: value }));
      if (action === 'install') setSource('');
      setFeedback(action === 'remove' ? '已移除包配置。本地源文件保留。' : '已更新 pi 资源，下一条消息生效。');
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  async function reload() {
    if (busy) return;
    setBusy(true); setError(''); setFeedback('');
    try { setCatalog(await api<PiResourceCatalog>('/resources/reload', {})); setFeedback('已重新读取 pi 资源，下一条消息生效。'); }
    catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  return <dialog className="settings-dialog resources-dialog" ref={dialog} aria-labelledby="resources-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); if (source.trim()) void change('install', source.trim()); }}>
      <div className="dialog-heading"><div><h2 id="resources-title">Skills 和插件</h2><p>直接使用 pi 的现成包、技能和扩展。</p></div><button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="关闭 Skills 和插件"><Icon name="close" /></button></div>
      <div className="settings-body resources-body">
        <label htmlFor="pi-package-source">安装 pi 包</label>
        <div className="resource-install"><input id="pi-package-source" value={source} onChange={event => setSource(event.target.value)} disabled={busy} maxLength={2048} autoComplete="off" placeholder="npm:包名、Git 地址或本地包绝对路径" aria-describedby="pi-package-help" required /><button className="button primary" type="submit" disabled={busy || !source.trim()}>{busy ? '正在处理…' : '安装'}</button></div>
        <p className="field-help" id="pi-package-help">扩展在本机控制服务中运行，只安装你信任的来源。<a href="https://pi.dev/packages" target="_blank" rel="noopener noreferrer">浏览 pi 包<Icon name="external" size={12} /></a></p>
        <div className="resource-section-title"><h3>已安装的包</h3><button type="button" className="text-button" disabled={busy || loading} onClick={() => void reload()}><Icon name="refresh" size={13} />刷新</button></div>
        {loading ? <p className="resource-empty" role="status">正在读取 pi 资源…</p> : catalog ? <>
          {catalog.packages.length ? <ul className="package-list">{catalog.packages.map(item => <li key={item.source}>
            <div className="package-details"><code>{item.source}</code><p>{!item.installed ? '源文件未找到，请更新或重新安装。' : `${item.skills} 个 Skill · ${item.extensions} 个扩展 · ${item.prompts} 个提示模板`}</p></div>
            <div className="package-actions"><label className="package-toggle"><input type="checkbox" checked={item.enabled} disabled={busy || !item.installed} onChange={() => void change(item.enabled ? 'disable' : 'enable', item.source)} aria-label={`启用包 ${item.source}`} />启用</label><button type="button" className="icon-button" disabled={busy} aria-label={`更新包 ${item.source}`} title="更新包" onClick={() => void change('update', item.source)}><Icon name="refresh" size={15} /></button><button type="button" className="icon-button" disabled={busy} aria-label={`移除包 ${item.source}`} title="移除包" onClick={() => void change('remove', item.source)}><Icon name="trash" size={15} /></button></div>
          </li>)}</ul> : <p className="resource-empty">还没有安装包。从上方添加一个现成的 pi 包。</p>}
          <div className="resource-section-title"><h3>可用 Skills</h3><span>{catalog.skills.length}</span></div>
          {catalog.skills.length ? <ul className="skill-list">{catalog.skills.map(skill => <li key={skill.name}><div><strong>{skill.name}</strong><p>{skill.description}</p></div><button type="button" className="button secondary small" disabled={busy} onClick={() => { onUse(skill.command + ' '); onClose(); }}>使用</button></li>)}</ul> : <p className="resource-empty">启用包含 Skills 的包后，pi 会按需读取技能说明。</p>}
          {(catalog.extensions.length > 0 || catalog.prompts.length > 0) && <details className="resource-extras"><summary>{catalog.extensions.length} 个扩展 · {catalog.prompts.length} 个提示模板</summary><ul>{catalog.extensions.map((item, index) => <li key={'extension-' + index}><span>扩展</span><code>{item.name}</code></li>)}{catalog.prompts.map((item, index) => <li key={'prompt-' + index}><span>命令</span><code>/{item.name}</code></li>)}</ul></details>}
          {catalog.diagnostics.length > 0 && <div className="resource-diagnostics" role="status">{catalog.diagnostics.map((item, index) => <p key={index}>{item.message}</p>)}</div>}
        </> : <button type="button" className="button secondary" disabled={loading} onClick={() => void load()}>重新读取</button>}
      </div>
      <div className="dialog-footer resource-footer"><p className={error ? 'connection-status connection-failed' : 'connection-status'} role={error ? 'alert' : 'status'}>{error || (busy ? 'pi 正在处理包，完成后会显示结果。' : feedback || '更改在下一条消息生效，项目文件和对话会保留。')}</p><button type="button" className="button secondary" disabled={busy} onClick={onClose}>完成</button></div>
    </form>
  </dialog>;
}
