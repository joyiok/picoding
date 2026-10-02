import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultModelCapabilities, type ModelCapabilities, type ModelSettings, type ModelSettingsInput, type PublicSettings } from '../shared/types.js';
import { config } from './config.js';
import { HttpError, requireString } from './http.js';

function capabilities(value: ModelCapabilities): ModelCapabilities {
  if (!Number.isSafeInteger(value.contextWindow) || value.contextWindow <= 0) throw new HttpError(400, '上下文 Token 数必须是正整数');
  if (!Number.isSafeInteger(value.maxTokens) || value.maxTokens <= 0) throw new HttpError(400, '最大输出 Token 数必须是正整数');
  if (value.maxTokens > value.contextWindow) throw new HttpError(400, '最大输出 Token 数不能超过上下文 Token 数');
  if (typeof value.supportsImages !== 'boolean') throw new HttpError(400, '图片支持必须是勾选状态');
  return { contextWindow: value.contextWindow, maxTokens: value.maxTokens, supportsImages: value.supportsImages };
}

export class SettingsStore {
  private settings: ModelSettings = {
    ...defaultModelCapabilities,
    protocol: process.env.PICODING_API_PROTOCOL === 'anthropic' ? 'anthropic' : 'openai',
    model: process.env.PICODING_MODEL || '',
    baseUrl: process.env.PICODING_API_BASE_URL || '',
  };
  private readonly file: string;
  constructor(readonly directory = config.dataDir) { this.file = join(directory, 'settings.json'); }

  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      // Preserve existing credentials and model IDs when migrating service-based settings.
      this.settings = {
        ...capabilities({
          contextWindow: saved.contextWindow === undefined ? defaultModelCapabilities.contextWindow : saved.contextWindow,
          maxTokens: saved.maxTokens === undefined ? defaultModelCapabilities.maxTokens : saved.maxTokens,
          // Existing configurations previously always advertised image support.
          supportsImages: saved.supportsImages === undefined ? Boolean(saved.model) : saved.supportsImages,
        }),
        protocol: saved.protocol === 'anthropic' || saved.provider === 'anthropic' ? 'anthropic' : 'openai',
        model: typeof saved.model === 'string' ? saved.model : '',
        baseUrl: typeof saved.baseUrl === 'string' ? saved.baseUrl : '',
        apiKey: typeof saved.apiKey === 'string' ? saved.apiKey : undefined,
      };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  get() { return { ...this.settings }; }
  public(): PublicSettings {
    const { apiKey, ...safe } = this.settings;
    const hasApiKey = Boolean(this.key());
    return { ...safe, hasApiKey, configured: Boolean(hasApiKey && safe.baseUrl && safe.model) };
  }
  key() { return this.settings.apiKey || process.env[this.settings.protocol === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY']; }

  async update(value: ModelSettingsInput) {
    if (!['anthropic', 'openai'].includes(value.protocol)) throw new HttpError(400, '请选择 OpenAI 或 Anthropic API 格式');
    const model = requireString(value.model, '模型 ID', 200).trim();
    const limits = capabilities({
      contextWindow: value.contextWindow === undefined ? this.settings.contextWindow : value.contextWindow,
      maxTokens: value.maxTokens === undefined ? this.settings.maxTokens : value.maxTokens,
      supportsImages: value.supportsImages === undefined ? this.settings.supportsImages : value.supportsImages,
    });
    if (value.apiKey !== undefined && typeof value.apiKey !== 'string') throw new HttpError(400, 'API Key 必须是文本');
    let url: URL;
    try { url = new URL(requireString(value.baseUrl, 'API 地址', 2048).trim()); }
    catch { throw new HttpError(400, '请输入有效的 API 地址'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new HttpError(400, 'API 地址必须是 HTTP 或 HTTPS 基础地址');
    const baseUrl = url.href.replace(/\/+$/, '');
    const sameEndpoint = this.settings.protocol === value.protocol && this.settings.baseUrl.replace(/\/+$/, '') === baseUrl;
    const apiKey = value.apiKey?.trim();
    if (!apiKey && !sameEndpoint && this.key()) throw new HttpError(400, '更换 API 格式或地址时，请重新填写密钥');
    const next: ModelSettings = { protocol: value.protocol, model, baseUrl, ...limits, apiKey: apiKey || (sameEndpoint ? this.settings.apiKey : undefined) };
    const serialized = JSON.stringify(next);
    await writeFile(`${this.file}.tmp`, serialized, { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
    this.settings = next;
    return this.public();
  }
}
