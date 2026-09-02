/**
 * Prisma-backed Event Record store (M6.2).
 *
 * ## Append-only, enforced by construction
 *
 * This adapter issues **only** `create` — never `update`, never `upsert`, never `delete`. That is
 * the whole point of the module: the domain's `EventRecordWriterPort` has no `update` method, and
 * an adapter that quietly satisfied it with one would break replay determinism for every event it
 * touched, silently and irreversibly.
 *
 * A record's current value is therefore a **fold**: the immutable base row plus its revisions
 * applied in `revisionSeq` order. Reads are slightly more expensive than a single row lookup; that
 * cost buys a complete forensic history that a mutable row cannot provide at any price.
 *
 * ## Why a duplicate append must fail
 *
 * `append` relies on the unique `(tenant_id, event_id)` constraint to reject a second write for the
 * same event rather than overwriting the first. A retried ingest that overwrote the original would
 * replace the payload replay depends on with a newly-derived one — the exact silent rewrite of
 * history the architecture forbids. The constraint violation is surfaced, not swallowed.
 */

import type { Database } from "@platform/db";
import type { IdGenerator } from "@platform/contracts";
import type {
  DestinationHistoryEntry,
  EventRecord,
  EventRecordWriterPort,
  EventState,
  StageHistoryEntry,
} from "@platform/tracking";

/** Shape of a persisted base row, as read back before folding. */
interface RecordRow {
  readonly tenantId: string;
  readonly eventId: string;
  readonly dedupId: string;
  readonly eventName: string;
  readonly capturedAt: Date;
  readonly envelope: unknown;
  readonly consent: unknown;
  readonly identity: unknown;
  readonly attribution: unknown;
  readonly versions: unknown;
  readonly hashStatus: string | null;
  readonly identityConfidence: number | null;
  readonly stageHistory: unknown;
  readonly destinationHistory: unknown;
  readonly state: string;
}

interface RevisionRow {
  readonly revisionSeq: number;
  readonly stages: unknown;
  readonly destinations: unknown;
  readonly state: string;
  readonly at: Date;
}

/**
 * Folds a base row and its revisions into the current record.
 *
 * Stage history **accumulates** (every stage outcome ever recorded is retained), while destination
 * history is keyed by destination and the latest revision wins for that destination only. Those
 * differ because a stage entry is a distinct historical event, whereas a destination entry carries
 * the full attempt list for that destination — appending them naively would duplicate attempts.
 * The superseded entries are not lost: they remain in their revision rows, which is where a
 * forensic query looks.
 */
export function foldRecord(base: RecordRow, revisions: readonly RevisionRow[]): EventRecord {
  const ordered = [...revisions].sort((a, b) => a.revisionSeq - b.revisionSeq);

  const stages: StageHistoryEntry[] = [...(base.stageHistory as StageHistoryEntry[])];
  const destinations = new Map<string, DestinationHistoryEntry>();

  for (const entry of base.destinationHistory as DestinationHistoryEntry[]) {
    destinations.set(entry.destination, entry);
  }

  let state = base.state as EventState;
  let updatedAt = base.capturedAt.toISOString();

  for (const revision of ordered) {
    stages.push(...(revision.stages as StageHistoryEntry[]));
    for (const entry of revision.destinations as DestinationHistoryEntry[]) {
      destinations.set(entry.destination, entry);
    }
    state = revision.state as EventState;
    updatedAt = revision.at.toISOString();
  }

  return {
    eventId: base.eventId,
    dedupId: base.dedupId,
    tenantId: base.tenantId,
    eventName: base.eventName,
    capturedAt: base.capturedAt.toISOString(),
    envelope: base.envelope as EventRecord["envelope"],
    consentSnapshot: base.consent as EventRecord["consentSnapshot"],
    identitySnapshot: base.identity as EventRecord["identitySnapshot"],
    ...(base.attribution === null
      ? {}
      : { attributionSnapshot: base.attribution as EventRecord["attributionSnapshot"] }),
    hashStatus: (base.hashStatus ?? undefined) as EventRecord["hashStatus"],
    ...(base.identityConfidence === null ? {} : { identityConfidence: base.identityConfidence }),
    versions: base.versions as EventRecord["versions"],
    stageHistory: stages,
    destinationHistory: [...destinations.values()],
    state,
    updatedAt,
  };
}

