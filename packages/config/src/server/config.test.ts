import { describe, expect, it } from "vitest";
import { loadConfig, resolveEnvironment } from "./config";

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  APP_ENV: "development",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/lumo",
  REDIS_URL: "redis://localhost:6379",
  CLICKHOUSE_URL: "http://localhost:8123",
  S3_ENDPOINT: "http://localhost:9000",
  S3_ACCESS_KEY_ID: "minio",
  S3_SECRET_ACCESS_KEY: "minio-secret",
};

describe("resolveEnvironment", () => {
  it("maps NODE_ENV=test to the test environment", () => {
    expect(resolveEnvironment({ NODE_ENV: "test", APP_ENV: "production" })).toBe("test");
  });

  it("maps APP_ENV=local to development", () => {
    expect(resolveEnvironment({ APP_ENV: "local" })).toBe("development");
  });
});

describe("loadConfig", () => {
  it("applies the development profile default", () => {
    const config = loadConfig({ env: baseEnv });
    expect(config.environment).toBe("development");
    expect(config.database.poolMax).toBe(5);
    expect(config.database.logQueries).toBe(true);
  });

  it("lets explicit env override the profile default", () => {
    const config = loadConfig({ env: { ...baseEnv, DATABASE_POOL_MAX: "15" } });
    expect(config.database.poolMax).toBe(15);
  });

  it("throws on missing required secret", () => {
    const withoutDb: NodeJS.ProcessEnv = { ...baseEnv };
    delete withoutDb.DATABASE_URL;
    expect(() => loadConfig({ env: withoutDb })).toThrowError(/Invalid server configuration/);
  });

  // Phase A.13 (Task 1/2): DATABASE_POOL_MAX/DATABASE_CONNECT_TIMEOUT_MS/DATABASE_STATEMENT_TIMEOUT_MS
  // are validated here (env.ts) before ever reaching `createPrismaClient` — an invalid value must
  // fail fast at boot, not silently coerce into something Prisma accepts.
  it("rejects a non-positive DATABASE_POOL_MAX", () => {
    expect(() => loadConfig({ env: { ...baseEnv, DATABASE_POOL_MAX: "0" } })).toThrowError(
      /Invalid server configuration/,
    );
    expect(() => loadConfig({ env: { ...baseEnv, DATABASE_POOL_MAX: "-5" } })).toThrowError(
      /Invalid server configuration/,
    );
  });

  it("rejects a non-numeric DATABASE_CONNECT_TIMEOUT_MS", () => {
    expect(() =>
      loadConfig({ env: { ...baseEnv, DATABASE_CONNECT_TIMEOUT_MS: "not-a-number" } }),
    ).toThrowError(/Invalid server configuration/);
  });

  it("rejects a negative DATABASE_STATEMENT_TIMEOUT_MS", () => {
    expect(() =>
      loadConfig({ env: { ...baseEnv, DATABASE_STATEMENT_TIMEOUT_MS: "-1" } }),
    ).toThrowError(/Invalid server configuration/);
  });
});
