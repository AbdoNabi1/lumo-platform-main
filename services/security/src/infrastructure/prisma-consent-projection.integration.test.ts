import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { createTestPrismaClient } from "@platform/db/testing";
import { PrismaConsentProjectionStore } from "./prisma-consent-projection";

/**
 * Integration suite for the consent projection Prisma store (H-2, G-SEC-4). Requires a real PostgreSQL
 * with the `20260718100000_security_consent_projection` migration applied:
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/security test
 *
 * HONESTLY GATED: without `DATABASE_URL_TEST` the suite is skipped — never faked. CI provisions Postgres
 * and runs `prisma migrate deploy` before this runs.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("PrismaConsentProjectionStore (integration)", () => {
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };
  const tenantId = "tenant-consent-itest";

  function store() {
    const prisma = createTestPrismaClient(databaseUrl);
    return new PrismaConsentProjectionStore({ prisma, idGenerator: ids });
  }

  it("upserts, reads back, and enforces last-writer-wins by occurredAt", async () => {
    const s = store();
    const subject = `cust-${crypto.randomUUID()}`;
    await s.upsert(
      {
        subjectRef: subject,
        purpose: "marketing",
        granted: true,
        occurredAt: "2026-07-18T09:00:00.000Z",
      },
      tenantId,
    );
    expect((await s.get(subject, "marketing", tenantId))?.granted).toBe(true);

    // Newer revoke wins.
    await s.upsert(
      {
        subjectRef: subject,
        purpose: "marketing",
        granted: false,
        occurredAt: "2026-07-18T10:00:00.000Z",
      },
      tenantId,
    );
    expect((await s.get(subject, "marketing", tenantId))?.granted).toBe(false);

    // Older redelivery is ignored (no regression).
    await s.upsert(
      {
        subjectRef: subject,
        purpose: "marketing",
        granted: true,
        occurredAt: "2026-07-18T08:00:00.000Z",
      },
      tenantId,
    );
    expect((await s.get(subject, "marketing", tenantId))?.granted).toBe(false);

    expect(await s.get(subject, "never-set", tenantId)).toBeNull();
  });
});
