export function serviceTarget(upstream: string, route = "") {
  const url = new URL(upstream);
  return {
    upstream: url.origin,
    rewritePrefix: `${url.pathname.replace(/\/$/, "")}${route}`,
  };
}
