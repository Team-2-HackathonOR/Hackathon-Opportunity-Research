import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { FastifyRequest } from "fastify";

import { env } from "../config/env.js";

const HEALTH_PATHS = new Set(["/health", "/health/live", "/health/ready"]);

const runtimeBlockedPaths = new Set<string>();
const runtimeBlockedIps = new Set<string>();

type AccessControlStore = {
  blockedIps: string[];
  blockedPaths: string[];
};

export function resetRuntimeBlocklists(): void {
  runtimeBlockedPaths.clear();
  runtimeBlockedIps.clear();
}

export function loadAccessControlStore(storePath = env.ACCESS_CONTROL_STORE_PATH): void {
  if (!storePath) {
    return;
  }
  try {
    const raw = readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AccessControlStore>;
    runtimeBlockedIps.clear();
    runtimeBlockedPaths.clear();
    for (const ip of parsed.blockedIps ?? []) {
      if (typeof ip === "string" && ip.trim()) {
        runtimeBlockedIps.add(ip.trim());
      }
    }
    for (const path of parsed.blockedPaths ?? []) {
      if (typeof path === "string" && path.trim()) {
        runtimeBlockedPaths.add(path.trim());
      }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
}

function persistAccessControlStore(storePath = env.ACCESS_CONTROL_STORE_PATH): void {
  if (!storePath) {
    return;
  }
  mkdirSync(dirname(storePath), { recursive: true });
  const payload: AccessControlStore = {
    blockedIps: [...runtimeBlockedIps].sort(),
    blockedPaths: [...runtimeBlockedPaths].sort(),
  };
  writeFileSync(storePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function getAccessControlSnapshot() {
  refreshFromStore();
  return {
    ip_allowlist: env.IP_ALLOWLIST,
    ip_blocklist: unique([...env.IP_BLOCKLIST, ...runtimeBlockedIps]),
    path_allowlist: env.PATH_ALLOWLIST,
    path_blocklist: unique([...env.PATH_BLOCKLIST, ...runtimeBlockedPaths]),
    access_control_store_path: env.ACCESS_CONTROL_STORE_PATH ?? null,
    note: env.ACCESS_CONTROL_STORE_PATH
      ? "Runtime blocklists are shared through ACCESS_CONTROL_STORE_PATH."
      : "Runtime blocklists reset when the process restarts unless ACCESS_CONTROL_STORE_PATH is set.",
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeRulePath(value: string): string {
  return value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;
}

function pathMatchesRule(path: string, rule: string): boolean {
  const normalized = normalizeRulePath(rule);
  if (normalized === "/") {
    return true;
  }
  return path === normalized || path.startsWith(`${normalized}/`);
}

function refreshFromStore(): void {
  if (env.ACCESS_CONTROL_STORE_PATH) {
    loadAccessControlStore(env.ACCESS_CONTROL_STORE_PATH);
  }
}

export function blockPath(path: string): void {
  refreshFromStore();
  runtimeBlockedPaths.add(path);
  persistAccessControlStore();
}

export function blockIp(ip: string): void {
  refreshFromStore();
  runtimeBlockedIps.add(ip);
  persistAccessControlStore();
}

function requestIp(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() ?? request.ip;
  }
  return request.ip;
}

export function evaluateAccess(request: FastifyRequest): { allowed: boolean; reason?: string } {
  refreshFromStore();
  const ip = requestIp(request);
  const path = request.url.split("?")[0] ?? request.url;

  const blocklist = [...env.IP_BLOCKLIST, ...runtimeBlockedIps];
  if (blocklist.includes(ip)) {
    return { allowed: false, reason: `IP ${ip} is blocked.` };
  }

  if (env.IP_ALLOWLIST.length > 0 && !env.IP_ALLOWLIST.includes(ip)) {
    return { allowed: false, reason: `IP ${ip} is not in allowlist.` };
  }

  const blockedPaths = [...env.PATH_BLOCKLIST, ...runtimeBlockedPaths];
  if (blockedPaths.some((blocked) => pathMatchesRule(path, blocked))) {
    return { allowed: false, reason: `Path ${path} is blocked.` };
  }

  if (
    env.PATH_ALLOWLIST.length > 0 &&
    !HEALTH_PATHS.has(path) &&
    !env.PATH_ALLOWLIST.some((allowed) => pathMatchesRule(path, allowed))
  ) {
    return { allowed: false, reason: `Path ${path} is not in allowlist.` };
  }

  return { allowed: true };
}
