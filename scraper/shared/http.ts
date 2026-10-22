import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

type JsonRequestOptions = {
  method?: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
};

// Shared HTTP transport gives every domain the same JSON parsing and timeout behavior.
export const requestJson = <T>(
  url: string,
  options: JsonRequestOptions,
): Promise<{
  ok: boolean;
  statusCode: number;
  body: T;
}> =>
  new Promise((resolve, reject) => {
    const targetUrl = new URL(url);
    const transport = targetUrl.protocol === 'http:' ? httpRequest : httpsRequest;
    const serializedBody = options.body === undefined ? undefined : JSON.stringify(options.body);
    const headers = {
      ...options.headers,
      ...(serializedBody
        ? {
            'Content-Length': Buffer.byteLength(serializedBody).toString(),
            'Content-Type': options.headers['Content-Type'] ?? 'application/json',
          }
        : {}),
    };
    const upstreamRequest = transport(
      targetUrl,
      {
        method: options.method ?? 'GET',
        headers,
      },
      (upstreamResponse) => {
        const chunks: string[] = [];

        upstreamResponse.setEncoding('utf8');
        upstreamResponse.on('data', (chunk: string) => {
          chunks.push(chunk);
        });
        upstreamResponse.on('end', () => {
          const statusCode = upstreamResponse.statusCode ?? 500;
          const responseBody = chunks.join('');

          try {
            resolve({
              ok: statusCode >= 200 && statusCode < 300,
              statusCode,
              body: JSON.parse(responseBody) as T,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown JSON parse error';

            reject(
              new Error(
                `Failed to parse JSON response from ${targetUrl.origin} (status ${statusCode}): ${message}`,
              ),
            );
          }
        });
      },
    );

    upstreamRequest.on('error', reject);

    if (typeof options.timeoutMs === 'number' && options.timeoutMs > 0) {
      upstreamRequest.setTimeout(options.timeoutMs, () => {
        upstreamRequest.destroy(
          new Error(`Request to ${targetUrl.origin} timed out after ${options.timeoutMs}ms.`),
        );
      });
    }

    if (serializedBody !== undefined) {
      upstreamRequest.write(serializedBody);
    }

    upstreamRequest.end();
  });
