import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

export const config = {
  host: process.env.PICODING_HOST || '127.0.0.1',
  port: Number(process.env.PICODING_PORT || 4310),
  dataDir: resolve(process.env.PICODING_DATA_DIR || '.picoding'),
  image: process.env.PICODING_SANDBOX_IMAGE || 'picoding-sandbox:local',
  maxTasks: Number(process.env.PICODING_MAX_TASKS || 3),
  memory: process.env.PICODING_SANDBOX_MEMORY || '2g',
  cpus: process.env.PICODING_SANDBOX_CPUS || '2',
};

export const allowedOrigins = new Set([
  `http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`,
  'http://127.0.0.1:5173', 'http://localhost:5173',
]);
