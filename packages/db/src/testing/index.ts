import { createPrismaClient, type Database } from "../client";

/**
 * Builds a real `PrismaClient` for `DATABASE_URL_TEST`-gated integration suites (Phase A.20,
 * Task 6). Every one of these suites needs the identical pool/timeout tuning used in production
 * (`createDatabase`'s defaults) — before this helper existed, each suite's `wire()` re-typed the
 * config object literal with `as Parameters<typeof createPrismaClient>[0]` to paper over
 * `process.env["DATABASE_URL_TEST"]` being `string | undefined`, which silently let incomplete
 * config objects (missing `poolMax`/`connectTimeoutMs`/`statementTimeoutMs`) through TypeScript
 * and produced `connection_limit=undefined&connect_timeout=NaN` on the real connection string
 * (see PHASE_A19_REAL_POSTGRESQL_VALIDATION_REPORT.md §8).
 *
 * Callers still gate the whole suite with `describe.runIf(Boolean(process.env["DATABASE_URL_TEST"]))`
 * — this only throws if `wire()` runs without that guard.
 */
export function createTestPrismaClient(
  databaseUrl: string | undefined,
  options: { readonly logQueries?: boolean } = {},
): Database {
  if (!databaseUrl) {
    throw new Error(
      "createTestPrismaClient: DATABASE_URL_TEST is not set. Gate the suite with " +
        'describe.runIf(Boolean(process.env["DATABASE_URL_TEST"])) before calling this.',
    );
  }
  return createPrismaClient({
    url: databaseUrl,
    logQueries: options.logQueries ?? false,
    poolMax: 10,
    connectTimeoutMs: 5000,
    statementTimeoutMs: 5000,
  });
}

export { createFakePrisma, type FakePrisma } from "./fake-prisma";
