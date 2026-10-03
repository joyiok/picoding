import { useEffect, useRef, useState } from 'react';
import { defaultModelCapabilities, type APIProtocol, type PublicProvider, type PublicSettings } from '../shared/types';
import { api, message } from './api';
import { Icon } from './Icon';
import type { ModelConnection } from '../shared/connection';
import { Updates } from './Updates';

type Draft = { providerName: string; protocol: APIProtocol; model: string; baseUrl: string; apiKey: string; contextWindow: string; maxTokens: string; supportsImages: boolean };
function draftFor(settings?: PublicSettings, provider?: PublicProvider, modelId?: string): Draft {
  const model = provider?.models.find(model => model.id === modelId);
  const value = provider ? model || defaultModelCapabilities : settings || defaultModelCapabilities;
  return { providerName: provider?.name || '', protocol: provider?.protocol || settings?.protocol || 'openai', model: model?.model || (!provider ? settings?.model : '') || '', baseUrl: provider?.baseUrl || settings?.baseUrl || '', apiKey: '', contextWindow: String(value.contextWindow), maxTokens: String(value.maxTokens), supportsImages: value.supportsImages };
}

export function Settings({ initial, onClose, onSaved, blockedReason }: { initial?: PublicSettings; onClose: () => void; onSaved: (value: PublicSettings) => void; blockedReason?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const probe = useRef<AbortController | null>(null);
  const drafts = useRef(new Map<string, Draft>());
  const providerDrafts = useRef(new Map<string, Pick<Draft, 'providerName' | 'protocol' | 'baseUrl' | 'apiKey'>>());
  const [catalog, setCatalog] = useState(initial);
  const [section, setSection] = useState<'models' | 'updates'>('models');
  const [providerId, setProviderId] = useState(initial?.activeProviderId || '');
  const [modelId, setModelId] = useState(initial?.activeModelId || '');
  const [draft, setDraft] = useState(() => draftFor(initial, initial?.providers?.find(provider => provider.id === initial.activeProviderId), initial?.activeModelId));
  const { providerName, protocol, model, baseUrl, apiKey, contextWindow, maxTokens, supportsImages } = draft;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connection, setConnection] = useState<ModelConnection>();
  const [connectionError, setConnectionError] = useState('');
  const busy = saving || testing;
  const providers = catalog?.providers || [];
  const provider = providers.find(provider => provider.id === providerId);
  const normalize = (url: string) => url.trim().replace(/\/+$/, '');
  const retainingKey = Boolean(provider?.hasApiKey && provider.protocol === protocol && normalize(provider.baseUrl) === normalize(baseUrl));
  const contextLimit = Number(contextWindow), outputLimit = Number(maxTokens);
  const validLimits = Number.isSafeInteger(contextLimit) && contextLimit > 0 && Number.isSafeInteger(outputLimit) && outputLimit > 0 && outputLimit <= contextLimit;
  const valid = Boolean(providerName.trim() && model.trim() && baseUrl.trim() && validLimits);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => () => { probe.current?.abort(); }, []);
  useEffect(() => { setConnection(undefined); setConnectionError(''); setError(''); }, [draft, providerId, modelId]);
  function edit<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft(draft => ({ ...draft, [key]: value })); }
  function choose(nextProviderId: string, nextModelId?: string) {
    drafts.current.set(providerId + ':' + modelId, draft);
    providerDrafts.current.set(providerId, { providerName, protocol, baseUrl, apiKey });
    const nextProvider = providers.find(provider => provider.id === nextProviderId);
    const nextId = nextModelId ?? nextProvider?.selectedModelId ?? '';
    setProviderId(nextProviderId); setModelId(nextId); setShowKey(false);
    setDraft({ ...(drafts.current.get(nextProviderId + ':' + nextId) || draftFor(undefined, nextProvider, nextId)), ...providerDrafts.current.get(nextProviderId) });
  }
  const candidate = () => ({ providerId: providerId || null, modelId: modelId || null, providerName, protocol, model, baseUrl, contextWindow: contextLimit, maxTokens: outputLimit, supportsImages, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
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
    if (busy || blockedReason) return;
    setSaving(true); setError('');
    try { onSaved(await api<PublicSettings>('/settings', candidate())); onClose(); }
    catch (error) { setError(message(error)); }
    finally { setSaving(false); }
  }
  async function remove(kind: 'provider' | 'model') {
    if (busy || blockedReason || !provider) return;
    const removingProvider = kind === 'provider' || provider.models.length === 1;
    if (!confirm(removingProvider ? `删除供应商「${provider.name}」及其已保存的模型和密钥？` : `删除已保存的模型「${provider.models.find(item => item.id === modelId)?.model}」？`)) return;
    setSaving(true); setError('');
    try {
      const value = await api<PublicSettings>(`/settings/providers/${encodeURIComponent(providerId)}${kind === 'model' ? '/models/' + encodeURIComponent(modelId) : ''}`, undefined, 'DELETE');
      setCatalog(value); onSaved(value);
      for (const key of drafts.current.keys()) if (removingProvider ? key.startsWith(providerId + ':') : key === providerId + ':' + modelId) drafts.current.delete(key);
      if (removingProvider) providerDrafts.current.delete(providerId);
      setProviderId(value.activeProviderId || ''); setModelId(value.activeModelId || ''); setShowKey(false);
      const nextProviderId = value.activeProviderId || '', nextModelId = value.activeModelId || '';
      setDraft({ ...(drafts.current.get(nextProviderId + ':' + nextModelId) || draftFor(value, value.providers.find(item => item.id === nextProviderId), nextModelId)), ...providerDrafts.current.get(nextProviderId) });
    } catch (error) { setError(message(error)); }
    finally { setSaving(false); }
  }
  return <dialog className="settings-dialog" ref={dialog} onCancel={event => { if (saving) event.preventDefault(); else onClose(); }} onClick={event => { if (event.target === event.currentTarget && !saving) onClose(); }} aria-labelledby="settings-title">
    <form onSubmit={save} ref={form}>
      <div className="dialog-heading"><div><h2 id="settings-title">{section === 'models' ? '模型和供应商' : '系统更新'}</h2><p>{section === 'models' ? '保存常用连接，随时从顶部切换模型。' : '查看版本与进度，更新你的工作台。'}</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭模型设置" disabled={saving}><Icon name="close" /></button></div>
      <nav className="settings-tabs" aria-label="设置分类"><button type="button" aria-pressed={section === 'models'} disabled={busy} onClick={() => setSection('models')}>模型和供应商</button><button type="button" aria-pressed={section === 'updates'} disabled={busy} onClick={() => setSection('updates')}>系统更新</button></nav>
      <div className="settings-body" hidden={section !== 'models'}>
      {providers.length > 0 && <div className="saved-connections">
        <div><div className="connection-label"><label htmlFor="saved-provider">供应商</label>{provider && <button type="button" className="text-button" disabled={busy || Boolean(blockedReason)} onClick={() => void remove('provider')}>删除供应商</button>}</div><select id="saved-provider" value={providerId} onChange={event => choose(event.target.value)} disabled={busy}>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}<option value="">添加供应商…</option></select></div>
        <div><div className="connection-label"><label htmlFor="saved-model">已保存的模型</label>{provider && modelId && <button type="button" className="text-button" disabled={busy || Boolean(blockedReason)} onClick={() => void remove('model')}>删除模型</button>}</div><select id="saved-model" value={modelId} onChange={event => choose(providerId, event.target.value)} disabled={busy || !provider}>{provider?.models.map(model => <option key={model.id} value={model.id}>{model.model}</option>)}<option value="">添加模型…</option></select></div>
      </div>}
      {blockedReason && <p className="settings-notice" role="status">{blockedReason}你可以填写配置或测试连接。</p>}
      <label htmlFor="provider-name">供应商名称</label>
      <input id="provider-name" placeholder="填写便于识别的名称" value={providerName} onChange={event => edit('providerName', event.target.value)} disabled={busy} required maxLength={80} autoComplete="off" />
      <label htmlFor="protocol">API 格式</label>
      <select id="protocol" value={protocol} onChange={event => edit('protocol', event.target.value as APIProtocol)} disabled={busy}><option value="openai">OpenAI 格式</option><option value="anthropic">Anthropic 格式</option></select>
      <label htmlFor="base-url">API 地址</label>
      <input id="base-url" type="url" placeholder="填写服务商提供的 API 基础地址" value={baseUrl} onChange={event => edit('baseUrl', event.target.value)} disabled={busy} required maxLength={2048} autoComplete="off" aria-describedby="base-url-help" />
      <p className="field-help" id="base-url-help">{protocol === 'openai' ? '通常填写到 /v1，不包含 /chat/completions。' : '通常填写服务根地址，不包含 /v1/messages。'}以服务商说明为准。</p>
      <label htmlFor="api-key">API Key {retainingKey && <span className="configured-key">已保存</span>}</label>
      <div className="key-field"><input id="api-key" type={showKey ? 'text' : 'password'} placeholder={retainingKey ? '留空保留此供应商的密钥' : '输入 API Key'} value={apiKey} onChange={event => edit('apiKey', event.target.value)} autoComplete="off" disabled={busy} required={!retainingKey} /><button type="button" onClick={() => setShowKey(!showKey)} disabled={busy}>{showKey ? '隐藏' : '显示'}</button></div>
      <p className="field-help">地址和密钥由此供应商的模型共用。密钥保存在本机后端。</p>
      <div className="model-fields">
      <label htmlFor="model">模型 ID</label>
      <input id="model" placeholder="填写你要使用的模型 ID" value={model} onChange={event => edit('model', event.target.value)} disabled={busy} required maxLength={200} autoComplete="off" aria-describedby="model-help" />
      <p className="field-help" id="model-help">填写服务商提供的准确模型 ID，能力设置按模型分别保存。</p>
      <div className="model-limits">
        <div><label htmlFor="context-window">上下文 Token 数</label><input id="context-window" type="number" inputMode="numeric" min="1" max={Number.MAX_SAFE_INTEGER} step="1" value={contextWindow} onChange={event => edit('contextWindow', event.target.value)} disabled={busy} required aria-describedby="limits-help" /></div>
        <div><label htmlFor="max-tokens">最大输出 Token 数</label><input id="max-tokens" type="number" inputMode="numeric" min="1" max={contextLimit > 0 ? contextLimit : Number.MAX_SAFE_INTEGER} step="1" value={maxTokens} onChange={event => edit('maxTokens', event.target.value)} disabled={busy} required aria-describedby="limits-help" /></div>
      </div>
      <p className="field-help" id="limits-help">以模型说明为准。每次回复的输出上限不能大于上下文容量。</p>
      <label htmlFor="supports-images" className="capability-toggle"><input id="supports-images" type="checkbox" checked={supportsImages} onChange={event => edit('supportsImages', event.target.checked)} disabled={busy} aria-describedby="images-help" /><span>支持图片输入</span></label>
      <p className="field-help" id="images-help">{supportsImages ? '允许将浏览器截图发给模型。仅在模型支持图片时开启。' : '关闭时使用网页结构和文字操作浏览器，不向模型发送截图。'}</p>
      </div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      </div>
      {section === 'updates' && <Updates blockedReason={blockedReason} />}
      <div className="dialog-footer model-settings-footer" hidden={section !== 'models'}>
        <p className={'connection-status' + (connectionError ? ' connection-failed' : connection ? ' connection-succeeded' : '')} role={connectionError ? 'alert' : 'status'}>{testing ? '正在向模型发送短请求… 最多等待 15 秒。' : connectionError || (connection ? `连接成功 · ${(connection.latencyMs / 1000).toFixed(1)} 秒。尚未保存，点击保存设置后生效。` : '测试连接会发送一次短请求。保存设置后，此模型将用于工作台后续消息。')}</p>
        <div className="settings-buttons"><button type="button" className="button secondary" onClick={testing ? cancelTest : onClose} disabled={saving}>{testing ? '取消测试' : '取消'}</button><button type="button" className="button secondary" onClick={() => void testConnection()} disabled={busy || !valid}>{testing ? '正在测试…' : '测试连接'}</button><button type="submit" className="button primary" disabled={busy || !valid || Boolean(blockedReason)}>{saving ? '正在保存…' : '保存设置'}</button></div>
      </div>
    </form>
  </dialog>;
}