type TrackingDb = Database & {
  trackingEventRecord: {
    create(args: unknown): Promise<unknown>;
    findFirst(args: unknown): Promise<RecordRow | null>;
    findMany(args: unknown): Promise<RecordRow[]>;
  };
  trackingEventRevision: {
    create(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<RevisionRow[]>;
    count(args: unknown): Promise<number>;
  };
};

/**
 * **P1.3 scope note.** This implements `EventRecordWriterPort` only — the append-only half the
 * ingest path uses (`RecordingRuntimeDeps.records` is typed as the writer, not the store). The
 * `EventRecordStorePort` read half is not implemented here because its `query` method needs
 * `selectRecords` from `packages/tracking/src/inspector/timeline.ts`, which K7 deferred for lack of
 * primary-source evidence (`K7_FINAL_RECONCILIATION_REPORT.md`). `get` is kept — it needs nothing
 * deferred — so re-adding `query` and the `implements EventRecordStorePort` clause later is a local
 * change with no schema or write-path impact.
 */
export class PrismaEventRecordStore implements EventRecordWriterPort {
  constructor(
    private readonly db: TrackingDb,
    private readonly idGenerator: IdGenerator,
  ) {}

  /** Writes the immutable base row. Fails on a duplicate `eventId` rather than overwriting it. */
  async append(record: EventRecord): Promise<void> {
    await this.db.trackingEventRecord.create({
      data: {
        id: this.idGenerator.generate(),
        tenantId: record.tenantId,
        eventId: record.eventId,
        dedupId: record.dedupId,
        eventName: record.eventName,
        capturedAt: new Date(record.capturedAt),
        envelope: record.envelope,
        consent: record.consentSnapshot,
        identity: record.identitySnapshot,
        attribution: record.attributionSnapshot ?? null,
        versions: record.versions,
        hashStatus: record.hashStatus ?? null,
        identityConfidence: record.identityConfidence ?? null,
        stageHistory: record.stageHistory,
        destinationHistory: record.destinationHistory,
        state: record.state,
      },
    });
  }

  /**
   * Appends a revision. Never touches the base row.
   *
   * The sequence number is derived from the current revision count. Two concurrent writers can
   * therefore compute the same number — and the unique `(tenant_id, event_id, revision_seq)`
   * constraint makes that collide loudly instead of one write silently vanishing. Delivery for a
   * single event is sequential within a worker, so the collision path is a genuine anomaly worth
   * surfacing rather than a case to design around.
   */
  async appendHistory(input: {
    eventId: string;
    stages?: readonly StageHistoryEntry[];
    destinations?: readonly DestinationHistoryEntry[];
    state: EventState;
    at: string;
  }): Promise<void> {
    const base = await this.db.trackingEventRecord.findFirst({
      where: { eventId: input.eventId },
      select: { tenantId: true },
    });

    if (base === null) {
      // History for an unknown event means the base append never landed — which would mean an event
      // was delivered with no record. Surfaced loudly; it must never be created implicitly here,
      // because a synthesized base row would have no envelope, no snapshots and no payload.
      throw new Error(`tracking: no event record for eventId "${input.eventId}"`);
    }

    const existing = await this.db.trackingEventRevision.count({
      where: { tenantId: base.tenantId, eventId: input.eventId },
    });

    await this.db.trackingEventRevision.create({
      data: {
        id: this.idGenerator.generate(),
        tenantId: base.tenantId,
        eventId: input.eventId,
        revisionSeq: existing + 1,
        stages: input.stages ?? [],
        destinations: input.destinations ?? [],
        state: input.state,
        at: new Date(input.at),
      },
    });
  }

  async get(eventId: string): Promise<EventRecord | null> {
    const base = await this.db.trackingEventRecord.findFirst({ where: { eventId } });
    if (base === null) return null;

    const revisions = await this.db.trackingEventRevision.findMany({
      where: { tenantId: base.tenantId, eventId },
      orderBy: { revisionSeq: "asc" },
    });

    return foldRecord(base, revisions);
  }
}
