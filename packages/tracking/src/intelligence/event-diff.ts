/**
 * Event Diff (P5.5 / P8.4) â€” what changed between an original delivery and its replay.
 *
 * ## The question this answers
 *
 * A replay went out. Did the vendor receive *the same thing*? "The replay succeeded" is not an
 * answer â€” a replay can succeed while sending materially different bytes, and that is the failure
 * mode worth catching, because it is silent and it corrupts reporting rather than breaking it.
 *
 * D-080 fixed the guarantee as **historical business payload, freshly generated transport
 * envelope**. So a correct replay shows:
 *
 * - **no** business payload changes,
 * - transport differences that are *expected* (a new request id, a re-signed authorization),
 * - and possibly a different vendor response.
 *
 * Any business-payload change is therefore a defect by definition, and this module's job is to make
 * that distinction mechanical instead of a judgement call made by whoever is reading two JSON blobs
 * at 2am.
 *
 * ## Why changes are classified, not just listed
 *
 * A raw structural diff of two payloads is honest but useless: it reports the regenerated nonce and
 * the corrupted order value with equal weight, so the reader learns to skim it, and skimming is how
 * the one that matters gets missed. Every change here carries a {@link DiffSeverity} derived from
 * *what* changed, not from how different it looks.
 */

import { BUSINESS_TIME_KEYS, TRANSPORT_METADATA_KEYS } from "../delivery/transport-envelope";

/** What kind of change this is. */
export type DiffKind = "added" | "removed" | "changed";

/**
 * How much a change matters.
 *
 * - `expected` â€” transport metadata that D-080 requires to be regenerated. Its absence would be the
 *   bug; seeing it change is proof the guarantee is working.
 * - `informational` â€” a response or timing difference. Real, but not evidence of incorrectness.
 * - `defect` â€” a business payload difference. Replay is supposed to re-send frozen bytes, so this
 *   cannot happen without something being wrong.
 */
export type DiffSeverity = "expected" | "informational" | "defect";

export interface FieldChange {
  /** Dotted path, e.g. `custom_data.value`. Array indices appear as `items.0.sku`. */
  readonly path: string;
  readonly kind: DiffKind;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly severity: DiffSeverity;
}

export interface DestinationChange {
  readonly destination: string;
  readonly kind: DiffKind;
  readonly beforeStatus?: string;
  readonly afterStatus?: string;
}

export interface VersionChange {
  readonly field: string;
  readonly before?: number | string;
  readonly after?: number | string;
}

export interface EventDiff {
  readonly eventId: string;
  readonly payloadChanges: readonly FieldChange[];
  readonly destinationChanges: readonly DestinationChange[];
  readonly responseChanges: readonly FieldChange[];
  readonly versionChanges: readonly VersionChange[];
  /**
   * True when every payload change is `expected`. This is the headline: a replay is faithful when
   * only transport metadata moved.
   */
  readonly faithful: boolean;
  readonly defectCount: number;
}

/** One side of a comparison. Shaped to accept a stored record or a simulated render. */
export interface DiffSide {
  readonly payload: Readonly<Record<string, unknown>>;
  readonly destinations?: Readonly<Record<string, { readonly status: string }>>;
  readonly response?: Readonly<Record<string, unknown>>;
  readonly versions?: Readonly<Record<string, number | string>>;
}

/**
 * Classifies a payload path.
 *
 * `BUSINESS_TIME_KEYS` is checked **before** the transport list, mirroring `toBusinessPayload`.
 * `event_time` looks exactly like transport metadata and is business-critical: regenerating it lands
 * the conversion in the wrong attribution window. The two lists are imported rather than restated
 * so this classification cannot drift from the one that strips payloads at record time.
 */
function severityFor(path: string): DiffSeverity {
  const leaf = (path.split(".").pop() ?? path).toLowerCase();
  if (BUSINESS_TIME_KEYS.includes(leaf)) return "defect";
  if (TRANSPORT_METADATA_KEYS.includes(leaf)) return "expected";
  return "defect";
}

/**
 * Compares an original delivery against its replay.
 *
 * Order-independent for object keys and order-*dependent* for arrays: `{a,b}` and `{b,a}` are the
 * same payload, but `[itemA, itemB]` and `[itemB, itemA]` are not â€” line-item order is semantic in
 * every commerce payload, and treating arrays as sets would hide a reordering that changes what the
 * vendor attributes revenue to.
 */
