import { describe, expect, it } from "vitest";
import type { DatabaseConfig } from "@platform/config/server";
import { buildDatasourceUrl } from "./client";

function config(overrides: Partial<DatabaseConfig> = {}): DatabaseConfig {
  return {
    url: "postgresql://lumo:lumo@localhost:5432/lumo",
    poolMax: 10,
    connectTimeoutMs: 10_000,
    statementTimeoutMs: 30_000,
    logQueries: false,
    ...overrides,
  };
}

describe("buildDatasourceUrl (Phase A.13, Task 1/2)", () => {
  it("applies the configured pool size and connect timeout as Prisma's documented URL parameters", () => {
    const url = new URL(buildDatasourceUrl(config({ poolMax: 25, connectTimeoutMs: 7_000 })));
    expect(url.searchParams.get("connection_limit")).toBe("25");
    expect(url.searchParams.get("connect_timeout")).toBe("7");
  });

  it("applies the schema-default pool size/timeout unchanged when the environment sets none", () => {
    // env.ts defaults: DATABASE_POOL_MAX=10, DATABASE_CONNECT_TIMEOUT_MS=10_000.
    const url = new URL(buildDatasourceUrl(config()));
    expect(url.searchParams.get("connection_limit")).toBe("10");
    expect(url.searchParams.get("connect_timeout")).toBe("10");
  });

  it("does not override an explicit connection_limit/connect_timeout already present on the URL", () => {
    const url = new URL(
      buildDatasourceUrl(
        config({
          url: "postgresql://lumo:lumo@localhost:5432/lumo?connection_limit=99&connect_timeout=42",
          poolMax: 10,
          connectTimeoutMs: 10_000,
        }),
      ),
    );
    expect(url.searchParams.get("connection_limit")).toBe("99");
    expect(url.searchParams.get("connect_timeout")).toBe("42");
  });

  it("leaves the rest of the connection URL (credentials, host, port, database, other params) untouched", () => {
    const url = new URL(
      buildDatasourceUrl(
        config({ url: "postgresql://morbeh:secret@db-host:5432/morbeh?schema=payments" }),
      ),
    );
    expect(url.username).toBe("morbeh");
    expect(url.password).toBe("secret");
    expect(url.hostname).toBe("db-host");
    expect(url.port).toBe("5432");
    expect(url.pathname).toBe("/morbeh");
    expect(url.searchParams.get("schema")).toBe("payments");
  });

  it("does not add a statement_timeout parameter (Prisma ORM v6 has no such datasource-URL parameter)", () => {
    const url = new URL(buildDatasourceUrl(config({ statementTimeoutMs: 5_000 })));
    expect(url.searchParams.has("statement_timeout")).toBe(false);
  });
});
