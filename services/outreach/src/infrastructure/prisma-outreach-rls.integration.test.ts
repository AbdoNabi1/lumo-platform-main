import { randomUUID } from "node:crypto";
import type { Database, TransactionClient } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutboundRecord, WhatsAppConnectionRecord } from "../domain/repositories";
import { createPrismaOutreach, type PrismaOutreach } from "./prisma-outreach-wiring";

/**
 * ADR-0014 / Task 4 I1: the outreach unit of work must establish the RLS scope ITSELF. These tests run every
 * repository call as a role that is NOT superuser and NOT `BYPASSRLS`, so a missing `set_config` shows up as an empty
 * result or a failed insert policy instead of silently passing:
 *
 *   DATABASE_URL_TEST=postgresql://… pnpm --filter @platform/outreach test
 *
 * The connecting user must be allowed to `CREATE ROLE` (the test creates and drops a throw-away `NOBYPASSRLS` role and
 * switches to it with `SET LOCAL ROLE` as the first statement of every transaction). Skipped without `DATABASE_URL_TEST`.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];
const ROLE = `outreach_rls_probe_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const T0 = new Date("2026-11-19T10:00:00.000Z");
const uid = (p: string): string => `${p}-${randomUUID()}`;

/** A `Database` whose every transaction first drops to the probe role (RLS then applies, FORCE or not). */
function asProbeRole(admin: Database): Database {
  return new Proxy(admin, {
    get(target, name, receiver) {
      if (name === "$transaction") {
        return (fn: (tx: TransactionClient) => Promise<unknown>, options?: unknown) =>
          target.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL ROLE "${ROLE}"`);
            return fn(tx);
          }, options as never);
      }
      return Reflect.get(target, name, receiver) as unknown;
    },
  });
}

const pendingOutbound = (tenantId: string): OutboundRecord => ({
  id: randomUUID(),
  tenantId,
  channel: "whatsapp",
  kind: "template",
  contactId: null,
  recipient: "+201****0000",
  templateName: "order_update",
  templateLanguage: "en_US",
  templateRevision: 2,
  purpose: "utility",
  payload: { components: [] },
  idempotencyKey: uid("idem"),
  status: "pending",
  providerMessageId: null,
  errorCode: null,
  errorMessage: null,
  contextRef: "order:1",
  acceptedAt: null,
  correlationId: randomUUID(),
  dispatchStartedAt: T0,
  providerIdempotencyKey: null,
  dispatchPhoneNumberId: "phone-1",
  dispatchWabaId: "waba-1",
  version: 0,
});

const connectionFor = (tenantId: string): WhatsAppConnectionRecord => ({
  tenantId,
  status: "connected",
  wabaId: uid("waba"),
  phoneNumberId: uid("phone"),
  displayPhoneNumber: null,
  verifiedName: null,
  qualityRating: null,
  messagingLimitTier: null,
  sealedCredentials: "sealed",
  connectedAt: T0,
  disconnectedAt: null,
  lastStatusSyncAt: null,
  lastError: null,
  onboardingAttemptId: null,
  onboardingStage: null,
  onboardingFailure: null,
  onboardingLeaseOwner: null,
  onboardingLeaseUntil: null,
  version: 0,
});

class Boom extends Error {}

describe.runIf(Boolean(databaseUrl))(
  "outreach tenant-scoped unit of work (non-BYPASSRLS role)",
  () => {
    let admin: Database;
    let prisma: Database;
    let repos: PrismaOutreach;
    const platformTenantId = `platform-${randomUUID()}`;

    beforeAll(async () => {
      admin = createTestPrismaClient(databaseUrl);
      prisma = asProbeRole(admin);
      repos = createPrismaOutreach({ prisma, clock: { now: () => T0 }, platformTenantId });
      await admin.$executeRawUnsafe(`CREATE ROLE "${ROLE}" NOLOGIN NOSUPERUSER NOBYPASSRLS`);
      await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "outreach" TO "${ROLE}"`);
      await admin.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "outreach" TO "${ROLE}"`,
      );
    });

    afterAll(async () => {
      await admin.$executeRawUnsafe(`DROP OWNED BY "${ROLE}"`);
      await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS "${ROLE}"`);
      await admin.$disconnect();
    });

    it("control: the probe role is subject to RLS — an unscoped transaction sees no rows", async () => {
      expect.hasAssertions();
      const tenant = uid("t");
      await repos.connections.save(connectionFor(tenant), 0);
      expect(await repos.connections.get(tenant)).not.toBeNull();
      const unscoped = await prisma.$transaction((tx) =>
        tx.whatsAppConnection.findFirst({ where: { tenantId: tenant } }),
      );
      expect(unscoped).toBeNull();
    });

    it("lists and settles two tenants through the production unit of work, each only under its own scope", async () => {
      expect.hasAssertions();
      const [a, b] = [uid("t"), uid("t")];
      const [rowA, rowB] = [pendingOutbound(a), pendingOutbound(b)];
      await repos.outbound.insert(rowA);
      await repos.outbound.insert(rowB);
      const later = new Date(T0.getTime() + 3_600_000);

      for (const [tenant, row, other] of [
        [a, rowA, rowB],
        [b, rowB, rowA],
      ] as const) {
        const settled = await repos.unitOfWork.run(tenant, async (tx) => {
          const listed = await repos.outbound.listUnresolved(tenant, later, 50, tx);
          expect(listed.map((x) => x.id)).toContain(row.id);
          expect(listed.map((x) => x.id)).not.toContain(other.id);
          // another tenant's row is invisible under this scope
          expect(await repos.outbound.findById(other.tenantId, other.id, tx)).toBeNull();
          const hit = listed.find((x) => x.id === row.id)!;
          return repos.outbound.markUnknownIfPending(tenant, hit.id, hit.version, tx);
        });
        expect(settled).toBe("marked");
        expect((await repos.outbound.findById(tenant, row.id))?.status).toBe("unknown");
      }
    });

    it("a mixed directory + shop transaction commits together and rolls back together", async () => {
      expect.hasAssertions();
      const shop = uid("shop");
      const connection = connectionFor(shop);
      await expect(
        repos.unitOfWork.run(shop, async (tx) => {
          await repos.connections.save(connection, 0, tx);
          expect(
            await repos.directory.claim(connection.phoneNumberId, connection.wabaId, shop, tx),
          ).toBe("claimed");
          // back under the shop scope after the directory switch
          expect(await repos.connections.get(shop, tx)).not.toBeNull();
          throw new Boom("rollback");
        }),
      ).rejects.toBeInstanceOf(Boom);
      expect(await repos.connections.get(shop)).toBeNull();
      expect(await repos.directory.find(connection.phoneNumberId)).toBeNull();

      await repos.unitOfWork.run(shop, async (tx) => {
        await repos.connections.save(connection, 0, tx);
        await repos.directory.claim(connection.phoneNumberId, connection.wabaId, shop, tx);
      });
      expect(await repos.connections.get(shop)).not.toBeNull();
      expect(await repos.directory.find(connection.phoneNumberId)).toEqual({
        shopTenantId: shop,
        wabaId: connection.wabaId,
      });
    });

    it("the email cap seed passes the insert policy and is tenant-scoped through the unit of work", async () => {
      expect.hasAssertions();
      const tenant = uid("t");
      const limits = { perHour: 1, perDay: 1 };
      expect(
        await repos.unitOfWork.run(tenant, (tx) =>
          repos.emailCounters.reserve(tenant, T0, limits, tx),
        ),
      ).toBe("reserved");
      expect(
        await repos.unitOfWork.run(tenant, (tx) =>
          repos.emailCounters.reserve(tenant, T0, limits, tx),
        ),
      ).toBe("hour_cap");
    });

    it("an owner write prepared while the lease was live but executed after the DATABASE clock passed it fails without a version bump", async () => {
      expect.hasAssertions();
      const tenant = uid("t");
      const owner = randomUUID();
      const leaseMs = 400;
      await repos.unitOfWork.run(tenant, (tx) =>
        repos.connections.acquireOnboardingLease(
          {
            ...connectionFor(tenant),
            status: "onboarding",
            onboardingStage: "registering",
            onboardingAttemptId: randomUUID(),
            onboardingLeaseOwner: owner,
            onboardingLeaseUntil: null,
          },
          null,
          leaseMs,
          tx,
        ),
      );
      const row = (await repos.connections.get(tenant))!;
      const holder = {
        version: row.version,
        onboardingStage: row.onboardingStage,
        onboardingAttemptId: row.onboardingAttemptId,
        phoneNumberId: row.phoneNumberId,
        wabaId: row.wabaId,
        owner,
      };
      await expect(
        repos.unitOfWork.run(tenant, async (tx) => {
          const prepared = { ...row, onboardingStage: "registered" as const };
          // no caller-supplied time exists: only the database clock at execution can expire the lease
          await new Promise((resolve) => setTimeout(resolve, leaseMs + 300));
          await repos.connections.writeAsLeaseOwner(prepared, holder, leaseMs, tx);
        }),
      ).rejects.toThrow(/lease owner write lost|owner write lost/);
      expect(await repos.connections.get(tenant)).toMatchObject({
        version: row.version,
        onboardingStage: "registering",
      });
    });
  },
);
