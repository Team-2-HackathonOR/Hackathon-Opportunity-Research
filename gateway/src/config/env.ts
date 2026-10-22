import { config } from "dotenv";
import { z } from "zod";

if (process.env.NODE_ENV !== "test") {
  config();
}

const csvList = z
  .string()
  .optional()
  .transform((value) =>
    value
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
  );

const optionalSecret = (minLength: number) =>
  z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim() ?? "";
      return trimmed.length > 0 ? trimmed : undefined;
    })
    .refine((value) => value === undefined || value.length >= minLength, {
      message: `must be at least ${minLength} characters`,
    });

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  SERVICE_NAME: z.string().default("team-2-gateway"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LOG_FILE_PATH: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    }),

  HACKATHON_SERVICE_URL: z.string().url().default("http://127.0.0.1:4001"),
  JWT_SERVICE_URL: z.string().url().default("http://127.0.0.1:4004"),
  AI_SERVICE_URL: z.string().url().optional(),
  SCRAPER_SERVICE_URL: z.string().url().optional(),

  GATEWAY_INTERNAL_SECRET: optionalSecret(16),

  ADMIN_API_KEY: z.string().optional(),

  IP_ALLOWLIST: csvList,
  IP_BLOCKLIST: csvList,
  PATH_BLOCKLIST: csvList,

  PROXY_GRAPHQL_UPSTREAM_URL: z.string().url().optional(),

  RATE_LIMIT_MAX: z.coerce.number().default(300),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV !== "production") {
    return;
  }
  if (!value.GATEWAY_INTERNAL_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["GATEWAY_INTERNAL_SECRET"],
      message: "GATEWAY_INTERNAL_SECRET is required in production",
    });
  }
});

export type GatewayEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): GatewayEnv {
  return envSchema.parse(source);
}

export const env = loadEnv();
