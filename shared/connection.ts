import type { APIProtocol } from './types.js';
export interface ModelConnection { protocol: APIProtocol; model: string; latencyMs: number; }
