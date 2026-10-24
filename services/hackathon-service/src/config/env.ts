import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const serviceRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: join(serviceRoot, ".env") });

const envSchema = z.object({
  PORT: z.coerce.number().default(4001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  SERVICE_NAME: z.string().default("hackathon-service"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LOG_FILE_PATH: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    }),

  /** Standard PostgreSQL connection string (works with Supabase, RDS, local Postgres, etc.) */
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  DB_POOL_MAX: z.coerce.number().default(10),
  GATEWAY_INTERNAL_SECRET: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim() ?? "";
      return trimmed.length > 0 ? trimmed : undefined;
    }),
});

export const env = envSchema.parse(process.env);
