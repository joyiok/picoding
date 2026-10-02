export type TerminalInput =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ack'; count: number };
export type TerminalOutput =
  | { type: 'data' | 'snapshot'; data: string }
  | { type: 'exit'; code: number | null }
  | { type: 'mode'; writable: boolean }
  | { type: 'error'; message: string };

export function terminalInput(value: unknown): TerminalInput {
  if (!value || typeof value !== 'object') throw new Error('终端消息无效');
  const input = value as Record<string, unknown>;
  if (input.type === 'input' && typeof input.data === 'string' && input.data.length <= 16_384) return { type: 'input', data: input.data };
  if (input.type === 'resize' && Number.isInteger(input.cols) && Number.isInteger(input.rows) && Number(input.cols) >= 2 && Number(input.cols) <= 500 && Number(input.rows) >= 1 && Number(input.rows) <= 200) return { type: 'resize', cols: Number(input.cols), rows: Number(input.rows) };
  if (input.type === 'ack' && Number.isInteger(input.count) && Number(input.count) >= 0 && Number(input.count) <= 524_288) return { type: 'ack', count: Number(input.count) };
  throw new Error('终端输入或尺寸无效');
}
