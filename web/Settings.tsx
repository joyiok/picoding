import { useEffect, useRef, useState } from 'react';
import { defaultModelCapabilities, type APIProtocol, type PublicSettings } from '../shared/types';
import { api, message } from './api';
import { Icon } from './Icon';
import type { ModelConnection } from '../shared/connection';

export function Settings({ initial, onClose, onSaved }: { initial?: PublicSettings; onClose: () => void; onSaved: (value: PublicSettings) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const probe = useRef<AbortController | null>(null);
  const [protocol, setProtocol] = useState<APIProtocol>(initial?.protocol || 'openai');
  const [model, setModel] = useState(initial?.model || '');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl || '');
  const [apiKey, setApiKey] = useState('');
  const [contextWindow, setContextWindow] = useState(String(initial?.contextWindow ?? defaultModelCapabilities.contextWindow));
  const [maxTokens, setMaxTokens] = useState(String(initial?.maxTokens ?? defaultModelCapabilities.maxTokens));
  const [supportsImages, setSupportsImages] = useState(initial?.supportsImages ?? defaultModelCapabilities.supportsImages);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connection, setConnection] = useState<ModelConnection>();
  const [connectionError, setConnectionError] = useState('');
  const busy = saving || testing;
  const normalize = (url: string) => url.trim().replace(/\/+$/, '');
  const retainingKey = Boolean(initial?.hasApiKey && initial.protocol === protocol && normalize(initial.baseUrl) === normalize(baseUrl));
  const contextLimit = Number(contextWindow);
  const outputLimit = Number(maxTokens);
  const validLimits = Number.isSafeInteger(contextLimit) && contextLimit > 0 && Number.isSafeInteger(outputLimit) && outputLimit > 0 && outputLimit <= contextLimit;
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => () => { probe.current?.abort(); }, []);
  useEffect(() => { setConnection(undefined); setConnectionError(''); setError(''); }, [protocol, model, baseUrl, apiKey, contextWindow, maxTokens, supportsImages]);
  const candidate = () => ({ protocol, model, baseUrl, contextWindow: contextLimit, maxTokens: outputLimit, supportsImages, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
  function cancelTest() {
    probe.current?.abort(); probe.current = null;
    setTesting(false); setConnection(undefined); setConnectionError('');
  }
  async function testConnection() {
    if (busy || !form.current?.reportValidity()) return;
    const controller = new AbortController(); probe.current = controller;
    setTesting(true); setConnection(undefined); setConnectionError(''); setError('');
    try { const result = await api<ModelConnection>('/settings/test', candidate(), 'POST', controller.signal); if (probe.current === controller && !controller.signal.aborted) setConnection(result); }
    catch (error) { if (probe.current === controller && !controller.signal.aborted) setConnectionError(message(error)); }
    finally { if (probe.current === controller) { setTesting(false); probe.current = null; } }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setSaving(true); setError('');
    try { onSaved(await api<PublicSettings>('/settings', candidate())); onClose(); }
    catch (error) { setError(message(error)); }
    finally { setSaving(false); }
  }
  return <dialog className="settings-dialog" ref={dialog} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget && !saving) onClose(); }} aria-labelledby="settings-title">
    <form onSubmit={save} ref={form}>
      <div className="dialog-heading"><div><h2 id="settings-title">连接你的模型</h2><p>选择 API 格式，填写你使用的服务地址和模型。</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭模型设置" disabled={saving}><Icon name="close" /></button></div>
      <div className="settings-body">
      <label htmlFor="protocol">API 格式</label>
      <select id="protocol" value={protocol} onChange={event => setProtocol(event.target.value as APIProtocol)} disabled={busy}><option value="openai">OpenAI 格式</option><option value="anthropic">Anthropic 格式</option></select>
      <label htmlFor="base-url">API 地址</label>
      <input id="base-url" type="url" placeholder="填写服务商提供的 API 基础地址" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} disabled={busy} required autoComplete="off" aria-describedby="base-url-help" />
      <p className="field-help" id="base-url-help">{protocol === 'openai' ? '通常填写到 /v1，不包含 /chat/completions。' : '通常填写服务根地址，不包含 /v1/messages。'}以服务商说明为准。</p>
      <label htmlFor="model">模型 ID</label>
      <input id="model" placeholder="填写你要使用的模型 ID" value={model} onChange={event => setModel(event.target.value)} disabled={busy} required autoComplete="off" aria-describedby="model-help" />
      <p className="field-help" id="model-help">填写服务商提供的准确模型 ID。</p>
      <label htmlFor="api-key">API Key {retainingKey && <span className="configured-key">已保存</span>}</label>
      <div className="key-field"><input id="api-key" type={showKey ? 'text' : 'password'} placeholder={retainingKey ? '留空保留现有密钥' : '输入 API Key'} value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" disabled={busy} required={!retainingKey} /><button type="button" onClick={() => setShowKey(!showKey)} disabled={busy}>{showKey ? '隐藏' : '显示'}</button></div>
      <p className="field-help">密钥保存在本机后端，任务电脑中的项目进程无法读取。</p>
      <div className="model-limits">
        <div><label htmlFor="context-window">上下文 Token 数</label><input id="context-window" type="number" inputMode="numeric" min="1" max={Number.MAX_SAFE_INTEGER} step="1" value={contextWindow} onChange={event => setContextWindow(event.target.value)} disabled={busy} required aria-describedby="limits-help" /></div>
        <div><label htmlFor="max-tokens">最大输出 Token 数</label><input id="max-tokens" type="number" inputMode="numeric" min="1" max={contextLimit > 0 ? contextLimit : Number.MAX_SAFE_INTEGER} step="1" value={maxTokens} onChange={event => setMaxTokens(event.target.value)} disabled={busy} required aria-describedby="limits-help" /></div>
      </div>
      <p className="field-help" id="limits-help">以模型说明为准。每次回复的输出上限不能大于上下文容量。</p>
      <label htmlFor="supports-images" className="capability-toggle"><input id="supports-images" type="checkbox" checked={supportsImages} onChange={event => setSupportsImages(event.target.checked)} disabled={busy} aria-describedby="images-help" /><span>支持图片输入</span></label>
      <p className="field-help" id="images-help">{supportsImages ? '允许将浏览器截图发给模型。仅在模型支持图片时开启。' : '关闭时使用网页结构和文字操作浏览器，不向模型发送截图。'}</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      </div>
      <div className="dialog-footer model-settings-footer">
        <p className={'connection-status' + (connectionError ? ' connection-failed' : connection ? ' connection-succeeded' : '')} role={connectionError ? 'alert' : 'status'}>{testing ? '正在向模型发送短请求… 最多等待 15 秒。' : connectionError || (connection ? `连接成功 · ${(connection.latencyMs / 1000).toFixed(1)} 秒。尚未保存，点击保存设置后生效。` : '测试连接会发送一次短请求，验证地址、密钥和模型。')}</p>
        <div className="settings-buttons"><button type="button" className="button secondary" onClick={testing ? cancelTest : onClose} disabled={saving}>{testing ? '取消测试' : '取消'}</button><button type="button" className="button secondary" onClick={() => void testConnection()} disabled={busy || !model.trim() || !baseUrl.trim() || !validLimits}>{testing ? '正在测试…' : '测试连接'}</button><button type="submit" className="button primary" disabled={busy || !model.trim() || !baseUrl.trim() || !validLimits}>{saving ? '正在保存…' : '保存设置'}</button></div>
      </div>
    </form>
  </dialog>;
}
