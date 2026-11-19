import { describe } from "vitest";
import { createTestPrismaClient } from "@platform/db/testing";
import { runOutreachRepositoryContract } from "../testing/outreach-repository-contract";
import { createPrismaOutreach } from "./prisma-outreach-wiring";

/**
 * The SAME contract the in-memory twins pass, against real PostgreSQL (the `outreach` schema, migration
 * `20261119000000_outreach_channels` applied by the owner):
 *
 *   DATABASE_URL_TEST=postgresql://… pnpm --filter @platform/outreach test
 *
 * Skipped without `DATABASE_URL_TEST`.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("outreach repositories (integration)", () => {
  runOutreachRepositoryContract("prisma", ({ clock }) => {
    const prisma = createTestPrismaClient(databaseUrl);
    const repos = createPrismaOutreach({
      prisma,
      clock,
      // random per harness: the directory's phone / WABA / shop keys are globally unique in a shared database
      platformTenantId: `platform-${crypto.randomUUID()}`,
    });
    return Promise.resolve({ repos, close: () => prisma.$disconnect() });
  });
});
