import type { Clock } from "@platform/contracts";
import { runInTenantTransaction, type Database, type TransactionClient } from "@platform/db";
import { ConcurrencyError } from "@platform/utils";
import {
  UNEXPECTED_UNIQUE_CONFLICT,
  type ClaimResult,
  type ConsentEventRecord,
  type ContactRecord,
  type ContactRepository,
  type EmailSendCounterRepository,
  type InboundMessageRepository,
  type InboundRecord,
  type LeaseHolder,
  type OnboardingExpectation,
  type OutboundMessageRepository,
  type OutboundRecord,
  type PhoneDirectory,
  type StatusEventRecord,
  type UnmatchedStatusRecord,
  type UnmatchedStatusRepository,
  type UnresolvedOutbound,
  type WhatsAppConnectionRecord,
  type WhatsAppConnectionRepository,
} from "../domain/repositories";
import {
  connectionColumns,
  connectionFromRow,
  consentColumns,
  consentEventFromRow,
  consentEventInsertRow,
  contactFromRow,
  contactIdentityColumns,
  inboundFromRow,
  inboundInsertRow,
  outboundFromRow,
  outboundInsertRow,
  outboundMutableColumns,
  statusEventInsertRow,
  unmatchedFromRow,
  unmatchedInsertRow,
} from "./prisma-outreach-mappers";
import { tenantScopeOf, withPlatformScope } from "./prisma-outreach-unit-of-work";

/**
 * Reuses the caller's transaction when given; otherwise opens a tenant-scoped one (`app.tenant_id` set first, ADR-0014)
 * so a multi-statement operation is still atomic when called without a unit of work.
 */
export function withClient<T>(
  prisma: Database,
  tenantId: string,
  tx: unknown,
  run: (client: TransactionClient) => Promise<T>,
): Promise<T> {
  return tx !== undefined && tx !== null
    ? run(tx as TransactionClient)
    : runInTenantTransaction(prisma, tenantId, run);
}

const unexpectedConflict = (): Error => new Error(UNEXPECTED_UNIQUE_CONFLICT);

/** Private non-claim signal: thrown inside the owned transaction (rollback), translated back outside it. */
class NotClaimed extends Error {
  constructor(readonly result: "phone_in_use" | "waba_in_use") {
    super(result);
  }
}

export interface PrismaOutreachDeps {
  readonly prisma: Database;
}

export class PrismaWhatsAppConnectionRepository implements WhatsAppConnectionRepository {
  constructor(private readonly deps: PrismaOutreachDeps) {}

  async get(tenantId: string, tx?: unknown): Promise<WhatsAppConnectionRecord | null> {
    const row = await withClient(this.deps.prisma, tenantId, tx, (c) =>
      c.whatsAppConnection.findFirst({ where: { tenantId } }),
    );
    return row === null ? null : connectionFromRow(row);
  }

