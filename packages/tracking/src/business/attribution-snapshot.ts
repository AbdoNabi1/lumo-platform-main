/**
 * The attribution snapshot (P2-D8): what the visitor's browser carried when they placed an order, written once by the
 * checkout `complete` route BEFORE the order exists, so the later server-side Purchase can name the visitor, their
 * click ids and their browser ids. A draft, phone or pre-release order has none and still produces an identity-only
 * event.
 *
 * ## Rules
 *
 * - **First write wins.** A retry, a second attempt after a failed one, or a hostile replay never replaces the
 *   snapshot of the first call: `putIfAbsent` reports `exists` and changes nothing.
 * - **Sanitised on the way in, not trusted.** The checkout route is public; every field is shape-checked and
 *   size-capped here (never truncated — a cut identifier matches nothing), click ids are judged against their
 *   platform's attribution window with the same table the edge capture uses, and what is not valid is DROPPED
 *   rather than failing the checkout. A snapshot that ends up empty is not stored.
 * - **Retention (owner decision).** IP and user agent are nulled 90 days after the write, the whole row is deleted
 *   after 400 days (the same promises as event records and anonymous profiles).
 *
 * Pure: the Postgres adapter lives in `apps/runtime`.
 */

import { isClickIdName, isClickIdValidAt, type ClickIdName } from "../envelope/click-ids";
import { parseIp } from "../enrichment/ip-cidr";
import type { BusinessAttributionSnapshot, SnapshotClickId } from "./order-read-model";

export type AttributionSubjectKind = "checkout" | "lead";

/** The retention windows of P2-D8. */
export const SNAPSHOT_NETWORK_RETENTION_DAYS = 90;
export const SNAPSHOT_RETENTION_DAYS = 400;

const MAX_URL = 2048;
const MAX_TEXT = 512;
const MAX_LABEL = 200;
const MAX_REF = 128;
/** A client clock this far ahead of ours is accepted (and clamped to now); further is not a capture time. */
const CLOCK_SKEW_MS = 5 * 60_000;

const VISITOR_ID = /^[A-Za-z0-9_-]{16,48}$/u;
const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/u;
/** What real click ids are made of (the edge capture refuses anything else, so this mirrors it). */
const CLICK_VALUE = /^[A-Za-z0-9._~:+=/%-]+$/u;
const HTTP_URL = /^https?:\/\/\S+$/iu;
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/gu;
const COOKIE_KEYS = ["fbp", "fbc", "ttp", "scid", "ga"] as const;
const UTM_KEYS = ["source", "medium", "campaign", "content", "term"] as const;

/** What a caller may offer: the same shape as the snapshot, but with names and times still unchecked. */
export interface AttributionSnapshotInput {
  readonly visitorId?: string | null | undefined;
  readonly sessionId?: string | null | undefined;
  readonly ip?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly pageUrl?: string | null | undefined;
  readonly referrer?: string | null | undefined;
  readonly cookies?:
    Readonly<Partial<Record<(typeof COOKIE_KEYS)[number], string | null | undefined>>> | undefined;
  readonly clickIds?:
    | readonly {
        readonly name: string;
        readonly value: string;
        readonly capturedAt: string;
      }[]
    | undefined;
  readonly utm?:
    Readonly<Partial<Record<(typeof UTM_KEYS)[number], string | null | undefined>>> | undefined;
}

/** Maximum length of one click id value: TikTok's can be long, the rest are short. */
function maxClickLength(name: ClickIdName): number {
  return name === "ttclid" ? 1000 : MAX_TEXT;
}

function text(value: string | null | undefined, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(CONTROL, "").trim();
  return cleaned === "" || cleaned.length > max ? undefined : cleaned;
}

/** A label (utm) is cut to its cap: it is a free-text campaign name, not an identifier. */
function label(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(CONTROL, "").trim();
  return cleaned === "" ? undefined : cleaned.slice(0, MAX_LABEL);
}

function url(value: string | null | undefined): string | undefined {
  const cleaned = text(value, MAX_URL);
  return cleaned !== undefined && HTTP_URL.test(cleaned) ? cleaned : undefined;
}

