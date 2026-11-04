const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

let accessToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export const authToken = {
  set(token: string) { accessToken = token; },
  clear() { accessToken = null; },
  get() { return accessToken; },
};

export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
  return () => { if (unauthorizedHandler === handler) unauthorizedHandler = null; };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown };

function friendlyStatus(status: number) {
  if (status === 400) return '请求参数无效，请检查后重试';
  if (status === 401) return '登录状态已失效，请重新登录';
  if (status === 403) return '当前账号没有执行此操作的权限';
  if (status === 404) return '请求的资源不存在或已被删除';
  if (status === 409) return '资源状态冲突，请刷新后重试';
  if (status === 413) return '文件或分片超过服务端限制';
  if (status === 429) return '请求过于频繁，请稍后重试';
  if (status >= 500) return '服务端暂时不可用，请稍后重试';
  return `请求失败（HTTP ${status}）`;
}

async function parseError(response: Response) {
  let message = friendlyStatus(response.status);
  let code: string | undefined;
  try {
    const data = await response.json() as {
      detail?: unknown;
      message?: string;
      code?: string;
      error?: string | { code?: string; message?: string; details?: unknown };
    };
    const apiError = typeof data.error === 'object' ? data.error : undefined;
    code = data.code || apiError?.code;
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item) => typeof item === 'object' && item && 'msg' in item ? String(item.msg) : String(item)).join('；')
      : data.detail;
    const validationDetails = formatValidationDetails(apiError?.details);
    if (typeof detail === 'string' && detail) message = detail;
    else if (validationDetails) message = validationDetails;
    else if (apiError?.message) message = apiError.message;
    else if (data.message) message = data.message;
    else if (typeof data.error === 'string') message = data.error;
  } catch {
    // 非 JSON 错误响应保留状态码对应的友好提示。
  }
  return new ApiError(message, response.status, code);
}

function formatValidationDetails(details: unknown): string {
  if (!Array.isArray(details)) return '';
  return details.map((item) => {
    if (typeof item !== 'object' || !item) return String(item);
    const location = 'loc' in item && Array.isArray(item.loc)
      ? (item.loc as unknown[]).filter((part: unknown) => part !== 'body').map(String).join('.')
      : '';
    const rawMessage = 'msg' in item ? String(item.msg) : '参数校验失败';
    const message = rawMessage
      .replace('Input should be a valid string', '必须是字符串')
      .replace('Input should be a valid integer', '必须是整数')
      .replace('Input should be a valid number', '必须是数字')
      .replace('Input should be greater than 0', '必须大于 0')
      .replace('Field required', '为必填字段');
    return `${location ? `${location}：` : ''}${message}`;
  }).filter(Boolean).join('；');
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.body instanceof Blob || options.body instanceof ArrayBuffer || options.body instanceof FormData || typeof options.body === 'string') {
      body = options.body;
    } else {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers, body });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('无法连接服务器，请检查网络或 API 服务状态', 0);
  }
  if (!response.ok) {
    if (response.status === 401) unauthorizedHandler?.();
    throw await parseError(response);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const headers = new Headers();
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { headers, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('下载连接失败，请检查网络后重试', 0);
  }
  if (!response.ok) {
    if (response.status === 401) unauthorizedHandler?.();
    throw await parseError(response);
  }
  return response.blob();
}

export function queryString(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) search.set(key, String(value));
  });
  const result = search.toString();
  return result ? `?${result}` : '';
}
