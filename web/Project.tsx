import { useEffect, useRef, useState } from 'react';
import type { Task } from '../shared/types';
import { api, message } from './api';
import { Icon } from './Icon';

export function Project({ onClose, onCreated }: { onClose: () => void; onCreated: (task: Task) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState<'empty' | 'git'>('empty');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function create(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      const name = title.trim() || (source === 'git' ? url.trim().split('/').pop()?.replace(/\.git$/, '') : '') || '空白工作区';
      const task = await api<Task>('/tasks', { title: name, ...(source === 'git' ? { source: { type: 'git', url: url.trim(), ...(branch.trim() ? { branch: branch.trim() } : {}) } } : {}) });
      onCreated(task); onClose();
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  return <dialog className="settings-dialog project-dialog" ref={dialog} aria-labelledby="project-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form onSubmit={create}>
      <div className="dialog-heading"><div><h2 id="project-title">打开一个项目</h2><p>先准备代码，再让 pi 接着做。</p></div><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭项目设置"><Icon name="close" /></button></div>
      <div className="settings-body">
        <div className="project-source" role="group" aria-label="项目来源"><button type="button" aria-pressed={source === 'empty'} disabled={busy} onClick={() => setSource('empty')}><Icon name="folder" size={16} />空白工作区</button><button type="button" aria-pressed={source === 'git'} disabled={busy} onClick={() => setSource('git')}><Icon name="code" size={16} />Git 仓库</button></div>
        <label htmlFor="project-name">任务名称 <span className="field-optional">选填</span></label>
        <input id="project-name" value={title} onChange={event => setTitle(event.target.value)} disabled={busy} maxLength={120} placeholder={source === 'git' ? '留空使用仓库名称' : '例如 我的个人网站'} autoComplete="off" />
        {source === 'git' ? <>
          <label htmlFor="repository-url">仓库地址</label>
          <input id="repository-url" type="url" value={url} onChange={event => setUrl(event.target.value)} disabled={busy} required placeholder="https://github.com/用户名/仓库.git" aria-describedby="repository-help" autoComplete="off" />
          <p className="field-help" id="repository-help">使用公开仓库的 HTTP 或 HTTPS 克隆地址。私有项目可在空白工作区上传文件夹。</p>
          <label htmlFor="repository-branch">分支 <span className="field-optional">选填</span></label>
          <input id="repository-branch" value={branch} onChange={event => setBranch(event.target.value)} disabled={busy} maxLength={200} placeholder="留空使用默认分支" autoComplete="off" />
        </> : <p className="field-help project-help">工作区启动后，在「代码」上传文件或整个项目文件夹。无需先配置模型，也可以手动编辑和运行代码。</p>}
        {error && <p className="inline-error" role="alert">{error}</p>}
      </div>
      <div className="dialog-footer"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>取消</button><button type="submit" className="button primary" disabled={busy || source === 'git' && !url.trim()}>{busy ? '正在创建…' : source === 'git' ? '导入仓库' : '创建工作区'}</button></div>
    </form>
  </dialog>;
}
