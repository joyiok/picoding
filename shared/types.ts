export type TaskStatus = 'creating' | 'ready' | 'running' | 'pausing' | 'paused' | 'error' | 'stopped';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  streaming?: boolean;
  error?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  output?: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  browserUrl?: string;
  pendingPrompt?: string;
  source?: GitProjectSource;
  pendingImport?: GitProjectSource;
  messages: ChatMessage[];
  tools: ToolCall[];
  terminal: TerminalEntry[];
}

export interface TerminalEntry {
  id: string;
  command: string;
  output: string;
  exitCode: number | null;
  createdAt: string;
}

export interface FileEntry {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface FileContent { path: string; content: string; version: string; }
export interface FileWriteOptions { createOnly?: boolean; expectedVersion?: string; }
export interface GitProjectSource { type: 'git'; url: string; branch?: string; }
export interface ImportResult { head: string; branch: string; }
export const maxUploadBytes = 10 * 1024 * 1024;
export interface CommandResult { output: string; exitCode: number | null; truncated?: boolean; }
export interface BrowserState { url: string; title: string; tabs: { id: number; url: string; title: string }[]; }

export type BrowserAction =
  | { action: 'navigate'; url: string }
  | { action: 'click'; selector: string }
  | { action: 'fill'; selector: string; text: string }
  | { action: 'press'; key: string }
  | { action: 'scroll'; direction: 'up' | 'down' }
  | { action: 'back' | 'reload' | 'snapshot' }
  | { action: 'tab'; index: number };

export type APIProtocol = 'openai' | 'anthropic';

export interface ModelCapabilities {
  contextWindow: number;
  maxTokens: number;
  supportsImages: boolean;
}

export const defaultModelCapabilities: ModelCapabilities = { contextWindow: 128_000, maxTokens: 16_384, supportsImages: false };

export interface ModelSettings extends ModelCapabilities {
  protocol: APIProtocol;
  model: string;
  baseUrl: string;
  apiKey?: string;
}

export type ModelSettingsInput = Omit<ModelSettings, keyof ModelCapabilities> & Partial<ModelCapabilities>;

export interface PublicSettings extends ModelCapabilities {
  protocol: APIProtocol;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  configured: boolean;
}

export interface Health {
  docker: { available: boolean; imageReady: boolean; message: string };
  model: { configured: boolean; protocol: APIProtocol; model: string };
  version: string;
}

export type TaskEvent =
  | { type: 'task'; task: Task }
  | { type: 'message'; message: ChatMessage }
  | { type: 'tool'; tool: ToolCall }
  | { type: 'terminal'; entry: TerminalEntry }
  | { type: 'browser'; state: BrowserState }
  | { type: 'files_changed' };

export interface EventEnvelope { sequence: number; event: TaskEvent; }
