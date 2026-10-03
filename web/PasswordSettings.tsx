import { useEffect, useRef, useState } from 'react';
import type { AccessStatus, PasswordManagement } from '../server/access';
import { api, ApiError, message } from './api';
import './PasswordSettings.css';

export function PasswordSettings({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const [management, setManagement] = useState<PasswordManagement>();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const mounted = useRef(true);
  const currentField = useRef<HTMLInputElement>(null);
  const confirmationField = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const controller = useRef<AbortController | undefined>(undefined);
  async function load() {
    controller.current?.abort(); const next = new AbortController(); controller.current = next;
    setError('');
    try { const status = await api<PasswordManagement>('/auth/password', undefined, 'GET', next.signal); if (mounted.current) setManagement(status); }
    catch (error) { if (mounted.current && !next.signal.aborted) setError(message(error)); }
  }
  useEffect(() => {
    mounted.current = true; void load();
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  const valid = Boolean(currentPassword && newPassword.length >= 12 && newPassword.length <= 256 && confirmation);
  function edited() { setError(''); setSuccess(false); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (submitting.current || !management?.enabled || !valid) return;
    if (newPassword !== confirmation) { setError('两次输入的新密码不一致，请重新确认。'); confirmationField.current?.focus(); return; }
    if (newPassword === currentPassword) { setError('新密码不能与当前密码相同。'); return; }
    submitting.current = true; setBusy(true); onBusyChange(true); setError(''); setSuccess(false);
    try {
      const status = await api<AccessStatus>('/auth/password', { currentPassword, newPassword, confirmation });
      if (mounted.current) { setCurrentPassword(''); setNewPassword(''); setConfirmation(''); setShowPasswords(false); setSuccess(true); }
      window.dispatchEvent(new window.Event(status.authenticated ? 'picoding:access-changed' : 'picoding:unauthorized'));
    } catch (error) {
      if (mounted.current) { setError(message(error)); requestAnimationFrame(() => currentField.current?.focus()); }
      if (error instanceof ApiError && error.status === 401) window.dispatchEvent(new window.Event('picoding:unauthorized'));
    } finally { submitting.current = false; onBusyChange(false); if (mounted.current) setBusy(false); }
  }
  return <form className="password-settings" onSubmit={event => void save(event)}>
    <div className="settings-body password-body">
      <h3>修改访问密码</h3>
      <p className="password-intro">修改后当前浏览器保持登录，其他登录会立即失效。项目和正在执行的任务会继续保留。</p>
      {!management && !error && <p role="status">正在读取访问设置…</p>}
      {management && !management.enabled && <p className="field-help" role="status">{management.disabledReason}</p>}
      {management?.enabled && <>
        <label htmlFor="current-password">当前密码</label>
        <input ref={currentField} id="current-password" type={showPasswords ? 'text' : 'password'} autoComplete="current-password" value={currentPassword} onChange={event => { setCurrentPassword(event.target.value); edited(); }} disabled={busy} required maxLength={256} />
        <label htmlFor="new-password">新密码</label>
        <input id="new-password" type={showPasswords ? 'text' : 'password'} autoComplete="new-password" value={newPassword} onChange={event => { setNewPassword(event.target.value); edited(); }} disabled={busy} required minLength={12} maxLength={256} aria-describedby="password-length-help" />
        <p id="password-length-help" className="field-help">使用 12–256 个字符，建议保存到密码管理器。</p>
        <label htmlFor="confirm-password">确认新密码</label>
        <input ref={confirmationField} id="confirm-password" type={showPasswords ? 'text' : 'password'} autoComplete="new-password" value={confirmation} onChange={event => { setConfirmation(event.target.value); edited(); }} disabled={busy} required minLength={12} maxLength={256} />
        <button type="button" className="text-button password-visibility" aria-pressed={showPasswords} disabled={busy} onClick={() => setShowPasswords(value => !value)}>{showPasswords ? '隐藏密码' : '显示密码'}</button>
      </>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {success && <p className="password-success" role="status">密码已修改，其他登录已退出。请保存新密码。</p>}
    </div>
    <div className="dialog-footer password-footer">
      {!management && error ? <button type="button" className="button secondary" onClick={() => void load()}>重新读取</button> : <button type="submit" className="button primary" disabled={busy || !management?.enabled || !valid}>{busy ? '正在修改…' : '修改密码'}</button>}
    </div>
  </form>;
}
