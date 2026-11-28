import { runInTenantTransaction, runReadScoped, type Database } from "@platform/db";
import type { Lead } from "../domain/lead";
import type {
  LeadListQuery,
  LeadRepository,
  PendingTrackingQuery,
} from "../domain/lead-repository";
import { MIN_PHONE_SEARCH_DIGITS, toLatinDigits } from "../domain/lead-search";
import { leadToRowData, rowToLead } from "./lead.mapper";
import { isSubmissionKeyViolation, isUuid } from "./rows";

export interface PrismaLeadRepositoryDeps {
  readonly prisma: Database;
}

/** Inbox search: name/email substring (any case), plus the E.164 phone when ≥3 digits are given. */
function searchClause(search: string) {
  const needle = search.trim();
  if (needle === "") return {};
  const digits = toLatinDigits(search).replace(/\D/g, "");
  return {
    OR: [
      { name: { contains: needle, mode: "insensitive" as const } },
      { email: { contains: needle, mode: "insensitive" as const } },
      ...(digits.length >= MIN_PHONE_SEARCH_DIGITS ? [{ phoneE164: { contains: digits } }] : []),
    ],
  };
}

/**
 * `LeadRepository` on Prisma. ADR-0014: a tenant-agnostic singleton — every call takes the verified
 * `tenantId`, names it in `where`, and runs inside `set_config('app.tenant_id', …)` (writes in
 * `runInTenantTransaction`, reads in `runReadScoped`), so RLS and the explicit filter agree.
 */
export class PrismaLeadRepository implements LeadRepository {
  constructor(private readonly deps: PrismaLeadRepositoryDeps) {}

  async insert(tenantId: string, lead: Lead): Promise<"inserted" | "duplicate"> {
    try {
      await runInTenantTransaction(this.deps.prisma, tenantId, (tx) =>
        tx.lead.create({ data: leadToRowData(tenantId, lead) }),
      );
      return "inserted";
    } catch (error) {
      if (isSubmissionKeyViolation(error)) return "duplicate";
      throw error;
    }
  }

  async findBySubmissionKey(tenantId: string, submissionKey: string): Promise<Lead | null> {
    const row = await runReadScoped(this.deps.prisma, tenantId, (tx) =>
      tx.lead.findFirst({ where: { tenantId, submissionKey } }),
    );
    return row === null ? null : rowToLead(row);
  }

  async markPendingIfSuppressed(
    tenantId: string,
    submissionKey: string,
    sessionId: string,
  ): Promise<boolean> {
    const result = await runInTenantTransaction(this.deps.prisma, tenantId, (tx) =>
      tx.lead.updateMany({
        where: { tenantId, submissionKey, sessionId, trackingStatus: "suppressed" },
        data: { trackingStatus: "pending", version: { increment: 1 }, updatedAt: new Date() },
      }),
    );
    return result.count === 1;
  }

  /**
   * The sweeper's cross-tenant read (P2-D9): ONE short read-only transaction behind the explicit `app.tracking_sweep`
   * switch (migration `20261210000000_leads_tracking_pending`: a second SELECT policy, open only while the switch is on
   * and only for `pending` rows). It selects tenant ids and nothing else; every row it leads to is read and written in
   * that tenant's own scope.
   */
  async listTenantsWithPendingTracking(
    createdBefore: Date,
    limit: number,
  ): Promise<readonly string[]> {
    const cutoff = createdBefore.toISOString();
    const rows = await this.deps.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tracking_sweep', 'on', true)`;
      return tx.$queryRaw<{ tenant_id: string }[]>`
        SELECT tenant_id
        FROM "leads"."leads"
        WHERE tracking_status = 'pending' AND created_at < ${cutoff}::timestamp
        GROUP BY tenant_id
        ORDER BY MIN(created_at) ASC, tenant_id ASC
        LIMIT ${limit}`;
    });
    return rows.map((row) => row.tenant_id);
  }

  async listPendingTracking(
    tenantId: string,
    query: PendingTrackingQuery,
  ): Promise<readonly Lead[]> {
    const rows = await runReadScoped(this.deps.prisma, tenantId, (tx) =>
      tx.lead.findMany({
        where: { tenantId, trackingStatus: "pending", createdAt: { lt: query.createdBefore } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: query.limit,
      }),
    );
    return rows.map(rowToLead);
  }

  async markTracking(
    tenantId: string,
    id: string,
    to: "sent" | "failed",
    at: Date,
  ): Promise<boolean> {
    if (!isUuid(id)) return false;
    const result = await runInTenantTransaction(this.deps.prisma, tenantId, (tx) =>
      tx.lead.updateMany({
        where: { tenantId, id, trackingStatus: "pending" },
        data: { trackingStatus: to, updatedAt: at },
      }),
    );
    return result.count === 1;
  }

  async get(tenantId: string, id: string): Promise<Lead | null> {
    if (!isUuid(id)) return null;
    const row = await runReadScoped(this.deps.prisma, tenantId, (tx) =>
      tx.lead.findFirst({ where: { id, tenantId } }),
    );
    return row === null ? null : rowToLead(row);
  }

  async updateStatus(tenantId: string, lead: Lead): Promise<boolean> {
    const { id, status, version, updatedAt } = lead.props;
    if (!isUuid(id)) return false;
    const result = await runInTenantTransaction(this.deps.prisma, tenantId, (tx) =>
      tx.lead.updateMany({
        where: { id, tenantId, version: version - 1 },
        data: { status, version, updatedAt },
      }),
    );
    return result.count === 1;
  }

  async list(tenantId: string, query: LeadListQuery): Promise<readonly Lead[]> {
    const { after, status, search, createdFrom, createdTo } = query;
    if (after !== undefined && !isUuid(after)) return [];
    const where = {
      tenantId,
      ...(after !== undefined ? { id: { lt: after } } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(createdFrom !== undefined || createdTo !== undefined
        ? {
            createdAt: {
              ...(createdFrom !== undefined ? { gte: createdFrom } : {}),
              ...(createdTo !== undefined ? { lte: createdTo } : {}),
            },
          }
        : {}),
      ...(search !== undefined ? searchClause(search) : {}),
    };
    const rows = await runReadScoped(this.deps.prisma, tenantId, (tx) =>
      tx.lead.findMany({ where, orderBy: { id: "desc" }, take: query.first + 1 }),
    );
    return rows.map(rowToLead);
  }
}
