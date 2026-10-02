import { randomUUID } from 'node:crypto';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import type { ModelSettings } from '../shared/types.js';
import type { ModelConnection } from '../shared/connection.js';
import { HttpError } from './http.js';
import { modelError } from './model-error.js';

// Probe the candidate exactly as entered, without saving settings, loading
// sessions, registering tools or consulting the host credential store.
export async function probeModel(value: ModelSettings, signal?: AbortSignal, timeoutMs = 15_000): Promise<ModelConnection> {
  if (!value.apiKey) throw new HttpError(400, '请填写 API Key 后测试连接');
  const started = Date.now();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  const provider = 'picoding-probe-' + randomUUID();
  let runtime: ModelRuntime | undefined;
  try {
    runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false, signal: combined });
    runtime.registerProvider(provider, {
      baseUrl: value.baseUrl, api: value.protocol === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
      models: [{ id: value.model, name: value.model, reasoning: false, input: value.supportsImages ? ['text', 'image'] : ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: value.contextWindow, maxTokens: Math.min(64, value.maxTokens) }],
    });
    await runtime.setRuntimeApiKey(provider, value.apiKey, { signal: combined });
    const model = runtime.getModel(provider, value.model);
    if (!model) throw new Error('模型配置无法读取，请检查模型 ID');
    const reply = await runtime.completeSimple(model, { messages: [{ role: 'user', content: 'Reply with OK to check this API connection.', timestamp: Date.now() }] }, { signal: combined, maxTokens: Math.min(64, value.maxTokens) });
    if (combined.aborted) throw new Error('连接测试已取消');
    if (reply.stopReason === 'error' || reply.stopReason === 'aborted') throw new Error(reply.errorMessage || '模型请求失败，请检查 API 格式、地址、模型 ID 和密钥');
    if (!reply.content.some(block => block.type === 'text' && block.text.trim())) throw new Error('服务未返回有效的模型文字，请检查 API 格式和地址');
    return { protocol: value.protocol, model: value.model, latencyMs: Date.now() - started };
  } catch (error) {
    if (timeout.signal.aborted) throw new HttpError(408, '连接测试超时，请检查地址、代理和网络后重试');
    if (signal?.aborted) throw new HttpError(499, '连接测试已取消');
    throw new HttpError(502, modelError(error, value.apiKey));
  } finally { clearTimeout(timer); runtime?.unregisterProvider(provider); }
}