function clickIdsOf(
  input: AttributionSnapshotInput["clickIds"],
  now: Date,
): readonly SnapshotClickId[] {
  const latest = new Map<ClickIdName, SnapshotClickId>();
  for (const click of input ?? []) {
    if (!isClickIdName(click.name)) continue;
    const value = typeof click.value === "string" ? click.value.trim() : "";
    if (value === "" || value.length > maxClickLength(click.name) || !CLICK_VALUE.test(value)) {
      continue;
    }
    const at = Date.parse(click.capturedAt);
    if (Number.isNaN(at) || at > now.getTime() + CLOCK_SKEW_MS) continue;
    const capturedAt = new Date(Math.min(at, now.getTime())).toISOString();
    if (!isClickIdValidAt({ name: click.name, value, capturedAt }, now)) continue;
    const kept = latest.get(click.name);
    if (kept === undefined || Date.parse(kept.capturedAt) < Date.parse(capturedAt)) {
      latest.set(click.name, { name: click.name, value, capturedAt });
    }
  }
  return [...latest.values()];
}

/**
 * The snapshot with everything invalid removed, or `null` when nothing usable is left. `now` is the instant of the
 * write; click ids are judged against it.
 */
export function sanitizeAttributionSnapshot(
  input: AttributionSnapshotInput,
  now: Date,
): BusinessAttributionSnapshot | null {
  const visitorId = typeof input.visitorId === "string" ? input.visitorId.trim() : "";
  const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";
  const ipText = text(input.ip, 64);
  const ip = ipText !== undefined && parseIp(ipText) !== null ? ipText : undefined;
  const userAgent = text(input.userAgent, MAX_TEXT);
  const pageUrl = url(input.pageUrl);
  const referrer = url(input.referrer);

  const cookies: Record<string, string> = {};
  for (const key of COOKIE_KEYS) {
    const value = text(input.cookies?.[key], MAX_TEXT);
    if (value !== undefined) cookies[key] = value;
  }
  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = label(input.utm?.[key]);
    if (value !== undefined) utm[key] = value;
  }
  const clickIds = clickIdsOf(input.clickIds, now);

  const snapshot: BusinessAttributionSnapshot = {
    ...(VISITOR_ID.test(visitorId) ? { visitorId } : {}),
    ...(SESSION_ID.test(sessionId) ? { sessionId } : {}),
    ...(ip === undefined ? {} : { ip }),
    ...(userAgent === undefined ? {} : { userAgent }),
    ...(pageUrl === undefined ? {} : { pageUrl }),
    ...(referrer === undefined ? {} : { referrer }),
    ...(Object.keys(cookies).length === 0 ? {} : { cookies }),
    ...(clickIds.length === 0 ? {} : { clickIds }),
    ...(Object.keys(utm).length === 0 ? {} : { utm }),
  };
  return Object.keys(snapshot).length === 0 ? null : snapshot;
}

export interface AttributionSnapshotWrite {
  readonly tenantId: string;
  readonly subjectKind: AttributionSubjectKind;
  readonly subjectRef: string;
  readonly snapshot: BusinessAttributionSnapshot;
  /** ISO-8601 instant of the write; retention is counted from it. */
  readonly capturedAt: string;
}

/** What the retention pass needs (P2-D8). Every method but the scan runs in the tenant's own scope. */
export interface AttributionSnapshotRetentionPort {
  /** Tenants with a snapshot whose IP/UA is older than `networkCutoff` and still in place, or older than `deleteCutoff`. */
  tenantsWithSnapshotWork(networkCutoff: Date, deleteCutoff: Date): Promise<readonly string[]>;
  /** Nulls IP and user agent on up to `limit` snapshots captured before `cutoff`; marks them. Returns how many. */
  redactNetworkBatch(tenantId: string, cutoff: Date, limit: number, at: Date): Promise<number>;
  /** Deletes up to `limit` snapshots captured before `cutoff`. Returns how many. */
  deleteExpiredBatch(tenantId: string, cutoff: Date, limit: number): Promise<number>;
}

/** The port a database adapter implements. */
export interface AttributionSnapshotStore extends AttributionSnapshotRetentionPort {
  /** Inserts the snapshot unless one exists for the subject. `exists` changes nothing. */
  putIfAbsent(write: AttributionSnapshotWrite): Promise<"created" | "exists">;
  find(
    tenantId: string,
    subjectKind: AttributionSubjectKind,
    subjectRef: string,
  ): Promise<BusinessAttributionSnapshot | null>;
  /** Erasure hook: removes the named subjects of one tenant. Returns how many rows went. */
  deleteSubjects(
    tenantId: string,
    subjectKind: AttributionSubjectKind,
    subjectRefs: readonly string[],
  ): Promise<number>;
}

