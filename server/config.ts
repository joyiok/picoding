import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

function positiveInteger(value: string | undefined, fallback: number, name: string, max = Number.MAX_SAFE_INTEGER) {
  const number = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new Error(`${name} 必须是 1 到 ${max} 之间的整数`);
  return number;
}

const cpus = process.env.PICODING_SANDBOX_CPUS || '2';
if (!Number.isFinite(Number(cpus)) || Number(cpus) <= 0) throw new Error('PICODING_SANDBOX_CPUS 必须是正数');

export const config = {
  host: process.env.PICODING_HOST || '127.0.0.1',
  port: positiveInteger(process.env.PICODING_PORT, 4310, 'PICODING_PORT', 65_535),
  dataDir: resolve(process.env.PICODING_DATA_DIR || '.picoding'),
  image: process.env.PICODING_SANDBOX_IMAGE || 'picoding-sandbox:local',
  maxTasks: positiveInteger(process.env.PICODING_MAX_TASKS, 3, 'PICODING_MAX_TASKS'),
  memory: process.env.PICODING_SANDBOX_MEMORY || '2g',
  cpus,
  sandboxProxy: process.env.PICODING_SANDBOX_PROXY ?? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy ?? '',
};

export const allowedOrigins = new Set([
  `http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`,
  'http://127.0.0.1:5173', 'http://localhost:5173',
]);