export function diffEvents(eventId: string, before: DiffSide, after: DiffSide): EventDiff {
  const payloadChanges = diffValues("", before.payload, after.payload).map((change) => ({
    ...change,
    severity: severityFor(change.path),
  }));

  const responseChanges = diffValues("", before.response ?? {}, after.response ?? {}).map(
    (change) => ({
      ...change,
      // A vendor answering differently on replay is expected and is not evidence of a bad payload.
      severity: "informational" as const,
    }),
  );

  const destinationChanges = diffDestinations(before.destinations ?? {}, after.destinations ?? {});
  const versionChanges = diffVersions(before.versions ?? {}, after.versions ?? {});
  const defectCount = payloadChanges.filter((change) => change.severity === "defect").length;

  return {
    eventId,
    payloadChanges,
    destinationChanges,
    responseChanges,
    versionChanges,
    faithful: defectCount === 0,
    defectCount,
  };
}

function diffDestinations(
  before: Readonly<Record<string, { readonly status: string }>>,
  after: Readonly<Record<string, { readonly status: string }>>,
): readonly DestinationChange[] {
  const changes: DestinationChange[] = [];

  for (const [destination, entry] of Object.entries(before)) {
    const next = after[destination];
    if (next === undefined) {
      changes.push({ destination, kind: "removed", beforeStatus: entry.status });
    } else if (next.status !== entry.status) {
      changes.push({
        destination,
        kind: "changed",
        beforeStatus: entry.status,
        afterStatus: next.status,
      });
    }
  }

  for (const [destination, entry] of Object.entries(after)) {
    if (!(destination in before)) {
      // A destination that appears only on replay is worth surfacing loudly: replay targets come
      // from stored history, never from re-evaluated rules, so a new one means the scope was built
      // from something other than the record.
      changes.push({ destination, kind: "added", afterStatus: entry.status });
    }
  }

  return changes.sort((a, b) => (a.destination < b.destination ? -1 : 1));
}

function diffVersions(
  before: Readonly<Record<string, number | string>>,
  after: Readonly<Record<string, number | string>>,
): readonly VersionChange[] {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: VersionChange[] = [];

  for (const field of [...fields].sort()) {
    if (before[field] !== after[field]) {
      changes.push({
        field,
        ...(before[field] === undefined ? {} : { before: before[field] }),
        ...(after[field] === undefined ? {} : { after: after[field] }),
      });
    }
  }

  return changes;
}

/** Recursive structural comparison producing dotted paths. */
function diffValues(prefix: string, before: unknown, after: unknown): FieldChange[] {
  if (isPlainObject(before) && isPlainObject(after)) {
    const changes: FieldChange[] = [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

    for (const key of [...keys].sort()) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      const hasBefore = key in before;
      const hasAfter = key in after;

      if (!hasBefore) {
        changes.push({ path, kind: "added", after: after[key], severity: "defect" });
      } else if (!hasAfter) {
        changes.push({ path, kind: "removed", before: before[key], severity: "defect" });
      } else {
        changes.push(...diffValues(path, before[key], after[key]));
      }
    }

    return changes;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const changes: FieldChange[] = [];
    const length = Math.max(before.length, after.length);

    for (let index = 0; index < length; index += 1) {
      const path = `${prefix}.${String(index)}`;
      if (index >= before.length) {
        changes.push({ path, kind: "added", after: after[index], severity: "defect" });
      } else if (index >= after.length) {
        changes.push({ path, kind: "removed", before: before[index], severity: "defect" });
      } else {
        changes.push(...diffValues(path, before[index], after[index]));
      }
    }

    return changes;
  }

  if (!sameScalar(before, after)) {
    return [{ path: prefix, kind: "changed", before, after, severity: "defect" }];
  }

  return [];
}

/**
 * Scalar equality with one deliberate refinement: `NaN` equals `NaN`.
 *
 * `===` reports two `NaN`s as different, which would make an unchanged payload diff as changed on
 * every comparison. (`canonicalize` throws on NaN at record time, so this should be unreachable for
 * stored payloads â€” it matters for simulated sides, which have not been through that gate.)
 */
function sameScalar(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Number.isNaN(a) && Number.isNaN(b) ? true : a === b;
  }
  return a === b;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
