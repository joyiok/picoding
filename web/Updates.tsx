import { useEffect, useRef, useState } from 'react';
import { updateActive, type UpdateStatus } from '../shared/updates';
import { api, ApiError, message } from './api';
import './Updates.css';

export function Updates({ blockedReason }: { blockedReason?: string }) {
  const [status, setStatus] = useState<UpdateStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [disconnected, setDisconnected] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const confirmation = useRef<HTMLDivElement>(null);
  const updateButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const active = updateActive(status?.job);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    if (confirming) confirmation.current?.focus();
    else if (returnFocus.current) { returnFocus.current = false; updateButton.current?.focus(); }
  }, [confirming]);
  useEffect(() => {
    mounted.current = true;
    let polling = false;
    const refresh = async () => {
      if (polling || inFlight.current) return;
      polling = true;
      try {
        const next = await api<UpdateStatus>('/updates');
        if (mounted.current) { setStatus(previous => ({ ...next, latest: next.latest || previous?.latest, checkedAt: next.checkedAt || previous?.checkedAt })); setDisconnected(false); setConnectionError(''); }
      } catch (error) {
        if (mounted.current) {
          if (error instanceof ApiError && error.status === 401) setConnectionError('服务已重启，请重新登录后查看更新结果。');
          else { setDisconnected(true); setConnectionError(message(error)); }
        }
      } finally { polling = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => { mounted.current = false; clearInterval(timer); };
  }, []);
  async function check() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setConfirming(false);
    try { const value = await api<UpdateStatus>('/updates/check', {}); if (mounted.current) { setStatus(value); setDisconnected(false); } }
    catch (error) { if (mounted.current) { setError(message(error)); setStatus(previous => previous && ({ ...previous, latest: undefined, available: false, checkedAt: undefined })); } }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function install() {
    if (inFlight.current || !status?.latest) return;
    inFlight.current = true; setBusy(true); setError('');
    try { const value = await api<UpdateStatus>('/updates/install', { commit: status.latest.commit }); if (mounted.current) { setStatus(value); setConfirming(false); } }
    catch (error) { if (mounted.current) setError(message(error)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  const unavailable = blockedReason || status?.disabledReason;
  const job = status?.job;
  return <section className="system-updates" aria-labelledby="updates-heading">
    <h3 id="updates-heading">保持工作台最新</h3>
    <p>从公开仓库的 main 分支获取更新。更新前会完整备份模型配置、访问密码、对话和项目。</p>
    <dl className="update-versions">
      <div><dt>当前版本</dt><dd>{status ? `v${status.current.version}` : '正在读取…'}{status?.current.commit && <code>{status.current.commit.slice(0, 8)}</code>}{status?.current.dirty && <span>含本地修改</span>}</dd></div>
      <div><dt>最新版本</dt><dd>{status?.latest ? <a href={status.latest.url} target="_blank" rel="noreferrer">{status.latest.commit.slice(0, 8)}</a> : '点击检查更新'}</dd></div>
    </dl>
    {status?.latest && <div className="update-release"><strong>{status.latest.title}</strong><small>{new Date(status.latest.date).toLocaleString('zh-CN')}</small></div>}
    {status?.checkedAt && !active && <p className="update-result" role="status">{status.available ? '有新版本可用。' : '当前已是最新版本。'}</p>}
    {job && <div className={`update-progress${job.phase === 'failed' ? ' update-failed' : ''}`} role="status" aria-live="polite"><strong>{job.phase === 'succeeded' ? '更新完成' : job.phase === 'failed' ? '更新未完成' : '正在更新工作台'}</strong><p>{job.message}</p>{active && <small>{disconnected ? '服务正在重启，页面会继续尝试连接。' : job.phase === 'queued' && Date.now() - Date.parse(job.startedAt) > 90_000 ? '更新服务暂未响应，请联系服务器管理员检查。' : '可以关闭此窗口，稍后回来查看进度。'}</small>}</div>}
    {unavailable && !active && <p className="update-help">{unavailable}{!status?.enabled && <a href="https://github.com/joyiok/picoding/blob/main/DEPLOYMENT.md#设置页一键更新" target="_blank" rel="noreferrer">查看安装步骤</a>}</p>}
    {(error || connectionError) && <p className="inline-error" role="alert">{active && disconnected ? '暂时无法连接更新服务，正在自动重试。' : error || connectionError}</p>}
    {confirming && !active && <div className="update-confirm" ref={confirmation} role="group" tabIndex={-1} aria-labelledby="updates-confirm-warning"><p id="updates-confirm-warning">更新会停止任务环境并重启工作台。请先保存未保存的编辑；重启后需要重新登录，任务环境可手动恢复。</p><div><button type="button" className="button secondary" disabled={busy} onClick={() => { returnFocus.current = true; setConfirming(false); }}>暂不更新</button><button type="button" className="button primary" disabled={busy || Boolean(unavailable)} onClick={() => void install()}>{busy ? '正在提交…' : '确认更新'}</button></div></div>}
    {!confirming && <div className="update-actions"><button type="button" className="button secondary" disabled={busy || active} onClick={() => void check()}>{busy ? '正在检查…' : '检查更新'}</button>{job?.phase === 'succeeded' && !status?.available ? <button type="button" className="button primary" onClick={() => window.location.reload()}>加载新版本</button> : <button type="button" ref={updateButton} className="button primary" disabled={busy || active || !status?.available || Boolean(unavailable) || disconnected} onClick={() => setConfirming(true)}>{active ? '更新进行中…' : job?.phase === 'failed' ? '重试更新' : '立即更新'}</button>}</div>}
  </section>;
}
