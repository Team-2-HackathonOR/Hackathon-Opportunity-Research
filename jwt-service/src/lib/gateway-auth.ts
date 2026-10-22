const OPEN_PATHS = new Set(["/health", "/health/live", "/health/ready"]);

export const GATEWAY_CALLER = "team-2-gateway";
export const GATEWAY_CALLER_HEADER = "x-gateway-caller";
export const GATEWAY_SECRET_HEADER = "x-gateway-secret";

type HeaderValue = string | string[] | undefined;

export function authorizeGatewayCaller(
  url: string,
  headers: Record<string, HeaderValue>,
  secret: string | undefined,
  serviceName: string,
): { status: number; body: { error: string; env?: string } } | null {
  const path = normalizePath(url);
  if (OPEN_PATHS.has(path)) {
    return null;
  }

  if (!secret) {
    return {
      status: 503,
      body: {
        error: "Gateway secret is not configured.",
        env: "GATEWAY_INTERNAL_SECRET",
      },
    };
  }

  if (headerValue(headers[GATEWAY_CALLER_HEADER]) !== GATEWAY_CALLER) {
    return {
      status: 403,
      body: { error: `${serviceName} only accepts requests from the team-2 gateway.` },
    };
  }

  if (headerValue(headers[GATEWAY_SECRET_HEADER]) !== secret) {
    return {
      status: 403,
      body: { error: "Invalid team-2 gateway authorization." },
    };
  }

  return null;
}

function normalizePath(url: string): string {
  const path = url.split("?")[0] ?? url;
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}

function headerValue(value: HeaderValue): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}
