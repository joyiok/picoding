import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { message } from './api';

export function TaskName({ title, save, close }: { title: string; save: (title: string) => Promise<void>; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(title), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); input.current?.focus(); input.current?.select(); }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy || !name.trim()) return;
    if (name.trim() === title) { close(); return; }
    setBusy(true); setError('');
    try { await save(name.trim()); close(); } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="settings-dialog task-name-dialog" aria-labelledby="task-name-title" onCancel={event => { if (busy) event.preventDefault(); else close(); }} onClick={event => { if (event.target === event.currentTarget && !busy) close(); }}>
    <form onSubmit={event => void submit(event)}>
      <div className="dialog-heading"><div><h2 id="task-name-title">修改任务名称</h2><p>用一个容易找到的名字，整理你的项目。</p></div><button type="button" className="icon-button" onClick={close} disabled={busy} aria-label="关闭任务名称"><Icon name="close" /></button></div>
      <div className="settings-body"><label htmlFor="task-new-name">任务名称</label><input ref={input} id="task-new-name" autoComplete="off" maxLength={120} required disabled={busy} value={name} onChange={event => { setName(event.target.value); setError(''); }} />{error && <p className="inline-error" role="alert">{error}</p>}</div>
      <div className="dialog-footer"><button type="button" className="button secondary" onClick={close} disabled={busy}>取消</button><button type="submit" className="button primary" disabled={busy || !name.trim()}>{busy ? '正在保存…' : '保存名称'}</button></div>
    </form>
  </dialog>;
}
