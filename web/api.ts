export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || `请求失败 (${response.status})`, response.status);
  return data as T;
}

export const taskPath = (id: string, action: string) => `/tasks/${id}/${action}`;
export function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
