/**
 * Template reconciliation rules (plan Task 4, rounds 2–3). Pure decision functions plus a small orchestration over a
 * `TemplateRowAccess`, so the in-memory and the Prisma template repositories share ONE implementation of the ordering
 * rules (revision CAS, fence, equal-second staleness) and differ only in how rows are read and compare-and-set.
 */
import { ConcurrencyError } from "@platform/utils";
import type {
  FetchedTemplate,
  TemplateCategoryValue,
  TemplateEventResult,
  TemplateFetchResult,
  TemplateRecord,
  TemplateSnapshotResult,
  TemplateStatus,
  TemplateStatusChange,
} from "./repositories";

export type TemplatePatch = Partial<
  Pick<
    TemplateRecord,
    | "metaTemplateId"
    | "category"
    | "components"
    | "status"
    | "rejectedReason"
    | "qualityScore"
    | "lastSyncedAt"
    | "statusEventAt"
    | "categoryEventAt"
    | "reconciledAt"
  >
>;

/** The access a template repository gives the shared algorithm. Scoped to ONE tenant + ONE WABA by the implementer. */
export interface TemplateRowAccess {
  list(): Promise<TemplateRecord[]>;
  findByMetaId(metaTemplateId: string): Promise<TemplateRecord | null>;
  /** `false` when the insert hit a unique conflict (a concurrent writer created the row). */
  insert(row: TemplateRecord): Promise<boolean>;
  /** Compare-and-set on `current.revision`; applies `patch` with `revision + 1` and `version + 1`. `false` on a miss. */
  update(current: TemplateRecord, patch: TemplatePatch): Promise<boolean>;
}

/** The row as it looks after `patch` is applied by a successful CAS. */
export function patchedRow(row: TemplateRecord, patch: TemplatePatch): TemplateRecord {
  return { ...row, ...patch, revision: row.revision + 1, version: row.version + 1 };
}

const MAX_CAS_ATTEMPTS = 3;
const same = (a: Date | null, b: Date): boolean => a !== null && a.getTime() === b.getTime();

type EventDecision =
  { result: "stale" | "noop" } | { result: "applied" | "conflict"; patch: TemplatePatch };

/**
 * `stale` when `eventAt <= reconciledAt` (an equal-second fact is not provably newer than an authoritative fetch) or
 * `eventAt < marker`. An equal marker with the same value is a `noop`; with a different value a `conflict` (the status
 * becomes UNKNOWN: non-sendable until the next fetch).
 */
function decideEvent(
  row: TemplateRecord,
  eventAt: Date,
  marker: Date | null,
  sameValue: boolean,
  applied: TemplatePatch,
): EventDecision {
  if (row.reconciledAt !== null && eventAt.getTime() <= row.reconciledAt.getTime()) {
    return { result: "stale" };
  }
  if (marker !== null && eventAt.getTime() < marker.getTime()) return { result: "stale" };
  if (same(marker, eventAt)) {
    if (sameValue || row.status === "UNKNOWN") return { result: "noop" };
    return { result: "conflict", patch: { status: "UNKNOWN" } };
  }
  return { result: "applied", patch: applied };
}

export function decideStatusEvent(
  row: TemplateRecord,
  event: { status: TemplateStatus; reason: string | null; eventAt: Date },
): EventDecision {
  return decideEvent(row, event.eventAt, row.statusEventAt, row.status === event.status, {
    status: event.status,
    rejectedReason: event.reason,
    statusEventAt: event.eventAt,
  });
}

export function decideCategoryEvent(
  row: TemplateRecord,
  event: { category: TemplateCategoryValue; eventAt: Date },
): EventDecision {
  return decideEvent(row, event.eventAt, row.categoryEventAt, row.category === event.category, {
    category: event.category,
    categoryEventAt: event.eventAt,
  });
}

const maxDate = (a: Date | null, b: Date): Date =>
  a !== null && a.getTime() > b.getTime() ? a : b;

type FetchDecision =
  { result: "raced" } | { result: "fence_newer" } | { result: "applied"; patch: TemplatePatch };

export function decideFetched(
  row: TemplateRecord,
  fetched: FetchedTemplate,
  fetch: { revisionAtFetchStart: number; fetchStartedAt: Date },
): FetchDecision {
  if (row.revision !== fetch.revisionAtFetchStart) return { result: "raced" };
  if (row.reconciledAt !== null && row.reconciledAt.getTime() > fetch.fetchStartedAt.getTime()) {
    return { result: "fence_newer" };
  }
  return {
    result: "applied",
    patch: {
      metaTemplateId: fetched.metaTemplateId,
      category: fetched.category,
      components: fetched.components,
      status: fetched.status,
      rejectedReason: fetched.rejectedReason,
      qualityScore: fetched.qualityScore,
      lastSyncedAt: fetch.fetchStartedAt,
      reconciledAt: maxDate(row.reconciledAt, fetch.fetchStartedAt),
    },
  };
}

async function applyEvent(
  access: TemplateRowAccess,
  metaTemplateId: string,
  decide: (row: TemplateRecord) => EventDecision,
): Promise<TemplateEventResult> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const row = await access.findByMetaId(metaTemplateId);
    if (row === null) return "not_found";
    const decision = decide(row);
    if (!("patch" in decision)) return decision.result;
    if (await access.update(row, decision.patch)) return decision.result;
  }
  throw new ConcurrencyError(`Template ${metaTemplateId} kept changing during an event apply`);
}

