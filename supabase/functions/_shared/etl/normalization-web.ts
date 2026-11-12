import { decode } from "npm:html-entities@2.6.0";
import { Candidate,textContent,uniqueUrls } from './normalization-helpers.ts';

export function interestingLinks(html: string, base: string): Candidate[] {
  const items: Candidate[] = [];
  for (const match of html.matchAll(/<a\b[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const lower = `${match[1]} ${textContent(match[2])}`.toLowerCase();
    const source_type = /rule|faq|eligib|terms/.test(lower) ? "rules_faq"
      : /register|submit|apply|submission/.test(lower) ? "registration_page"
      : /prize|track|schedule|detail|about/.test(lower) ? "official_site" : null;
    if (source_type) {
      try { items.push({ source_type, url: new URL(decode(match[1]), base).toString() }); }
      catch { /* Invalid links are not evidence candidates. */ }
    }
  }
  return uniqueUrls(items, 2);
}

export async function publicUrl(raw: string, signal = AbortSignal.timeout(5000)): Promise<URL> {
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.port && !["80", "443"].includes(url.port) || host === "localhost" || host.endsWith(".local")) {
    throw new Error("Non-public evidence URL.");
  }
  const privateIp = (ip: string) => {
    const v = ip.toLowerCase();
    if (v.includes(":")) return !/^[23][0-9a-f]{0,3}:/.test(v);
    const [a, b] = v.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a >= 224;
  };
  signal.throwIfAborted();
  const resolveAddresses = async () => (await Promise.allSettled([
    Deno.resolveDns(host, "A"), Deno.resolveDns(host, "AAAA"),
  ])).flatMap((v) => v.status === "fulfilled" ? v.value : []);
  let onAbort: (() => void) | undefined;
  const addresses = /^[\d.]+$/.test(host) || host.includes(":") ? [host] : await Promise.race([
    resolveAddresses(),
    new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    }),
  ]).finally(() => { if (onAbort) signal.removeEventListener("abort", onAbort); });
  if (!addresses.length || addresses.some(privateIp)) throw new Error("Non-public evidence destination.");
  return url;
}

export async function fetchEvidence(raw: string, signal: AbortSignal) {
  let url = await publicUrl(raw, signal);
  for (let redirects = 0; redirects < 5; redirects++) {
    const response = await fetch(url, { signal, redirect: "manual", headers: { "user-agent": "Team2ETL/1.0 (+website enrichment)" } });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      url = await publicUrl(new URL(response.headers.get("location") ?? "", url).toString(), signal);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Evidence HTTP ${response.status}`); }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > 1_000_000) { await reader.cancel(); throw new Error("Evidence exceeds size limit."); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { text: new TextDecoder().decode(bytes), url: response.url || url.toString(), json: response.headers.get("content-type")?.includes("json") };
  }
  throw new Error("Evidence redirect limit exceeded.");
}
