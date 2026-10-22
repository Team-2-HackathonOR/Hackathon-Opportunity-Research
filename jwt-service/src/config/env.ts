import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const serviceRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: join(serviceRoot, ".env") });

const optionalText = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : undefined;
  });

const envSchema = z
  .object({
    PORT: z.coerce.number().default(4004),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    SERVICE_NAME: z.string().default("jwt-service"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    LOG_FILE_PATH: optionalText,

    AUTH_DATABASE_URL: optionalText,
    DATABASE_URL: z.string().min(1),
    DATABASE_SSL: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),

    JWT_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().min(1).default("team-2-gateway"),
    JWT_TTL_SECONDS: z.coerce.number().int().positive().default(2 * 60 * 60),
    INVITE_URL_BASE: z.string().trim().min(1).default("http://localhost:3000/accept-invite"),
    INVITE_TTL_SECONDS: z.coerce.number().int().positive().default(7 * 24 * 60 * 60),
    GATEWAY_INTERNAL_SECRET: z.string().min(16),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

    SEED_VIEWER_EMAIL: optionalText,
    SEED_VIEWER_PASSWORD: optionalText,
    SEED_RESEARCHER_EMAIL: optionalText,
    SEED_RESEARCHER_PASSWORD: optionalText,
    SEED_ADMIN_EMAIL: optionalText,
    SEED_ADMIN_PASSWORD: optionalText,

    MAIL_SERVICE_URL: optionalText,
    LDAP_URL: optionalText,
    LDAP_BIND_DN: optionalText,
    LDAP_BIND_PASSWORD: optionalText,
    LDAP_BASE_DN: optionalText,
    LDAP_USER_FILTER: z.string().trim().min(1).default("(mail={{email}})"),
    LDAP_GROUP_ADMIN: optionalText,
    LDAP_GROUP_RESEARCHER: optionalText,
    LDAP_GROUP_VIEWER: optionalText,
  })
  .superRefine((value, ctx) => {
    if (value.MAIL_SERVICE_URL && !isUrl(value.MAIL_SERVICE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MAIL_SERVICE_URL"],
        message: "MAIL_SERVICE_URL must be a URL",
      });
    }
    if (value.LDAP_URL && !isUrl(value.LDAP_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["LDAP_URL"],
        message: "LDAP_URL must be a URL",
      });
    }
    if (!value.LDAP_URL) {
      return;
    }
    for (const key of ["LDAP_BIND_DN", "LDAP_BIND_PASSWORD", "LDAP_BASE_DN"] as const) {
      if (!value[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when LDAP_URL is set`,
        });
      }
    }
  });

function isUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "ldap:" || parsed.protocol === "ldaps:";
  } catch {
    return false;
  }
}

export type JwtEnv = z.infer<typeof envSchema>;

export function authDatabaseUrl(source: Pick<JwtEnv, "AUTH_DATABASE_URL" | "DATABASE_URL">): string {
  return source.AUTH_DATABASE_URL ?? source.DATABASE_URL;
}

export const env: JwtEnv = envSchema.parse(process.env);
