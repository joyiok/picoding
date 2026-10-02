import { Agent, EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { HttpError } from './http.js';

export function networkDispatcher(environment: NodeJS.ProcessEnv = process.env) {
  const override = environment.PICODING_MODEL_PROXY;
  if (override === 'none') return new Agent();
  const httpProxy = override ?? environment.http_proxy ?? environment.HTTP_PROXY ?? '';
  const httpsProxy = override ?? environment.https_proxy ?? environment.HTTPS_PROXY ?? '';
  for (const value of [httpProxy, httpsProxy]) {
    if (!value) continue;
    try { if (!['http:', 'https:'].includes(new URL(value).protocol)) throw new Error(); }
    catch { throw new HttpError(400, '模型代理地址无效，请检查 PICODING_MODEL_PROXY 或 HTTP(S)_PROXY'); }
  }
  // Worker bearer credentials must always travel directly over loopback.
  const noProxy = [environment.no_proxy ?? environment.NO_PROXY ?? '', 'localhost', '127.0.0.1', '::1', '[::1]'].filter(Boolean).join(',');
  return new EnvHttpProxyAgent({ httpProxy, httpsProxy, noProxy });
}
export function configureNetwork() { const dispatcher = networkDispatcher(); setGlobalDispatcher(dispatcher); return dispatcher; }
