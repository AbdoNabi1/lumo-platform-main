import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config";
import { resolveApiExposure } from "./api-exposure";

/**
 * G-82. `APP_ENV=local` is the only value a deployment can boot with today (the MFA / payments /
 * object-storage / signup-email / dunning / integration-port guards in api.ts all refuse any other
 * value), and a hosted container is `APP_ENV=local` too. So "is this the local APP_ENV" cannot tell a
 * developer's laptop from a public Railway domain. Exposure of the OpenAPI spec, the docs UI, the
 * readiness detail and /metrics therefore has its own decision, and the default is closed inside the
 * container image (`NODE_ENV=production`, set by runtime.Dockerfile).
 */

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  AUTH_ISSUER_URL: "https://issuer.example/",
  AUTH_JWKS_URL: "https://issuer.example/.well-known/jwks.json",
} satisfies NodeJS.ProcessEnv;

const ORY_PLACEHOLDER = {
  KETO_READ_URL: "https://keto.example",
  KETO_WRITE_URL: "https://keto.example",
  KRATOS_PUBLIC_URL: "https://kratos.example",
  KRATOS_ADMIN_URL: "https://kratos.example",
};

function cfg(extra: NodeJS.ProcessEnv = {}) {
  return loadRuntimeConfig({ ...base, ...extra });
}

const TOKEN = "metrics-token-0123456789";

describe("resolveApiExposure", () => {
  it("a developer machine (APP_ENV=local, no NODE_ENV=production) exposes everything", () => {
    expect(resolveApiExposure(cfg({ APP_ENV: "local" }), undefined)).toEqual({
      exposeDocs: true,
      readinessDetail: "full",
      metricsAccess: "open",
    });
  });

  it("the container image (APP_ENV=local + NODE_ENV=production) is closed by default", () => {
    expect(resolveApiExposure(cfg({ APP_ENV: "local" }), "production")).toEqual({
      exposeDocs: false,
      readinessDetail: "status-only",
      metricsAccess: "closed",
    });
  });

  it("a closed deployment with METRICS_TOKEN serves /metrics only to that bearer token", () => {
    const out = resolveApiExposure(cfg({ APP_ENV: "local", METRICS_TOKEN: TOKEN }), "production");
    expect(out.metricsAccess).toEqual({ bearerToken: TOKEN });
    expect(out.exposeDocs).toBe(false);
  });

  it("any APP_ENV other than local is closed even outside a container", () => {
    const out = resolveApiExposure(cfg({ APP_ENV: "development", ...ORY_PLACEHOLDER }), undefined);
    expect(out.exposeDocs).toBe(false);
    expect(out.readinessDetail).toBe("status-only");
    expect(out.metricsAccess).toBe("closed");
  });

  it("EXPOSE_API_DIAGNOSTICS=true reopens a local container (e.g. docker-compose)", () => {
    const out = resolveApiExposure(
      cfg({ APP_ENV: "local", EXPOSE_API_DIAGNOSTICS: "true" }),
      "production",
    );
    expect(out).toEqual({ exposeDocs: true, readinessDetail: "full", metricsAccess: "open" });
  });

  it("EXPOSE_API_DIAGNOSTICS=false closes a developer machine", () => {
    const out = resolveApiExposure(
      cfg({ APP_ENV: "local", EXPOSE_API_DIAGNOSTICS: "false" }),
      undefined,
    );
    expect(out.exposeDocs).toBe(false);
    expect(out.metricsAccess).toBe("closed");
  });
});

describe("G-82 config", () => {
  it("refuses EXPOSE_API_DIAGNOSTICS=true outside APP_ENV=local", () => {
    expect(() =>
      cfg({ APP_ENV: "production", EXPOSE_API_DIAGNOSTICS: "true", ...ORY_PLACEHOLDER }),
    ).toThrow(/EXPOSE_API_DIAGNOSTICS/);
  });

  it("rejects a value that is not true/false", () => {
    expect(() => cfg({ EXPOSE_API_DIAGNOSTICS: "yes" })).toThrow(/EXPOSE_API_DIAGNOSTICS/);
  });

  it("rejects a METRICS_TOKEN shorter than 16 characters", () => {
    expect(() => cfg({ METRICS_TOKEN: "short" })).toThrow(/METRICS_TOKEN/);
  });

  it("leaves both unset by default", () => {
    const c = cfg();
    expect(c.EXPOSE_API_DIAGNOSTICS).toBeUndefined();
    expect(c.METRICS_TOKEN).toBeUndefined();
  });
});

describe("G-82 wiring", () => {
  // startApi needs a live database and Redis, so the wiring is pinned the way railway-config.test.ts
  // pins the Dockerfiles: the entrypoint must take its exposure from resolveApiExposure and must not
  // decide it from APP_ENV alone again.
  const api = readFileSync(new URL("./api.ts", import.meta.url), "utf8");

  it("api.ts spreads resolveApiExposure into createAdminHttpApi", () => {
    expect(api).toContain('...resolveApiExposure(config, process.env["NODE_ENV"])');
  });

  it("api.ts no longer derives exposure from APP_ENV alone", () => {
    expect(api).not.toContain("exposeDocs: config.APP_ENV");
    expect(api).not.toContain("readinessDetail: config.APP_ENV");
  });
});