export function applyStatusEventTo(
  access: TemplateRowAccess,
  metaTemplateId: string,
  event: { status: TemplateStatus; reason: string | null; eventAt: Date },
): Promise<TemplateEventResult> {
  return applyEvent(access, metaTemplateId, (row) => decideStatusEvent(row, event));
}

export function applyCategoryEventTo(
  access: TemplateRowAccess,
  metaTemplateId: string,
  event: { category: TemplateCategoryValue; eventAt: Date },
): Promise<TemplateEventResult> {
  return applyEvent(access, metaTemplateId, (row) => decideCategoryEvent(row, event));
}

export async function applyFetchedTo(
  access: TemplateRowAccess,
  row: FetchedTemplate,
  fetch: { revisionAtFetchStart: number; fetchStartedAt: Date },
): Promise<TemplateFetchResult> {
  const current = await access.findByMetaId(row.metaTemplateId);
  if (current === null) return "raced";
  const decision = decideFetched(current, row, fetch);
  if (decision.result !== "applied") return decision.result;
  // A miss means a write landed between the read and the CAS: the snapshot is stale by definition.
  return (await access.update(current, decision.patch)) ? "applied" : "raced";
}

const nameLanguageKey = (name: string, language: string): string => `${name}\u0000${language}`;

export function newTemplateRow(
  tenantId: string,
  wabaId: string,
  row: FetchedTemplate,
  fetchStartedAt: Date,
): TemplateRecord {
  return {
    id: row.id,
    tenantId,
    wabaId,
    metaTemplateId: row.metaTemplateId,
    name: row.name,
    language: row.language,
    category: row.category,
    components: row.components,
    status: row.status,
    rejectedReason: row.rejectedReason,
    qualityScore: row.qualityScore,
    lastSyncedAt: fetchStartedAt,
    statusEventAt: null,
    categoryEventAt: null,
    reconciledAt: fetchStartedAt,
    revision: 1,
    version: 1,
  };
}

export async function reconcileSnapshotTo(
  access: TemplateRowAccess,
  identity: { tenantId: string; wabaId: string },
  rows: readonly FetchedTemplate[],
  fetch: { revisionsAtFetchStart: ReadonlyMap<string, number>; fetchStartedAt: Date },
): Promise<TemplateSnapshotResult> {
  const local = await access.list();
  const byMeta = new Map<string, TemplateRecord>();
  const byKey = new Map<string, TemplateRecord>();
  for (const l of local) {
    if (l.metaTemplateId !== null) byMeta.set(l.metaTemplateId, l);
    byKey.set(nameLanguageKey(l.name, l.language), l);
  }
  const seen = new Set<string>();
  const result: TemplateSnapshotResult = { statusChanges: [], raced: 0, fenceNewer: 0 };
  const change = (
    r: {
      metaTemplateId: string | null;
      name: string;
      language: string;
      category: TemplateCategoryValue;
    },
    from: TemplateStatus | null,
    to: TemplateStatus,
  ): void => {
    const c: TemplateStatusChange = {
      metaTemplateId: r.metaTemplateId,
      name: r.name,
      language: r.language,
      category: r.category,
      from,
      to,
    };
    result.statusChanges.push(c);
  };

  for (const fetched of rows) {
    const existing =
      byMeta.get(fetched.metaTemplateId) ??
      byKey.get(nameLanguageKey(fetched.name, fetched.language));
    if (existing === undefined) {
      const inserted = await access.insert(
        newTemplateRow(identity.tenantId, identity.wabaId, fetched, fetch.fetchStartedAt),
      );
      if (inserted) change(fetched, null, fetched.status);
      else result.raced += 1;
      continue;
    }
    seen.add(existing.id);
    const expected = fetch.revisionsAtFetchStart.get(
      existing.metaTemplateId ?? fetched.metaTemplateId,
    );
    if (expected === undefined) {
      result.raced += 1;
      continue;
    }
    const decision = decideFetched(existing, fetched, {
      revisionAtFetchStart: expected,
      fetchStartedAt: fetch.fetchStartedAt,
    });
    if (decision.result === "raced") result.raced += 1;
    else if (decision.result === "fence_newer") result.fenceNewer += 1;
    else if (!(await access.update(existing, decision.patch))) result.raced += 1;
    else if (existing.status !== fetched.status) change(fetched, existing.status, fetched.status);
  }

  for (const l of local) {
    if (seen.has(l.id) || l.status === "DELETED") continue;
    const expected =
      l.metaTemplateId === null ? undefined : fetch.revisionsAtFetchStart.get(l.metaTemplateId);
    if (expected === undefined || expected !== l.revision) {
      result.raced += 1;
      continue;
    }
    if (l.reconciledAt !== null && l.reconciledAt.getTime() > fetch.fetchStartedAt.getTime()) {
      result.fenceNewer += 1;
      continue;
    }
    const ok = await access.update(l, {
      status: "DELETED",
      lastSyncedAt: fetch.fetchStartedAt,
      reconciledAt: maxDate(l.reconciledAt, fetch.fetchStartedAt),
    });
    if (ok) change(l, l.status, "DELETED");
    else result.raced += 1;
  }
  return result;
}
