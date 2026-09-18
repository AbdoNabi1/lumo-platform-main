import type { Database, TransactionClient } from "@platform/db";
import type { CustomerSession } from "../domain/customer-session";
import type { SessionCloseReason } from "../domain/session-boundary";
import type { SessionStore } from "../ports/session-store";
import { readScoped } from "./scoped-read";

export interface PrismaSessionStoreDeps {
  readonly prisma: Database;
  readonly idGenerator: { generate(): string };
}

interface CacheRow {
  readonly sessionId: string;
  readonly visitorId: string;
  readonly deviceId: string | null;
  readonly journeyId: string | null;
  readonly source: string | null;
  readonly status: string;
  readonly startedAt: Date;
  readonly lastActivityAt: Date;
  readonly closedAt: Date | null;
  readonly closeReason: string | null;
  readonly pageCount: number;
  readonly version: number;
}

function toDomain(row: CacheRow): CustomerSession {
  return {
    sessionId: row.sessionId,
    visitorId: row.visitorId,
    deviceId: row.deviceId ?? undefined,
    journeyId: row.journeyId ?? undefined,
    source: row.source ?? undefined,
    status: row.status === "closed" ? "closed" : "open",
    startedAt: row.startedAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    closedAt: row.closedAt?.toISOString(),
    closeReason: (row.closeReason ?? undefined) as SessionCloseReason | undefined,
    pageCount: row.pageCount,
    version: row.version,
  };
}

/** Production `SessionStore` on the `customer_360` schema — an upsertable cache (rebuildable by
 * event replay via `RebuildSessions`), unlike the append-only Prisma adapters this package also
 * ships. Mirrors `PrismaProfileStore`'s shape exactly (same package, same convention). */
export class PrismaSessionStore implements SessionStore {
  private readonly deps: PrismaSessionStoreDeps;

  constructor(deps: PrismaSessionStoreDeps) {
    this.deps = deps;
  }

  async getCurrent(
    sessionId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<CustomerSession | null> {
    return readScoped(this.deps.prisma, tenantId, tx, async (client) => {
      const row = await client.customerSessionCache.findUnique({
        where: { tenantId_sessionId: { tenantId, sessionId } },
      });
      return row === null ? null : toDomain(row);
    });
  }

  async saveCurrent(session: CustomerSession, tenantId: string, tx?: unknown): Promise<void> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const where = {
      tenantId_sessionId: { tenantId, sessionId: session.sessionId },
    };
    const data = {
      visitorId: session.visitorId,
      deviceId: session.deviceId,
      journeyId: session.journeyId,
      source: session.source,
      status: session.status,
      startedAt: new Date(session.startedAt),
      lastActivityAt: new Date(session.lastActivityAt),
      closedAt: session.closedAt === undefined ? null : new Date(session.closedAt),
      closeReason: session.closeReason ?? null,
      pageCount: session.pageCount,
      version: session.version,
    };
    await client.customerSessionCache.upsert({
      where,
      create: {
        id: this.deps.idGenerator.generate(),
        tenantId,
        sessionId: session.sessionId,
        ...data,
      },
      update: data,
    });
  }

  async listOpenForVisitor(
    visitorId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly CustomerSession[]> {
    return readScoped(this.deps.prisma, tenantId, tx, async (client) => {
      const rows = await client.customerSessionCache.findMany({
        where: { tenantId, visitorId, status: "open" },
      });
      return rows.map(toDomain);
    });
  }

  async listForVisitor(
    visitorId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly CustomerSession[]> {
    return readScoped(this.deps.prisma, tenantId, tx, async (client) => {
      const rows = await client.customerSessionCache.findMany({
        where: { tenantId, visitorId },
      });
      return rows.map(toDomain);
    });
  }

  async listSessionIds(tenantId: string, tx?: unknown): Promise<readonly string[]> {
    return readScoped(this.deps.prisma, tenantId, tx, async (client) => {
      const rows = await client.customerSessionCache.findMany({
        where: { tenantId },
        select: { sessionId: true },
      });
      return rows.map((row) => row.sessionId);
    });
  }
}
