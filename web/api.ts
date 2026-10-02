export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

export async function api<T>(path: string, body?: unknown, method?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || `请求失败 (${response.status})`, response.status);
  return data as T;
}

export const taskPath = (id: string, action: string) => `/tasks/${id}/${action}`;
export function message(error: unknown) { return error instanceof Error ? error.message : String(error); }

export async function uploadFile(id: string, path: string, file: File, signal?: AbortSignal): Promise<void> {
  const response = await fetch('/api/tasks/' + id + '/upload?path=' + encodeURIComponent(path), {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file, signal,
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || '文件上传失败', response.status);
}
