import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { defaultModelCapabilities, type APIProtocol, type ModelCapabilities, type ModelSettings, type ModelSettingsInput, type ModelSelection, type PublicProvider, type PublicSettings, type SavedModel } from '../shared/types.js';
import { config } from './config.js';
import { HttpError, requireString } from './http.js';

interface Provider extends Omit<PublicProvider, 'hasApiKey'> { apiKey?: string; useEnvironmentKey?: boolean; }
interface StoredSettings { version: 2; providers: Provider[]; activeProviderId?: string; activeModelId?: string; }

function capabilities(value: ModelCapabilities): ModelCapabilities {
  if (!Number.isSafeInteger(value.contextWindow) || value.contextWindow <= 0) throw new HttpError(400, '上下文 Token 数必须是正整数');
  if (!Number.isSafeInteger(value.maxTokens) || value.maxTokens <= 0) throw new HttpError(400, '最大输出 Token 数必须是正整数');
  if (value.maxTokens > value.contextWindow) throw new HttpError(400, '最大输出 Token 数不能超过上下文 Token 数');
  if (typeof value.supportsImages !== 'boolean') throw new HttpError(400, '图片支持必须是勾选状态');
  return { contextWindow: value.contextWindow, maxTokens: value.maxTokens, supportsImages: value.supportsImages };
}

function protocol(value: unknown): APIProtocol {
  if (value !== 'anthropic' && value !== 'openai') throw new HttpError(400, '请选择 OpenAI 或 Anthropic API 格式');
  return value;
}

