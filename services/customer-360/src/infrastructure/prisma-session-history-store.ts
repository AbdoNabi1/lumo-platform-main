import type { Database, TransactionClient } from "@platform/db";
import type { DomainEvent } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { SessionCloseReason } from "../domain/session-boundary";
import type { SessionSnapshot, SessionSnapshotReason } from "../domain/session-snapshot";
import type { SessionHistoryStore } from "../ports/session-history-store";
import { readScoped } from "./scoped-read";

export interface PrismaSessionHistoryStoreDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  readonly idGenerator: { generate(): string };
}

interface SnapshotRow {
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
  readonly capturedAt: Date;
  readonly reason: string;
}

function toDomain(row: SnapshotRow): SessionSnapshot {
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
    capturedAt: row.capturedAt.toISOString(),
    reason: row.reason as SessionSnapshotReason,
  };
}

/** Production `SessionHistoryStore` on the `customer_360` schema. Append-only — same discipline as
 * `PrismaProfileHistoryStore` (same package, same convention, including the `requireTx` guard so a
 * write can never bypass the unit of work the outbox atomicity depends on, ADR-0003). One
 * difference: `event` is optional here, matching the port's own optional-event shape (see
 * `SessionHistoryStore.append`'s doc — `RebuildSessions` appends with no event). */
export class PrismaSessionHistoryStore implements SessionHistoryStore {
  private readonly deps: PrismaSessionHistoryStoreDeps;

  constructor(deps: PrismaSessionHistoryStoreDeps) {
    this.deps = deps;
  }

  async append(
    snapshot: SessionSnapshot,
    tenantId: string,
    event?: DomainEvent,
    tx?: unknown,
  ): Promise<void> {
    const client = this.requireTx(tx);
    await client.sessionSnapshot.create({
      data: {
        id: this.deps.idGenerator.generate(),
        tenantId,
        sessionId: snapshot.sessionId,
        visitorId: snapshot.visitorId,
        deviceId: snapshot.deviceId,
        journeyId: snapshot.journeyId,
        source: snapshot.source,
        status: snapshot.status,
        startedAt: new Date(snapshot.startedAt),
        lastActivityAt: new Date(snapshot.lastActivityAt),
        closedAt: snapshot.closedAt === undefined ? null : new Date(snapshot.closedAt),
        closeReason: snapshot.closeReason ?? null,
        pageCount: snapshot.pageCount,
        version: snapshot.version,
        capturedAt: new Date(snapshot.capturedAt),
        reason: snapshot.reason,
      },
    });
    if (event !== undefined) {
      await this.deps.outbox.write([event], { ...this.deps.context, tenantId }, client);
    }
  }

  async listFor(
    sessionId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly SessionSnapshot[]> {
    return readScoped(this.deps.prisma, tenantId, tx, async (client) => {
      const rows = await client.sessionSnapshot.findMany({
        where: { tenantId, sessionId },
        orderBy: { capturedAt: "asc" },
      });
      return rows.map(toDomain);
    });
  }

  async latestFor(
    sessionId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<SessionSnapshot | null> {
    return readScoped(this.deps.prisma, tenantId, tx, async (client) => {
      const row = await client.sessionSnapshot.findFirst({
        where: { tenantId, sessionId },
        orderBy: { capturedAt: "desc" },
      });
      return row === null ? null : toDomain(row);
    });
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaSessionHistoryStore.append requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