  async save(r: WhatsAppConnectionRecord, expectedVersion: number, tx?: unknown): Promise<void> {
    await withClient(this.deps.prisma, r.tenantId, tx, async (c) => {
      if (expectedVersion === 0) {
        const created = await c.whatsAppConnection.createMany({
          data: [{ tenantId: r.tenantId, ...connectionColumns(r), version: 1 }],
          skipDuplicates: true,
        });
        if (created.count === 0) {
          throw new ConcurrencyError(`Connection ${r.tenantId} already exists (expected no row)`);
        }
        return;
      }
      const updated = await c.whatsAppConnection.updateMany({
        where: { tenantId: r.tenantId, version: expectedVersion },
        data: { ...connectionColumns(r), version: expectedVersion + 1 },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Connection ${r.tenantId} was modified concurrently (expected version ${expectedVersion})`,
        );
      }
    });
  }

  /**
   * The lease operations are judged by the DATABASE wall clock at the statement that writes: the scoped row is locked
   * (`SELECT … FOR UPDATE`) in the same transaction, THEN one raw conditional statement samples
   * `clock_timestamp() AT TIME ZONE 'UTC'` (the `timestamp(3)` columns hold UTC) exactly once, compares the lease against
   * it and derives the new deadline from it. No caller-supplied time can make an expired lease look live. Every value is
   * bound; the tenant is in every WHERE; a count other than one loses.
   */
  async acquireOnboardingLease(
    next: WhatsAppConnectionRecord,
    expected: OnboardingExpectation | null,
    leaseMs: number,
    tx?: unknown,
  ): Promise<void> {
    if (next.onboardingLeaseOwner === null || !isValidLeaseMs(leaseMs)) {
      throw new Error(LEASE_REQUIRED);
    }
    const tenantId = next.tenantId;
    const v = connectionValues(next);
    await withClient(this.deps.prisma, tenantId, tx, async (c) => {
      const exists = await lockConnection(c, tenantId);
      if (expected === null) {
        if (exists)
          throw new ConcurrencyError(`Connection ${tenantId} already exists (expected no row)`);
        // a concurrent creator that commits first makes the insert a no-op: it loses, exactly like an existing row
        const created = await c.$executeRaw`
          INSERT INTO "outreach"."whatsapp_connections" (
            "tenant_id", "status", "waba_id", "phone_number_id", "display_phone_number", "verified_name",
            "quality_rating", "messaging_limit_tier", "sealed_credentials", "connected_at", "disconnected_at",
            "last_status_sync_at", "last_error", "onboarding_attempt_id", "onboarding_stage", "onboarding_failure",
            "onboarding_lease_owner", "onboarding_lease_until", "version", "updated_at")
          SELECT ${tenantId}, ${v.status}, ${v.wabaId}, ${v.phoneNumberId}, ${v.displayPhoneNumber}, ${v.verifiedName},
            ${v.qualityRating}, ${v.messagingLimitTier}, ${v.sealedCredentials}, ${v.connectedAt}::timestamp,
            ${v.disconnectedAt}::timestamp, ${v.lastStatusSyncAt}::timestamp, ${v.lastError}, ${v.attemptId}::uuid,
            ${v.stage}, ${v.failure}, ${v.owner}::uuid,
            db."now" + (${leaseMs}::double precision * interval '1 millisecond'), 1, db."now"
          FROM (SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now") AS db
          ON CONFLICT ("tenant_id") DO NOTHING`;
        if (created !== 1) {
          throw new ConcurrencyError(`Connection ${tenantId} already exists (expected no row)`);
        }
        return;
      }
      const updated = await c.$executeRaw`
        UPDATE "outreach"."whatsapp_connections" AS w SET
          "status" = ${v.status}, "waba_id" = ${v.wabaId}, "phone_number_id" = ${v.phoneNumberId},
          "display_phone_number" = ${v.displayPhoneNumber}, "verified_name" = ${v.verifiedName},
          "quality_rating" = ${v.qualityRating}, "messaging_limit_tier" = ${v.messagingLimitTier},
          "sealed_credentials" = ${v.sealedCredentials}, "connected_at" = ${v.connectedAt}::timestamp,
          "disconnected_at" = ${v.disconnectedAt}::timestamp, "last_status_sync_at" = ${v.lastStatusSyncAt}::timestamp,
          "last_error" = ${v.lastError}, "onboarding_attempt_id" = ${v.attemptId}::uuid,
          "onboarding_stage" = ${v.stage}, "onboarding_failure" = ${v.failure},
          "onboarding_lease_owner" = ${v.owner}::uuid,
          "onboarding_lease_until" = db."now" + (${leaseMs}::double precision * interval '1 millisecond'),
          "version" = ${expected.version + 1}, "updated_at" = db."now"
        FROM (SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now") AS db
        WHERE w."tenant_id" = ${tenantId} AND w."version" = ${expected.version}
          AND w."onboarding_stage" IS NOT DISTINCT FROM ${expected.onboardingStage}
          AND w."onboarding_attempt_id" IS NOT DISTINCT FROM ${expected.onboardingAttemptId}::uuid
          AND w."phone_number_id" = ${expected.phoneNumberId} AND w."waba_id" = ${expected.wabaId}
          AND (w."onboarding_lease_until" IS NULL OR w."onboarding_lease_until" < db."now")`;
      if (updated !== 1) throw leaseLost(tenantId, "acquire");
    });
  }

  async renewOnboardingLease(
    tenantId: string,
    holder: LeaseHolder,
    leaseMs: number,
    tx?: unknown,
  ): Promise<void> {
    if (!isValidLeaseMs(leaseMs)) throw new Error(INVALID_LEASE_MS);
    await withClient(this.deps.prisma, tenantId, tx, async (c) => {
      await lockConnection(c, tenantId);
      const updated = await c.$executeRaw`
        UPDATE "outreach"."whatsapp_connections" AS w SET
          "onboarding_lease_until" = db."now" + (${leaseMs}::double precision * interval '1 millisecond'),
          "version" = ${holder.version + 1}, "updated_at" = db."now"
        FROM (SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now") AS db
        WHERE w."tenant_id" = ${tenantId} AND w."version" = ${holder.version}
          AND w."onboarding_stage" IS NOT DISTINCT FROM ${holder.onboardingStage}
          AND w."onboarding_attempt_id" IS NOT DISTINCT FROM ${holder.onboardingAttemptId}::uuid
          AND w."phone_number_id" = ${holder.phoneNumberId} AND w."waba_id" = ${holder.wabaId}
          AND w."onboarding_lease_owner" = ${holder.owner}::uuid AND w."onboarding_lease_until" > db."now"`;
      if (updated !== 1) throw leaseLost(tenantId, "renew");
    });
  }

  async writeAsLeaseOwner(
    next: WhatsAppConnectionRecord,
    holder: LeaseHolder,
    leaseMs: number,
    tx?: unknown,
  ): Promise<void> {
    // a write that keeps the lease needs a length; a release (null owner) clears both lease columns
    if (next.onboardingLeaseOwner !== null && !isValidLeaseMs(leaseMs)) {
      throw new Error(INVALID_LEASE_MS);
    }
    const tenantId = next.tenantId;
    const v = connectionValues(next);
    await withClient(this.deps.prisma, tenantId, tx, async (c) => {
      await lockConnection(c, tenantId);
      const updated = await c.$executeRaw`
        UPDATE "outreach"."whatsapp_connections" AS w SET
          "status" = ${v.status}, "waba_id" = ${v.wabaId}, "phone_number_id" = ${v.phoneNumberId},
          "display_phone_number" = ${v.displayPhoneNumber}, "verified_name" = ${v.verifiedName},
          "quality_rating" = ${v.qualityRating}, "messaging_limit_tier" = ${v.messagingLimitTier},
          "sealed_credentials" = ${v.sealedCredentials}, "connected_at" = ${v.connectedAt}::timestamp,
          "disconnected_at" = ${v.disconnectedAt}::timestamp, "last_status_sync_at" = ${v.lastStatusSyncAt}::timestamp,
          "last_error" = ${v.lastError}, "onboarding_attempt_id" = ${v.attemptId}::uuid,
          "onboarding_stage" = ${v.stage}, "onboarding_failure" = ${v.failure},
          "onboarding_lease_owner" = ${v.owner}::uuid,
          "onboarding_lease_until" = CASE WHEN ${v.owner}::uuid IS NULL THEN NULL
            ELSE db."now" + (${leaseMs}::double precision * interval '1 millisecond') END,
          "version" = ${holder.version + 1}, "updated_at" = db."now"
        FROM (SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now") AS db
        WHERE w."tenant_id" = ${tenantId} AND w."version" = ${holder.version}
          AND w."onboarding_stage" IS NOT DISTINCT FROM ${holder.onboardingStage}
          AND w."onboarding_attempt_id" IS NOT DISTINCT FROM ${holder.onboardingAttemptId}::uuid
          AND w."phone_number_id" = ${holder.phoneNumberId} AND w."waba_id" = ${holder.wabaId}
          AND w."onboarding_lease_owner" = ${holder.owner}::uuid AND w."onboarding_lease_until" > db."now"`;
      if (updated !== 1) throw leaseLost(tenantId, "owner write");
    });
  }
}

const LEASE_REQUIRED =
  "acquireOnboardingLease must install a lease (an owner and a positive, finite lease length)";
const INVALID_LEASE_MS = "the lease length must be a positive, finite number of milliseconds";

const leaseLost = (tenantId: string, what: string): ConcurrencyError =>
  new ConcurrencyError(
    `Connection ${tenantId}: onboarding lease ${what} lost (row or lease changed)`,
  );

/** Locks the scoped row for the rest of the transaction, so the write's clock sample comes after any competing writer. */
async function lockConnection(c: TransactionClient, tenantId: string): Promise<boolean> {
  const rows = await c.$queryRaw<{ tenant_id: string }[]>`
    SELECT "tenant_id" FROM "outreach"."whatsapp_connections" WHERE "tenant_id" = ${tenantId} FOR UPDATE`;
  return rows.length > 0;
}

const isoOrNull = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/** The bound values of a whole connection row; dates travel as ISO text and are cast to `timestamp` (UTC) in SQL. */
function connectionValues(r: WhatsAppConnectionRecord) {
  return {
    status: r.status,
    wabaId: r.wabaId,
    phoneNumberId: r.phoneNumberId,
    displayPhoneNumber: r.displayPhoneNumber,
    verifiedName: r.verifiedName,
    qualityRating: r.qualityRating,
    messagingLimitTier: r.messagingLimitTier,
    sealedCredentials: r.sealedCredentials,
    connectedAt: isoOrNull(r.connectedAt),
    disconnectedAt: isoOrNull(r.disconnectedAt),
    lastStatusSyncAt: isoOrNull(r.lastStatusSyncAt),
    lastError: r.lastError,
    attemptId: r.onboardingAttemptId,
    stage: r.onboardingStage,
    failure: r.onboardingFailure,
    owner: r.onboardingLeaseOwner,
  };
}

const isValidLeaseMs = (leaseMs: number): boolean => Number.isFinite(leaseMs) && leaseMs > 0;

export interface PrismaPhoneDirectoryDeps extends PrismaOutreachDeps {
  /** The platform scope: every directory row carries it as `tenant_id` (like `tenancy.staff_directory`). */
  readonly platformTenantId: string;
}

const NO_FENCE_TX = "a directory fence needs the caller's unit-of-work transaction";

export class PrismaPhoneDirectory implements PhoneDirectory {
  constructor(private readonly deps: PrismaPhoneDirectoryDeps) {}

  /**
   * Standalone: its own platform-scoped transaction. With the unit of work's `tx`: the SAME transaction, switched to the
   * platform scope for this operation and restored to the shop scope right after (never split).
   */
  private scoped<T>(tx: unknown, run: (c: TransactionClient) => Promise<T>): Promise<T> {
    if (tx === undefined || tx === null) {
      return runInTenantTransaction(this.deps.prisma, this.deps.platformTenantId, run);
    }
    const shop = tenantScopeOf(tx);
    if (shop === undefined) {
      return Promise.reject(
        new Error("the transaction was not opened by the outreach unit of work (no tenant scope)"),
      );
    }
    const client = tx as TransactionClient;
    return withPlatformScope(client, this.deps.platformTenantId, shop, () => run(client));
  }

  async find(
    phoneNumberId: string,
    tx?: unknown,
  ): Promise<{ shopTenantId: string; wabaId: string } | null> {
    const platform = this.deps.platformTenantId;
    const row = await this.scoped(tx, (c) =>
      c.whatsAppPhoneDirectory.findFirst({ where: { tenantId: platform, phoneNumberId } }),
    );
    return row === null ? null : { shopTenantId: row.shopTenantId, wabaId: row.wabaId };
  }

  async findByWaba(
    wabaId: string,
    tx?: unknown,
  ): Promise<{ shopTenantId: string; phoneNumberId: string } | null> {
    const platform = this.deps.platformTenantId;
    const row = await this.scoped(tx, (c) =>
      c.whatsAppPhoneDirectory.findFirst({ where: { tenantId: platform, wabaId } }),
    );
    return row === null
      ? null
      : { shopTenantId: row.shopTenantId, phoneNumberId: row.phoneNumberId };
  }

  async findByShop(
    shopTenantId: string,
    tx?: unknown,
  ): Promise<{ phoneNumberId: string; wabaId: string } | null> {
    const platform = this.deps.platformTenantId;
    const row = await this.scoped(tx, (c) =>
      c.whatsAppPhoneDirectory.findFirst({ where: { tenantId: platform, shopTenantId } }),
    );
    return row === null ? null : { phoneNumberId: row.phoneNumberId, wabaId: row.wabaId };
  }

  async fencePhone(
    phoneNumberId: string,
    tx: unknown,
  ): Promise<{ shopTenantId: string; wabaId: string } | null> {
    if (tx === undefined || tx === null) throw new Error(NO_FENCE_TX);
    const platform = this.deps.platformTenantId;
    // `FOR SHARE`: a concurrent release / claim of this row (DELETE) waits until the caller's transaction ends.
    const rows = await this.scoped(
      tx,
      (c) =>
        c.$queryRaw<{ shop_tenant_id: string; waba_id: string }[]>`
        SELECT "shop_tenant_id", "waba_id" FROM "outreach"."whatsapp_phone_directory"
        WHERE "tenant_id" = ${platform} AND "phone_number_id" = ${phoneNumberId} FOR SHARE`,
    );
    const row = rows[0];
    return row === undefined ? null : { shopTenantId: row.shop_tenant_id, wabaId: row.waba_id };
  }

  async fenceWaba(
    wabaId: string,
    tx: unknown,
  ): Promise<{ shopTenantId: string; phoneNumberId: string } | null> {
    if (tx === undefined || tx === null) throw new Error(NO_FENCE_TX);
    const platform = this.deps.platformTenantId;
    const rows = await this.scoped(
      tx,
      (c) =>
        c.$queryRaw<{ shop_tenant_id: string; phone_number_id: string }[]>`
        SELECT "shop_tenant_id", "phone_number_id" FROM "outreach"."whatsapp_phone_directory"
        WHERE "tenant_id" = ${platform} AND "waba_id" = ${wabaId} FOR SHARE`,
    );
    const row = rows[0];
    return row === undefined
      ? null
      : { shopTenantId: row.shop_tenant_id, phoneNumberId: row.phone_number_id };
  }

  claim(
    phoneNumberId: string,
    wabaId: string,
    shopTenantId: string,
    tx?: unknown,
  ): Promise<ClaimResult> {
    const platform = this.deps.platformTenantId;
    const body = async (c: TransactionClient): Promise<ClaimResult> => {
      // 1. release the shop's own different tuple (the caller rolls the tx back on a non-claim)
      const mine = await c.whatsAppPhoneDirectory.findFirst({
        where: { tenantId: platform, shopTenantId },
      });
      if (mine !== null && !(mine.phoneNumberId === phoneNumberId && mine.wabaId === wabaId)) {
        await c.whatsAppPhoneDirectory.deleteMany({
          where: { tenantId: platform, phoneNumberId: mine.phoneNumberId, shopTenantId },
        });
      }
      // 2. insert, never updating an owner
      await c.whatsAppPhoneDirectory.createMany({
        data: [{ tenantId: platform, phoneNumberId, shopTenantId, wabaId }],
        skipDuplicates: true,
      });
      // 3. read back by phone and by WABA
      const phoneRow = await c.whatsAppPhoneDirectory.findFirst({
        where: { tenantId: platform, phoneNumberId },
      });
      const wabaRow = await c.whatsAppPhoneDirectory.findFirst({
        where: { tenantId: platform, wabaId },
      });
      // 4. claimed ONLY on the full tuple
      if (
        phoneRow !== null &&
        phoneRow.shopTenantId === shopTenantId &&
        phoneRow.wabaId === wabaId &&
        wabaRow !== null &&
        wabaRow.shopTenantId === shopTenantId
      ) {
        return "claimed";
      }
      // 5. otherwise report which asset is taken
      if (phoneRow === null && wabaRow !== null) return "waba_in_use";
      if (
        phoneRow !== null &&
        phoneRow.shopTenantId === shopTenantId &&
        phoneRow.wabaId === wabaId
      ) {
        return "waba_in_use";
      }
      return "phone_in_use";
    };
    if (tx !== undefined && tx !== null) return this.scoped(tx, body);
    // Standalone: an owned transaction that is rolled back on a non-claim, translated back OUTSIDE the rollback.
    return this.scoped(undefined, async (c) => {
      const result = await body(c);
      if (result !== "claimed") throw new NotClaimed(result);
      return result;
    }).catch((error: unknown) => {
      if (error instanceof NotClaimed) return error.result;
      throw error;
    });
  }

  async release(phoneNumberId: string, shopTenantId: string, tx?: unknown): Promise<void> {
    const platform = this.deps.platformTenantId;
    await this.scoped(tx, (c) =>
      c.whatsAppPhoneDirectory.deleteMany({
        where: { tenantId: platform, phoneNumberId, shopTenantId },
      }),
    );
  }
}

export class PrismaContactRepository implements ContactRepository {
  constructor(private readonly deps: PrismaOutreachDeps) {}

  async findByPhone(tenantId: string, e164: string, tx?: unknown): Promise<ContactRecord | null> {
    const row = await withClient(this.deps.prisma, tenantId, tx, (c) =>
      c.contact.findFirst({ where: { tenantId, phoneE164: e164 } }),
    );
    return row === null ? null : contactFromRow(row);
  }

  async findByEmail(tenantId: string, email: string, tx?: unknown): Promise<ContactRecord | null> {
    const row = await withClient(this.deps.prisma, tenantId, tx, (c) =>
      c.contact.findFirst({ where: { tenantId, email } }),
    );
    return row === null ? null : contactFromRow(row);
  }

  async findById(tenantId: string, id: string, tx?: unknown): Promise<ContactRecord | null> {
    const row = await withClient(this.deps.prisma, tenantId, tx, (c) =>
      c.contact.findFirst({ where: { tenantId, id } }),
    );
    return row === null ? null : contactFromRow(row);
  }

  async save(r: ContactRecord, expectedVersion: number, tx?: unknown): Promise<void> {
    await withClient(this.deps.prisma, r.tenantId, tx, async (c) => {
      if (expectedVersion === 0) {
        // Consent columns are omitted on purpose: a new contact takes the DB defaults.
        const created = await c.contact.createMany({
          data: [{ id: r.id, tenantId: r.tenantId, ...contactIdentityColumns(r), version: 1 }],
          skipDuplicates: true,
        });
        if (created.count > 0) return;
        const tenantId = r.tenantId;
        const byId = await c.contact.findFirst({ where: { tenantId, id: r.id } });
        const byPhone =
          r.phoneE164 === null
            ? null
            : await c.contact.findFirst({ where: { tenantId, phoneE164: r.phoneE164 } });
        const byEmail =
          r.email === null
            ? null
            : await c.contact.findFirst({ where: { tenantId, email: r.email } });
        if (byId === null && byPhone === null && byEmail === null) throw unexpectedConflict();
        throw new ConcurrencyError(`Contact ${r.id} collides with an existing contact`);
      }
      const updated = await c.contact.updateMany({
        where: { tenantId: r.tenantId, id: r.id, version: expectedVersion },
        data: { ...contactIdentityColumns(r), version: expectedVersion + 1 },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Contact ${r.id} was modified concurrently (expected version ${expectedVersion})`,
        );
      }
    });
  }

  async saveConsent(r: ContactRecord, expectedVersion: number, tx?: unknown): Promise<void> {
    await withClient(this.deps.prisma, r.tenantId, tx, async (c) => {
      const updated = await c.contact.updateMany({
        where: { tenantId: r.tenantId, id: r.id, version: expectedVersion },
        data: { ...consentColumns(r), version: expectedVersion + 1 },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Contact ${r.id} was modified concurrently (expected version ${expectedVersion})`,
        );
      }
    });
  }

  async appendConsent(e: ConsentEventRecord, tx?: unknown): Promise<void> {
    await withClient(this.deps.prisma, e.tenantId, tx, async (c) => {
      const created = await c.consentEvent.createMany({
        data: [consentEventInsertRow(e)],
        skipDuplicates: true,
      });
      if (created.count === 0) throw unexpectedConflict();
    });
  }

  async clearSessionWindows(tenantId: string, tx?: unknown): Promise<number> {
    const cleared = await withClient(this.deps.prisma, tenantId, tx, (c) =>
      c.contact.updateMany({
        where: { tenantId, lastInboundAt: { not: null } },
        data: { lastInboundAt: null, version: { increment: 1 } },
      }),
    );
    return cleared.count;
  }

  async listConsentEvents(
    tenantId: string,
    contactId: string,
    tx?: unknown,
  ): Promise<ConsentEventRecord[]> {
    const rows = await withClient(this.deps.prisma, tenantId, tx, (c) =>
      c.consentEvent.findMany({
        where: { tenantId, contactId },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      }),
    );
    return rows.map(consentEventFromRow);
  }
}

export class PrismaOutboundMessageRepository implements OutboundMessageRepository {
  constructor(private readonly deps: PrismaOutreachDeps) {}

  private async one(
    tenantId: string,
    tx: unknown,
    find: (c: TransactionClient) => Promise<Parameters<typeof outboundFromRow>[0] | null>,
  ): Promise<OutboundRecord | null> {
    const row = await withClient(this.deps.prisma, tenantId, tx, find);
    return row === null ? null : outboundFromRow(row);
  }

  findById(tenantId: string, id: string, tx?: unknown): Promise<OutboundRecord | null> {
    return this.one(tenantId, tx, (c) => c.outboundMessage.findFirst({ where: { tenantId, id } }));
  }

  findByIdempotencyKey(
    tenantId: string,
    key: string,
    tx?: unknown,
  ): Promise<OutboundRecord | null> {
    return this.one(tenantId, tx, (c) =>
      c.outboundMessage.findFirst({ where: { tenantId, idempotencyKey: key } }),
    );
  }

  findByProviderId(
    tenantId: string,
    providerMessageId: string,
    tx?: unknown,
  ): Promise<OutboundRecord | null> {
    return this.one(tenantId, tx, (c) =>
      c.outboundMessage.findFirst({ where: { tenantId, providerMessageId } }),
    );
  }

  findByCorrelationId(
    tenantId: string,
    correlationId: string,
    tx?: unknown,
  ): Promise<OutboundRecord | null> {
    return this.one(tenantId, tx, (c) =>
      c.outboundMessage.findFirst({ where: { tenantId, correlationId } }),
    );
  }

  async insert(r: OutboundRecord, tx?: unknown): Promise<"inserted" | "duplicate"> {
    return withClient(this.deps.prisma, r.tenantId, tx, async (c) => {
      // createMany + skipDuplicates: a unique violation never aborts an interactive transaction.
      const created = await c.outboundMessage.createMany({
        data: [outboundInsertRow(r)],
        skipDuplicates: true,
      });
      if (created.count > 0) return "inserted";
      // Only the intended replay key (tenant + idempotency key) is a duplicate; anything else must roll the tx back.
      const replay = await c.outboundMessage.findFirst({
        where: { tenantId: r.tenantId, idempotencyKey: r.idempotencyKey },
      });
      if (replay !== null) return "duplicate";
      throw unexpectedConflict();
    });
  }

  async update(r: OutboundRecord, expectedVersion: number, tx?: unknown): Promise<void> {
    await withClient(this.deps.prisma, r.tenantId, tx, async (c) => {
      const updated = await c.outboundMessage.updateMany({
        where: { tenantId: r.tenantId, id: r.id, version: expectedVersion },
        data: { ...outboundMutableColumns(r), version: expectedVersion + 1 },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Outbound ${r.id} was modified concurrently (expected version ${expectedVersion})`,
        );
      }
    });
  }

  async recordStatusEvent(e: StatusEventRecord, tx?: unknown): Promise<"inserted" | "duplicate"> {
    return withClient(this.deps.prisma, e.tenantId, tx, async (c) => {
      const created = await c.messageStatusEvent.createMany({
        data: [statusEventInsertRow(e)],
        skipDuplicates: true,
      });
      if (created.count > 0) return "inserted";
      const replay = await c.messageStatusEvent.findFirst({
        where: { tenantId: e.tenantId, providerEventId: e.providerEventId },
      });
      if (replay !== null) return "duplicate";
      throw unexpectedConflict();
    });
  }

  async listUnresolved(
    tenantId: string,
    olderThan: Date,
    limit: number,
    tx?: unknown,
  ): Promise<UnresolvedOutbound[]> {
    const rows = await withClient(this.deps.prisma, tenantId, tx, (c) =>
      c.outboundMessage.findMany({
        where: { tenantId, status: "pending", dispatchStartedAt: { lt: olderThan } },
        orderBy: [{ dispatchStartedAt: "asc" }, { id: "asc" }],
        take: Math.max(0, limit),
        select: { tenantId: true, id: true, version: true },
      }),
    );
    return rows.map((row) => ({ tenantId: row.tenantId, id: row.id, version: row.version }));
  }

  async markUnknownIfPending(
    tenantId: string,
    id: string,
    expectedVersion: number,
    tx?: unknown,
  ): Promise<"marked" | "skipped"> {
    const updated = await withClient(this.deps.prisma, tenantId, tx, (c) =>
      c.outboundMessage.updateMany({
        where: { tenantId, id, status: "pending", version: expectedVersion },
        data: { status: "unknown", version: expectedVersion + 1 },
      }),
    );
    return updated.count === 0 ? "skipped" : "marked";
  }
}

export class PrismaInboundMessageRepository implements InboundMessageRepository {
  constructor(private readonly deps: PrismaOutreachDeps) {}

  async insert(r: InboundRecord, tx?: unknown): Promise<"inserted" | "duplicate"> {
    return withClient(this.deps.prisma, r.tenantId, tx, async (c) => {
      const created = await c.inboundMessage.createMany({
        data: [inboundInsertRow(r)],
        skipDuplicates: true,
      });
      if (created.count > 0) return "inserted";
      const replay = await c.inboundMessage.findFirst({
        where: { tenantId: r.tenantId, providerMessageId: r.providerMessageId },
      });
      if (replay !== null) return "duplicate";
      throw unexpectedConflict();
    });
  }

  async findByProviderMessageId(
    tenantId: string,
    providerMessageId: string,
    tx?: unknown,
  ): Promise<InboundRecord | null> {
    const row = await withClient(this.deps.prisma, tenantId, tx, (c) =>
      c.inboundMessage.findFirst({ where: { tenantId, providerMessageId } }),
    );
    return row === null ? null : inboundFromRow(row);
  }
}

export interface PrismaUnmatchedDeps extends PrismaOutreachDeps {
  readonly clock: Clock;
}

export class PrismaUnmatchedStatusRepository implements UnmatchedStatusRepository {
  constructor(private readonly deps: PrismaUnmatchedDeps) {}

  async put(e: UnmatchedStatusRecord, tx?: unknown): Promise<"inserted" | "duplicate"> {
    return withClient(this.deps.prisma, e.tenantId, tx, async (c) => {
      const created = await c.unmatchedStatusEvent.createMany({
        data: [unmatchedInsertRow(e)],
        skipDuplicates: true,
      });
      if (created.count > 0) return "inserted";
      const replay = await c.unmatchedStatusEvent.findFirst({
        where: { tenantId: e.tenantId, providerEventId: e.providerEventId },
      });
      if (replay !== null) return "duplicate";
      throw unexpectedConflict();
    });
  }

  async takeFor(
    tenantId: string,
    phoneNumberId: string,
    match: { providerMessageId?: string; correlationId?: string },
    tx?: unknown,
  ): Promise<UnmatchedStatusRecord[]> {
    const alternatives = [
      ...(match.providerMessageId === undefined
        ? []
        : [{ providerMessageId: match.providerMessageId }]),
      ...(match.correlationId === undefined ? [] : [{ correlationId: match.correlationId }]),
    ];
    if (alternatives.length === 0) return [];
    const now = this.deps.clock.now();
    return withClient(this.deps.prisma, tenantId, tx, async (c) => {
      const rows = await c.unmatchedStatusEvent.findMany({
        where: { tenantId, phoneNumberId, resolvedAt: null, OR: alternatives },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      });
      const taken: UnmatchedStatusRecord[] = [];
      for (const row of rows) {
        // The `resolvedAt: null` guard makes the take exclusive if two callers race for the same row.
        const marked = await c.unmatchedStatusEvent.updateMany({
          where: { tenantId, id: row.id, resolvedAt: null },
          data: { resolvedAt: now },
        });
        if (marked.count === 1) taken.push({ ...unmatchedFromRow(row), resolvedAt: now });
      }
      return taken;
    });
  }
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Window starts are UTC-aligned; passed as ISO text and cast, so the DB session time zone never shifts a window. */
export function windowStarts(now: Date): { hour: string; day: string } {
  return {
    hour: new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS).toISOString(),
    day: new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS).toISOString(),
  };
}

export class PrismaEmailSendCounterRepository implements EmailSendCounterRepository {
  async reserve(
    tenantId: string,
    now: Date,
    limits: { perHour: number; perDay: number },
    tx: unknown,
  ): Promise<"reserved" | "hour_cap" | "day_cap"> {
    if (tx === undefined || tx === null) {
      throw new Error(
        "EmailSendCounterRepository.reserve requires the unit of work's transaction client",
      );
    }
    const c = tx as TransactionClient;
    const { hour, day } = windowStarts(now);
    // 1. make sure both window rows exist (a concurrent creator makes this a no-op)
    await c.$executeRaw`
      INSERT INTO "outreach"."email_send_counters" ("tenant_id", "window_kind", "window_start", "count")
      VALUES (${tenantId}, 'hour', ${hour}::timestamp, 0), (${tenantId}, 'day', ${day}::timestamp, 0)
      ON CONFLICT ("tenant_id", "window_kind", "window_start") DO NOTHING`;
    // 2. lock both rows in a fixed order (day < hour), so concurrent reservers serialise instead of overshooting
    const rows = await c.$queryRaw<{ window_kind: string; count: number }[]>`
      SELECT "window_kind", "count" FROM "outreach"."email_send_counters"
      WHERE "tenant_id" = ${tenantId}
        AND (("window_kind" = 'hour' AND "window_start" = ${hour}::timestamp)
          OR ("window_kind" = 'day' AND "window_start" = ${day}::timestamp))
      ORDER BY "window_kind" FOR UPDATE`;
    // Fail closed: after a successful seed BOTH window rows must exist (exactly one of each kind) under this scope.
    const hourRows = rows.filter((x) => x.window_kind === "hour");
    const dayRows = rows.filter((x) => x.window_kind === "day");
    const hourRow = hourRows[0];
    const dayRow = dayRows[0];
    if (
      rows.length !== 2 ||
      hourRows.length !== 1 ||
      dayRows.length !== 1 ||
      hourRow === undefined ||
      dayRow === undefined
    ) {
      throw new Error("email send counter rows are missing after the seed");
    }
    // 3. refuse without touching either window
    if (hourRow.count >= limits.perHour) return "hour_cap";
    if (dayRow.count >= limits.perDay) return "day_cap";
    // 4. increment both windows
    const incremented = await c.$executeRaw`
      UPDATE "outreach"."email_send_counters" SET "count" = "count" + 1
      WHERE "tenant_id" = ${tenantId}
        AND (("window_kind" = 'hour' AND "window_start" = ${hour}::timestamp)
          OR ("window_kind" = 'day' AND "window_start" = ${day}::timestamp))`;
    if (incremented !== 2)
      throw new Error("email send counter increment did not update both windows");
    return "reserved";
  }
}
