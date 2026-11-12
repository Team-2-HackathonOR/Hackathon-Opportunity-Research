type JsonRequestOptions = {
  method?: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
};
export type JsonResult<T> =
  | { ok: true; statusCode: number; body: T }
  | { ok: false; statusCode: number };

// Bound both headers and body consumption, and never forward credentials through redirects.
export const requestJson = async <T>(url: string, options: JsonRequestOptions): Promise<JsonResult<T>> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(options.timeoutMs ?? 20000, 25000));
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        ...options.headers,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, statusCode: response.status };
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 5_000_000) {
          await reader.cancel();
          throw new Error('Upstream response exceeds the size limit.');
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, statusCode: response.status, body: JSON.parse(new TextDecoder().decode(bytes)) as T };
  } finally {
    clearTimeout(timer);
  }
};
