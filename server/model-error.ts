export function modelError(value: unknown, key?: string) {
  let message = value instanceof Error ? value.message : String(value || '模型请求失败');
  const jsonStart = message.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const body = JSON.parse(message.slice(jsonStart));
      const detail = body.error?.message ?? body.message;
      if (typeof detail === 'string' && detail.trim()) message = detail;
    } catch { /* Keep actionable plain-text errors from non-JSON gateways. */ }
  }
  if (key) for (const secret of [key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1)]) message = message.split(secret).join('[密钥已隐藏]');
  return message.slice(0, 2400);
}
