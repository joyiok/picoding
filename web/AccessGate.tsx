import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccessStatus } from '../server/access';
import { api, message } from './api';
import { App } from './App';
import { PiMark } from './Icon';

export function AccessGate() {
  const [status, setStatus] = useState<AccessStatus>();
  const [opened, setOpened] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  const changing = useRef(false);
  const passwordField = useRef<HTMLInputElement>(null);
  const update = useCallback((next: AccessStatus) => { setStatus(next); if (next.authenticated) setOpened(true); }, []);
  const refresh = useCallback(async () => {
    if (changing.current) return;
    const version = ++requestVersion.current;
    try { const next = await api<AccessStatus>('/auth'); if (version === requestVersion.current) { update(next); setError(''); } }
    catch (error) { if (version === requestVersion.current) setError(message(error)); }
  }, [update]);
  useEffect(() => {
    void refresh();
    const check = () => { void refresh(); };
    window.addEventListener('focus', check); window.addEventListener('picoding:unauthorized', check);
    const timer = setInterval(check, 60_000);
    return () => { requestVersion.current++; clearInterval(timer); window.removeEventListener('focus', check); window.removeEventListener('picoding:unauthorized', check); };
  }, [refresh]);
  useEffect(() => {
    if (!status?.expiresAt || !status.authenticated) return;
    const timer = setTimeout(() => { update({ required: true, authenticated: false }); void refresh(); }, Math.max(1, status.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [status, update, refresh]);
  useEffect(() => { if (status && !status.authenticated) passwordField.current?.focus(); }, [status?.authenticated]);

  async function login(event: React.FormEvent) {
    event.preventDefault(); if (changing.current || !password) return;
    changing.current = true; requestVersion.current++; setBusy(true); setError('');
    try { const next = await api<AccessStatus>('/auth/login', { password }); requestVersion.current++; update(next); setPassword(''); setShowPassword(false); }
    catch (error) { setError(message(error)); passwordField.current?.focus(); }
    finally { changing.current = false; setBusy(false); }
  }
  async function logout() {
    if (changing.current) return;
    changing.current = true; requestVersion.current++; setBusy(true); setError('');
    try { const next = await api<AccessStatus>('/auth/logout', {}); requestVersion.current++; update(next); }
    catch (error) { setError(message(error)); window.alert('退出登录失败：' + message(error)); }
    finally { changing.current = false; setBusy(false); }
  }

  const locked = !status?.authenticated;
  return <>
    {opened && <div className="access-workspace" hidden={locked} inert={locked}><App onLogout={status?.required ? logout : undefined} /></div>}
    {locked && <main className="access-page"><section className="access-card" aria-labelledby="access-title">
      <PiMark size={42} /><span className="access-brand">PiCoding</span>
      <h1 id="access-title">{status ? '登录你的工作台' : error ? '暂时无法连接' : '正在连接工作台…'}</h1>
      <p>{status ? '使用部署时设置的访问密码，继续你的项目。' : '连接成功后即可继续工作。'}</p>
      {status ? <form onSubmit={event => void login(event)}>
        <label htmlFor="access-password">访问密码</label>
        <div className="access-password"><input ref={passwordField} id="access-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required maxLength={256} value={password} onChange={event => { setPassword(event.target.value); setError(''); }} disabled={busy} aria-describedby="access-help" />
          <button type="button" disabled={busy} aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? '隐藏' : '显示'}</button></div>
        <p className="access-help" id="access-help">忘记密码？请联系这套工作台的管理员。</p>
        {error && <div className="inline-error" role="alert">{error}</div>}
        <button className="button primary access-submit" disabled={!password || busy}>{busy ? '正在登录…' : '进入工作台'}</button>
      </form> : error && <><div className="inline-error" role="alert">{error}</div><button className="button primary access-submit" onClick={() => void refresh()}>重新连接</button></>}
      <small>项目和对话保存在这套私有工作台中。</small>
    </section></main>}
  </>;
}