function endpoint(value: unknown) {
  let url: URL;
  try { url = new URL(requireString(value, 'API 地址', 2048).trim()); }
  catch { throw new HttpError(400, '请输入有效的 API 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new HttpError(400, 'API 地址必须是 HTTP 或 HTTPS 基础地址');
  return url.href.replace(/\/+$/, '');
}

export class SettingsStore {
  private state: StoredSettings = { version: 2, providers: [] };
  private fallback: ModelSettings = {
    ...defaultModelCapabilities,
    protocol: process.env.PICODING_API_PROTOCOL === 'anthropic' ? 'anthropic' : 'openai',
    model: process.env.PICODING_MODEL || '',
    baseUrl: process.env.PICODING_API_BASE_URL || '',
  };
  private readonly file: string;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(readonly directory = config.dataDir) { this.file = join(directory, 'settings.json'); }

  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved) || (saved.version !== undefined && saved.version !== 2)) throw new Error('模型设置文件版本无效');
      if (saved.version === 2) {
        if (!Array.isArray(saved.providers) || saved.providers.length > 50) throw new Error('供应商设置文件无效');
        const providers: Provider[] = saved.providers.map((item: Provider) => {
          if (!Array.isArray(item.models) || !item.models.length || item.models.length > 100) throw new Error('模型设置文件无效');
          if (item.apiKey !== undefined && typeof item.apiKey !== 'string') throw new Error('密钥设置文件无效');
          const models = item.models.map(model => ({ id: requireString(model.id, '模型配置 ID', 100), model: requireString(model.model, '模型 ID', 200), ...capabilities(model) }));
          if (new Set(models.map(model => model.id)).size !== models.length) throw new Error('模型配置 ID 重复');
          return { id: requireString(item.id, '供应商 ID', 100), name: requireString(item.name, '供应商名称', 80), protocol: protocol(item.protocol), baseUrl: endpoint(item.baseUrl), apiKey: item.apiKey, useEnvironmentKey: item.useEnvironmentKey === true, models, selectedModelId: models.find(model => model.id === item.selectedModelId)?.id || models[0].id };
        });
        if (new Set(providers.map(provider => provider.id)).size !== providers.length) throw new Error('供应商 ID 重复');
        const active = providers.find(provider => provider.id === saved.activeProviderId);
        if (providers.length && !active?.models.some(model => model.id === saved.activeModelId)) throw new Error('当前模型设置无效');
        this.state = { version: 2, providers, activeProviderId: active?.id, activeModelId: active ? saved.activeModelId : undefined };
        this.fallback = { ...defaultModelCapabilities, protocol: 'openai', model: '', baseUrl: '' };
        return;
      }
      // Preserve credentials, capabilities and legacy service-based settings.
      this.fallback = {
        ...capabilities({ contextWindow: saved.contextWindow === undefined ? defaultModelCapabilities.contextWindow : saved.contextWindow, maxTokens: saved.maxTokens === undefined ? defaultModelCapabilities.maxTokens : saved.maxTokens, supportsImages: saved.supportsImages === undefined ? Boolean(saved.model) : saved.supportsImages }),
        protocol: saved.protocol === 'anthropic' || saved.provider === 'anthropic' ? 'anthropic' : 'openai',
        model: typeof saved.model === 'string' ? saved.model : '', baseUrl: typeof saved.baseUrl === 'string' ? saved.baseUrl : '', apiKey: typeof saved.apiKey === 'string' ? saved.apiKey : undefined,
      };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (this.fallback.baseUrl && this.fallback.model) {
      const value = this.fallback, model: SavedModel = { id: randomUUID(), model: value.model, ...capabilities(value) };
      const provider: Provider = { id: randomUUID(), name: new URL(value.baseUrl).hostname, protocol: value.protocol, baseUrl: endpoint(value.baseUrl), apiKey: value.apiKey, useEnvironmentKey: !value.apiKey, models: [model], selectedModelId: model.id };
      this.state = { version: 2, providers: [provider], activeProviderId: provider.id, activeModelId: model.id };
    }
  }

  private provider(id = this.state.activeProviderId) { return this.state.providers.find(provider => provider.id === id); }
  private providerKey(provider: Provider) { return provider.apiKey || (provider.useEnvironmentKey ? process.env[provider.protocol === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'] : undefined); }
  get(): ModelSettings {
    const provider = this.provider(), model = provider?.models.find(model => model.id === this.state.activeModelId);
    if (!provider || !model) return { ...this.fallback };
    return { protocol: provider.protocol, baseUrl: provider.baseUrl, model: model.model, ...capabilities(model), apiKey: provider.apiKey };
  }
  key() {
    const provider = this.provider();
    return provider ? this.providerKey(provider) : this.fallback.apiKey || (this.fallback.baseUrl ? process.env[this.fallback.protocol === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'] : undefined);
  }
  public(): PublicSettings {
    const { apiKey: _key, ...safe } = this.get();
    const hasApiKey = Boolean(this.key());
    const providers = this.state.providers.map(provider => ({ id: provider.id, name: provider.name, protocol: provider.protocol, baseUrl: provider.baseUrl, selectedModelId: provider.selectedModelId, models: provider.models.map(model => ({ ...model })), hasApiKey: Boolean(this.providerKey(provider)) }));
    return { ...safe, hasApiKey, configured: Boolean(hasApiKey && safe.baseUrl && safe.model), providers, activeProviderId: this.state.activeProviderId, activeModelId: this.state.activeModelId };
  }

  private candidate(value: ModelSettingsInput) {
    const apiProtocol = protocol(value.protocol), modelName = requireString(value.model, '模型 ID', 200).trim(), baseUrl = endpoint(value.baseUrl);
    const existing = value.providerId === null ? undefined : this.provider(value.providerId);
    if (value.providerId != null && !existing) throw new HttpError(404, '供应商已移除，请重新选择');
    const modelId = value.modelId === undefined ? (existing?.id === this.state.activeProviderId ? this.state.activeModelId : existing?.selectedModelId) : value.modelId;
    const oldModel = modelId ? existing?.models.find(model => model.id === modelId) : undefined;
    if (modelId && !oldModel) throw new HttpError(404, '模型已移除，请重新选择');
    const defaults = oldModel || (existing ? defaultModelCapabilities : this.fallback);
    const limits = capabilities({ contextWindow: value.contextWindow === undefined ? defaults.contextWindow : value.contextWindow, maxTokens: value.maxTokens === undefined ? defaults.maxTokens : value.maxTokens, supportsImages: value.supportsImages === undefined ? defaults.supportsImages : value.supportsImages });
    if (value.apiKey !== undefined && typeof value.apiKey !== 'string') throw new HttpError(400, 'API Key 必须是文本');
    const reference = existing || (value.providerId !== null ? this.fallback : undefined);
    const sameEndpoint = reference?.protocol === apiProtocol && reference.baseUrl.replace(/\/+$/, '') === baseUrl;
    const apiKey = value.apiKey?.trim() || (sameEndpoint ? reference?.apiKey : undefined);
    if (!apiKey && !sameEndpoint && (existing ? this.providerKey(existing) : value.providerId !== null && this.key())) throw new HttpError(400, '更换 API 格式或地址时，请重新填写密钥');
    const useEnvironmentKey = Boolean(sameEndpoint && !apiKey && (existing?.useEnvironmentKey || (!existing && value.providerId !== null)));
    const name = value.providerName === undefined ? existing?.name || new URL(baseUrl).hostname : requireString(value.providerName, '供应商名称', 80).trim();
    if (existing?.models.some(model => model.id !== oldModel?.id && model.model === modelName)) throw new HttpError(409, '该供应商已保存此模型，请选择后编辑');
    return { existing, oldModel, name, useEnvironmentKey, settings: { protocol: apiProtocol, model: modelName, baseUrl, ...limits, apiKey } };
  }

  preview(value: ModelSettingsInput): ModelSettings {
    const { settings, useEnvironmentKey } = this.candidate(value);
    return { ...settings, apiKey: settings.apiKey || (useEnvironmentKey ? process.env[settings.protocol === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'] : undefined) };
  }

  private mutate(build: () => StoredSettings) {
    const operation = this.writes.then(async () => {
      const next = build();
      await writeFile(`${this.file}.tmp`, JSON.stringify(next), { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
      this.state = next;
      this.fallback = { ...defaultModelCapabilities, protocol: 'openai', model: '', baseUrl: '' };
      return this.public();
    });
    this.writes = operation.catch(() => {});
    return operation;
  }

  update(value: ModelSettingsInput) {
    return this.mutate(() => {
      const { existing, oldModel, name, useEnvironmentKey, settings } = this.candidate(value);
      const model: SavedModel = { id: oldModel?.id || randomUUID(), model: settings.model, ...capabilities(settings) };
      const models = existing ? existing.models.filter(item => item.id !== model.id) : [];
      // Editing retains list order; adding appends the model.
      if (oldModel) models.splice(existing!.models.indexOf(oldModel), 0, model); else models.push(model);
      if (models.length > 100 || (!existing && this.state.providers.length >= 50)) throw new HttpError(400, '最多保存 50 个供应商，每个供应商最多 100 个模型');
      const provider: Provider = { id: existing?.id || randomUUID(), name, protocol: settings.protocol, baseUrl: settings.baseUrl, apiKey: settings.apiKey, useEnvironmentKey, models, selectedModelId: model.id };
      const providers = existing ? this.state.providers.map(item => item.id === provider.id ? provider : item) : [...this.state.providers, provider];
      return { version: 2, providers, activeProviderId: provider.id, activeModelId: model.id };
    });
  }

  select(value: ModelSelection) {
    return this.mutate(() => {
      const provider = this.provider(requireString(value.providerId, '供应商 ID', 100));
      if (!provider) throw new HttpError(404, '供应商已移除，请重新选择');
      const modelId = value.modelId === undefined ? provider.selectedModelId : requireString(value.modelId, '模型配置 ID', 100);
      const model = provider.models.find(model => model.id === modelId);
      if (!model) throw new HttpError(404, '模型已移除，请重新选择');
      if (!this.providerKey(provider)) throw new HttpError(409, '此供应商尚未配置密钥，请在模型设置中填写');
      return { ...this.state, providers: this.state.providers.map(item => item.id === provider.id ? { ...item, selectedModelId: model.id } : item), activeProviderId: provider.id, activeModelId: model.id };
    });
  }

  remove(providerId: string, modelId?: string) {
    return this.mutate(() => {
      const provider = this.provider(providerId);
      if (!provider) throw new HttpError(404, '供应商已移除，请重新选择');
      if (modelId && !provider.models.some(model => model.id === modelId)) throw new HttpError(404, '模型已移除，请重新选择');
      const models = modelId ? provider.models.filter(model => model.id !== modelId) : [];
      const providers = this.state.providers.flatMap(item => item.id !== providerId ? [item] : models.length ? [{ ...item, models, selectedModelId: models.some(model => model.id === item.selectedModelId) ? item.selectedModelId : models[0].id }] : []);
      const active = providers.find(item => item.id === this.state.activeProviderId) || providers[0];
      const activeModelId = active?.models.find(model => model.id === this.state.activeModelId)?.id || active?.selectedModelId;
      return { version: 2, providers, activeProviderId: active?.id, activeModelId };
    });
  }
}