export interface RecordAttributionSnapshotDeps {
  readonly store: Pick<AttributionSnapshotStore, "putIfAbsent">;
  readonly now: Date;
  readonly tenantId: string;
  readonly subjectKind: AttributionSubjectKind;
  readonly subjectRef: string;
  readonly input: AttributionSnapshotInput;
}

/**
 * Sanitises and stores one snapshot. `created` / `exists` as the store says, `empty` when nothing usable was
 * offered. Throws only on a missing tenant or subject (a bug in the caller) or when the store fails — the caller
 * decides that a failure must never block the order.
 */
export async function recordAttributionSnapshot(
  deps: RecordAttributionSnapshotDeps,
): Promise<"created" | "exists" | "empty"> {
  if (deps.tenantId.trim() === "")
    throw new Error("recordAttributionSnapshot: tenantId is required");
  const ref = deps.subjectRef.trim();
  if (ref === "" || ref.length > MAX_REF) {
    throw new Error("recordAttributionSnapshot: subjectRef is required (1-128 characters)");
  }
  const snapshot = sanitizeAttributionSnapshot(deps.input, deps.now);
  if (snapshot === null) return "empty";
  return deps.store.putIfAbsent({
    tenantId: deps.tenantId,
    subjectKind: deps.subjectKind,
    subjectRef: ref,
    snapshot,
    capturedAt: deps.now.toISOString(),
  });
}

interface StoredSnapshot {
  readonly write: AttributionSnapshotWrite;
  readonly snapshot: BusinessAttributionSnapshot;
  readonly networkRedactedAt: Date | null;
}

const keyOf = (tenantId: string, kind: AttributionSubjectKind, ref: string): string =>
  JSON.stringify([tenantId, kind, ref]);

/** In-memory adapter for tests (tenant-keyed exactly like the table). Plain methods, no I/O. */
export class InMemoryAttributionSnapshotStore implements AttributionSnapshotStore {
  private readonly rows = new Map<string, StoredSnapshot>();

  putIfAbsent(write: AttributionSnapshotWrite): Promise<"created" | "exists"> {
    const key = keyOf(write.tenantId, write.subjectKind, write.subjectRef);
    if (this.rows.has(key)) return Promise.resolve("exists");
    this.rows.set(key, { write, snapshot: write.snapshot, networkRedactedAt: null });
    return Promise.resolve("created");
  }

  find(
    tenantId: string,
    subjectKind: AttributionSubjectKind,
    subjectRef: string,
  ): Promise<BusinessAttributionSnapshot | null> {
    return Promise.resolve(
      this.rows.get(keyOf(tenantId, subjectKind, subjectRef))?.snapshot ?? null,
    );
  }

  deleteSubjects(
    tenantId: string,
    subjectKind: AttributionSubjectKind,
    subjectRefs: readonly string[],
  ): Promise<number> {
    let removed = 0;
    for (const ref of subjectRefs) {
      if (this.rows.delete(keyOf(tenantId, subjectKind, ref))) removed += 1;
    }
    return Promise.resolve(removed);
  }

  tenantsWithSnapshotWork(networkCutoff: Date, deleteCutoff: Date): Promise<readonly string[]> {
    const tenants = new Set<string>();
    for (const row of this.rows.values()) {
      const at = Date.parse(row.write.capturedAt);
      const needsRedaction = row.networkRedactedAt === null && at < networkCutoff.getTime();
      if (needsRedaction || at < deleteCutoff.getTime()) tenants.add(row.write.tenantId);
    }
    return Promise.resolve([...tenants].sort());
  }

  redactNetworkBatch(tenantId: string, cutoff: Date, limit: number, at: Date): Promise<number> {
    let count = 0;
    for (const [key, row] of this.rows) {
      if (count >= limit) break;
      if (row.write.tenantId !== tenantId || row.networkRedactedAt !== null) continue;
      if (Date.parse(row.write.capturedAt) >= cutoff.getTime()) continue;
      const { ip: _ip, userAgent: _userAgent, ...rest } = row.snapshot;
      this.rows.set(key, { ...row, snapshot: rest, networkRedactedAt: at });
      count += 1;
    }
    return Promise.resolve(count);
  }

  deleteExpiredBatch(tenantId: string, cutoff: Date, limit: number): Promise<number> {
    let count = 0;
    for (const [key, row] of [...this.rows]) {
      if (count >= limit) break;
      if (row.write.tenantId !== tenantId) continue;
      if (Date.parse(row.write.capturedAt) >= cutoff.getTime()) continue;
      this.rows.delete(key);
      count += 1;
    }
    return Promise.resolve(count);
  }
}
