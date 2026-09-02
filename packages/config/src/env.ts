import { z } from "zod";

/** Centralized, typed environment schema. No secrets, no business config (Sprint 0.1). */

export const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");
export const appEnvSchema = z
  .enum(["local", "development", "staging", "production"])
  .default("local");
export const logLevelSchema = z.enum(["debug", "info", "warn", "error"]).default("info");

export const envSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  APP_ENV: appEnvSchema,
  LOG_LEVEL: logLevelSchema,
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof envSchema>;

function readProcessEnv(): Record<string, unknown> {
  return typeof process !== "undefined" && process.env ? process.env : {};
}

/**
 * Validate a source of environment variables (defaults to process.env).
 * Throws a clear, aggregated error on invalid config — fail fast at boot.
 */
export function loadEnv(source: Record<string, unknown> = readProcessEnv()): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
