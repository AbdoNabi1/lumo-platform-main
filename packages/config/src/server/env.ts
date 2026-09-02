import { z } from "zod";

/** Robust string→boolean for environment variables (avoids `Boolean("false") === true`). */
function zBool(defaultValue: boolean) {
  return z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value): boolean => {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") return ["true", "1", "yes", "on"].includes(value.toLowerCase());
      return defaultValue;
    });
}

/**
 * Server-side infrastructure environment schema. Secret-bearing values (URLs, keys) are
 * resolved through the secret loader before validation. No secrets are defined here.
 */
export const serverEnvSchema = z.object({
  // PostgreSQL
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30_000),
  DATABASE_LOG_QUERIES: zBool(false),

  // Redis
  REDIS_URL: z.string().min(1),
  REDIS_KEY_PREFIX: z.string().default("lumo:"),

  // ClickHouse
  CLICKHOUSE_URL: z.string().url(),
  CLICKHOUSE_USER: z.string().default("default"),
  CLICKHOUSE_PASSWORD: z.string().default(""),
  CLICKHOUSE_DATABASE: z.string().default("default"),

  // Object storage (S3-compatible / MinIO)
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: zBool(true),
  S3_BUCKET_MEDIA: z.string().default("media"),
  S3_BUCKET_EXPORTS: z.string().default("exports"),
  S3_BUCKET_BACKUPS: z.string().default("backups"),

  // Observability (OpenTelemetry)
  OTEL_SERVICE_NAME: z.string().default("lumo-service"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_TRACES_ENABLED: zBool(false),
  OTEL_METRICS_ENABLED: zBool(false),

  // Backups (configuration only; execution wired in a later sprint)
  BACKUP_ENABLED: zBool(false),
  BACKUP_SCHEDULE: z.string().default("0 3 * * *"),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  BACKUP_BUCKET: z.string().default("backups"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
