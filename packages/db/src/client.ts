import { PrismaClient } from "@prisma/client";
import type { DatabaseConfig } from "@platform/config/server";

/** The typed database client. Business models are added to the Prisma schema in later sprints. */
export type Database = PrismaClient;

/**
 * Applies `config.poolMax`/`config.connectTimeoutMs` to the datasource URL via Prisma's own
 * documented query-string parameters (`connection_limit`, `connect_timeout` — Prisma ORM v6,
 * https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/connection-pool).
 * Phase A.13 (Task 1/2): before this, `DATABASE_POOL_MAX`/`DATABASE_CONNECT_TIMEOUT_MS` were
 * validated at boot (`@platform/config/server/env.ts`) and carried into `DatabaseConfig`, but
 * `createPrismaClient` passed only `config.url` straight through — the validated values never
 * reached Prisma, which fell back to its own defaults (`connection_limit` = `num_cpus*2+1`,
 * `connect_timeout` = 5s) regardless of what the environment configured, silently.
 *
 * An explicit `connection_limit`/`connect_timeout` already present on `config.url` wins (an
 * operator who hand-crafted the URL is making a deliberate per-deployment override).
 *
 * `config.statementTimeoutMs` is deliberately NOT applied here: Prisma ORM v6 has no documented
 * datasource-URL parameter for PostgreSQL's `statement_timeout` (only `connection_limit`,
 * `pool_timeout`, `connect_timeout`, `max_idle_connection_lifetime`, `max_connection_lifetime`
 * are supported). `DATABASE_STATEMENT_TIMEOUT_MS` remains validated and exposed on
 * `DatabaseConfig` for callers that need it, but enforcing it requires either a PostgreSQL-role-
 * level `ALTER ROLE ... SET statement_timeout` or a PgBouncer/infrastructure-level setting —
 * inventing an unsupported Prisma parameter here would silently do nothing. See the A.13 report,
 * "Transaction Timeout Configuration" / limitation.
 */
export function buildDatasourceUrl(config: DatabaseConfig): string {
  const url = new URL(config.url);
  if (!url.searchParams.has("connection_limit")) {
    url.searchParams.set("connection_limit", String(config.poolMax));
  }
  if (!url.searchParams.has("connect_timeout")) {
    url.searchParams.set(
      "connect_timeout",
      String(Math.max(1, Math.round(config.connectTimeoutMs / 1000))),
    );
  }
  return url.toString();
}

/**
 * Creates a configured PrismaClient. The connection URL is injected (DI) rather than read
 * from the ambient environment, so callers control pooling/credentials per environment.
 * Connection pooling is handled by Prisma's pool, sized via `buildDatasourceUrl`'s
 * `connection_limit`/`connect_timeout` query parameters (Phase A.13); production also fronts
 * PostgreSQL with PgBouncer (transaction mode) per docs/architecture/15.
 */
export function createPrismaClient(config: DatabaseConfig): PrismaClient {
  return new PrismaClient({
    datasourceUrl: buildDatasourceUrl(config),
    log: config.logQueries ? ["query", "warn", "error"] : ["warn", "error"],
  });
}
