import { AppError } from "@platform/utils";
import { createSecretProvider, type SecretProvider } from "@platform/secrets";
import { serverEnvSchema } from "./env";

export const ENVIRONMENTS = ["development", "staging", "production", "test"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export interface DatabaseConfig {
  readonly url: string;
  readonly poolMax: number;
  readonly connectTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly logQueries: boolean;
}

export interface RedisConfig {
  readonly url: string;
  readonly keyPrefix: string;
}

export interface ClickHouseConfig {
  readonly url: string;
  readonly username: string;
  readonly password: string;
  readonly database: string;
}

export interface StorageBuckets {
  readonly media: string;
  readonly exports: string;
  readonly backups: string;
}

export interface StorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
  readonly buckets: StorageBuckets;
}

export interface ObservabilityConfig {
  readonly serviceName: string;
  readonly otlpEndpoint?: string;
  readonly tracesEnabled: boolean;
  readonly metricsEnabled: boolean;
  readonly environment: Environment;
}

export interface BackupConfig {
  readonly enabled: boolean;
  readonly schedule: string;
  readonly retentionDays: number;
  readonly bucket: string;
}

export interface AppConfig {
  readonly environment: Environment;
  readonly database: DatabaseConfig;
  readonly redis: RedisConfig;
  readonly clickhouse: ClickHouseConfig;
  readonly storage: StorageConfig;
  readonly observability: ObservabilityConfig;
  readonly backup: BackupConfig;
}

/** Non-secret tunable defaults per environment (inheritance layer between schema and explicit env). */
const ENVIRONMENT_PROFILES: Record<Environment, Readonly<Record<string, string>>> = {
  development: {
    DATABASE_POOL_MAX: "5",
    DATABASE_LOG_QUERIES: "true",
    OTEL_TRACES_ENABLED: "false",
    OTEL_METRICS_ENABLED: "false",
  },
  test: {
    DATABASE_POOL_MAX: "2",
    DATABASE_LOG_QUERIES: "false",
    OTEL_TRACES_ENABLED: "false",
    OTEL_METRICS_ENABLED: "false",
  },
  staging: {
    DATABASE_POOL_MAX: "10",
    DATABASE_LOG_QUERIES: "false",
    OTEL_TRACES_ENABLED: "true",
    OTEL_METRICS_ENABLED: "true",
  },
  production: {
    DATABASE_POOL_MAX: "20",
    DATABASE_LOG_QUERIES: "false",
    OTEL_TRACES_ENABLED: "true",
    OTEL_METRICS_ENABLED: "true",
    BACKUP_ENABLED: "true",
  },
};

export function resolveEnvironment(env: NodeJS.ProcessEnv): Environment {
  if (env.NODE_ENV === "test") return "test";
  switch (env.APP_ENV) {
    case "production":
      return "production";
    case "staging":
      return "staging";
    default:
      return "development";
  }
}

export interface LoadConfigOptions {
  readonly provider?: SecretProvider;
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Loads and validates the server infrastructure configuration.
 * Layering (lowest → highest precedence): schema defaults < environment profile < explicit env/secret.
 * Throws `AppError("CONFIG_INVALID")` on invalid configuration (fail fast at boot).
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const env = options.env ?? process.env;
  const provider = options.provider ?? createSecretProvider(env);
  const environment = resolveEnvironment(env);

  const profile = ENVIRONMENT_PROFILES[environment];
  const explicit: Record<string, string> = {};
  for (const key of Object.keys(serverEnvSchema.shape)) {
    const value = provider.get(key);
    if (value !== undefined) explicit[key] = value;
  }
  const source: Record<string, string> = { ...profile, ...explicit };

  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new AppError(`Invalid server configuration:\n${issues}`, { code: "CONFIG_INVALID" });
  }

  const e = parsed.data;
  return {
    environment,
    database: {
      url: e.DATABASE_URL,
      poolMax: e.DATABASE_POOL_MAX,
      connectTimeoutMs: e.DATABASE_CONNECT_TIMEOUT_MS,
      statementTimeoutMs: e.DATABASE_STATEMENT_TIMEOUT_MS,
      logQueries: e.DATABASE_LOG_QUERIES,
    },
    redis: { url: e.REDIS_URL, keyPrefix: e.REDIS_KEY_PREFIX },
    clickhouse: {
      url: e.CLICKHOUSE_URL,
      username: e.CLICKHOUSE_USER,
      password: e.CLICKHOUSE_PASSWORD,
      database: e.CLICKHOUSE_DATABASE,
    },
    storage: {
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      buckets: { media: e.S3_BUCKET_MEDIA, exports: e.S3_BUCKET_EXPORTS, backups: e.S3_BUCKET_BACKUPS },
    },
    observability: {
      serviceName: e.OTEL_SERVICE_NAME,
      otlpEndpoint: e.OTEL_EXPORTER_OTLP_ENDPOINT,
      tracesEnabled: e.OTEL_TRACES_ENABLED,
      metricsEnabled: e.OTEL_METRICS_ENABLED,
      environment,
    },
    backup: {
      enabled: e.BACKUP_ENABLED,
      schedule: e.BACKUP_SCHEDULE,
      retentionDays: e.BACKUP_RETENTION_DAYS,
      bucket: e.BACKUP_BUCKET,
    },
  };
}
