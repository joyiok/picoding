import { useEffect, useId, useRef, useState } from 'react';
import type { PublicSettings } from '../shared/types';
import { api, message } from './api';
import { Icon } from './Icon';

export function ModelSwitch({ settings, blockedReason, onSaved, onManage }: { settings?: PublicSettings; blockedReason?: string; onSaved: (value: PublicSettings) => void; onManage: () => void }) {
  const [open, setOpen] = useState(false);
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const providers = settings?.providers || [];
  const provider = providers.find(provider => provider.id === providerId);
  const activeProvider = providers.find(provider => provider.id === settings?.activeProviderId);
  const current = activeProvider ? activeProvider.name + ' · ' + settings?.model : settings?.model;
  const unchanged = providerId === settings?.activeProviderId && modelId === settings?.activeModelId;
  function toggle() {
    if (!providers.length) { onManage(); return; }
    if (!open) { setProviderId(settings?.activeProviderId || ''); setModelId(settings?.activeModelId || ''); setError(''); }
    setOpen(!open);
  }
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!saving && !container.current?.contains(event.target as Node)) setOpen(false); };
    const keys = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', keys);
    container.current?.querySelector<HTMLSelectElement>('select')?.focus();
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keys); };
  }, [open, saving]);
  async function select(event: React.FormEvent) {
    event.preventDefault();
    if (saving || blockedReason || unchanged || !providerId || !modelId) return;
    setSaving(true); setError('');
    try { onSaved(await api<PublicSettings>('/settings/select', { providerId, modelId })); setOpen(false); trigger.current?.focus(); }
    catch (error) { setError(message(error)); }
    finally { setSaving(false); }
  }
  return <div className="model-picker" ref={container}>
    <button ref={trigger} className="model-button" aria-expanded={open} aria-controls={id} disabled={saving} title={settings?.configured ? `当前模型：${current}` : '连接模型'} onClick={toggle}>
      <span className={`status-dot ${settings?.configured ? 'online' : ''}`} /><span>{settings?.configured ? current : '连接模型'}</span><Icon name="down" size={13} />
    </button>
    {open && <form id={id} className="model-menu" onSubmit={event => void select(event)} aria-label="切换模型">
      <h2>切换模型</h2>
      <label htmlFor={id + '-provider'}>供应商</label>
      <select id={id + '-provider'} value={providerId} disabled={saving} onChange={event => { const selected = providers.find(provider => provider.id === event.target.value); setProviderId(event.target.value); setModelId(selected?.selectedModelId || selected?.models[0]?.id || ''); setError(''); }}>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select>
      <label htmlFor={id + '-model'}>模型</label>
      <select id={id + '-model'} value={modelId} disabled={saving} onChange={event => { setModelId(event.target.value); setError(''); }}>{provider?.models.map(model => <option key={model.id} value={model.id}>{model.model}</option>)}</select>
      <p className="field-help" role="status">{blockedReason || (!provider?.hasApiKey ? '此供应商尚未配置密钥，请打开模型设置。' : '用于工作台后续消息，已有对话会保留。')}</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="model-menu-actions"><button className="text-button" type="button" disabled={saving} onClick={() => { setOpen(false); onManage(); }}>模型设置<Icon name="chevron" size={13} /></button><button className="button primary" type="submit" disabled={saving || unchanged || Boolean(blockedReason) || !provider?.hasApiKey}>{saving ? '正在切换…' : unchanged ? '正在使用' : '使用此模型'}</button></div>
    </form>}
  </div>;
}
