/**
 * Retention and erasure (Tracking P1-D10) — owner decision 2026-11-27:
 *
 * - an anonymous profile is deleted 400 days after the visitor was last seen;
 * - the IP address and user agent inside an event record are removed 90 days after the event, and nothing else
 *   in the record is touched;
 * - everything about a customer is erased with the customer.
 *
 * There is no consent gating (notice-only), so none of this depends on consent state.
 *
 * ## What "removed" means for an event record
 *
 * The key is taken out of the stored JSON — the envelope's `context.technical.clientIpAddress` /
 * `clientUserAgent` and the same two values inside each destination's rendered vendor payload
 * (`client_ip_address`, `client_user_agent`; TikTok's `ip`, `user_agent`). An absent key is how the schema already
 * says "no value", so every reader keeps working; a literal `null` would not be a valid `string | undefined`.
 * A rendered payload edited this way no longer matches the digest recorded with it, which is the point of the
 * trade: past 90 days the vendors accept no replay anyway (7 days at most), so the record keeps its evidence of
 * WHAT was sent and for whom, minus the two fields that identify a device and a network.
 */

import type { ExpiredProfileScan, TrackingProfileStore } from "./profile-store";

const ENVELOPE_NETWORK_KEYS = ["clientIpAddress", "clientUserAgent"] as const;

/** Keys that hold an IP or user agent anywhere inside a rendered vendor payload. */
const PAYLOAD_NETWORK_KEYS: ReadonlySet<string> = new Set([
  "client_ip_address",
  "client_user_agent",
  "ip",
  "user_agent",
  "ip_override",
  "user_agent_override",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The envelope without its IP and user agent. Returns the input unchanged when it held neither. */
export function redactEnvelopeNetwork(envelope: unknown): unknown {
  if (!isRecord(envelope)) return envelope;
  const context = envelope["context"];
  if (!isRecord(context)) return envelope;
  const technical = context["technical"];
  if (!isRecord(technical)) return envelope;
  if (!ENVELOPE_NETWORK_KEYS.some((key) => key in technical)) return envelope;

  const redacted: Record<string, unknown> = { ...technical };
  for (const key of ENVELOPE_NETWORK_KEYS) delete redacted[key];
  return { ...envelope, context: { ...context, technical: redacted } };
}

/** A vendor payload (any depth) without IP / user agent keys. Returns the input unchanged when it held none. */
export function redactPayloadNetwork(value: unknown): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const mapped = value.map((item: unknown) => {
      const next = redactPayloadNetwork(item);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? mapped : value;
  }
  if (!isRecord(value)) return value;

  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (PAYLOAD_NETWORK_KEYS.has(key)) {
      changed = true;
      continue;
    }
    const next = redactPayloadNetwork(entry);
    if (next !== entry) changed = true;
    result[key] = next;
  }
  return changed ? result : value;
}

/**
 * The per-destination history entries (`destinationHistory` of a record, `destinations` of a revision) with their
 * rendered payloads redacted. Entries are kept; only the payload inside changes.
 */
export function redactDestinationEntries(entries: unknown): unknown {
  if (!Array.isArray(entries)) return entries;
  let changed = false;
  const mapped = entries.map((entry: unknown) => {
    if (!isRecord(entry) || !("renderedPayload" in entry)) return entry;
    const payload = redactPayloadNetwork(entry["renderedPayload"]);
    if (payload === entry["renderedPayload"]) return entry;
    changed = true;
    return { ...entry, renderedPayload: payload };
  });
  return changed ? mapped : entries;
}

/** What the retention job needs from the event-record store. */
export interface EventNetworkRedactionPort {
  /** Tenants that have at least one record captured before `cutoff` whose network data is still in place. */
  tenantsWithUnredactedEvents(cutoff: Date): Promise<readonly string[]>;
  /** Redacts up to `limit` such records of one tenant (and their revisions) and marks them. Returns how many. */
  redactBatch(tenantId: string, cutoff: Date, limit: number, at: Date): Promise<number>;
}

export interface TrackingRetentionDeps {
  readonly profiles: Pick<TrackingProfileStore, "deleteExpiredAnonymous"> & ExpiredProfileScan;
  readonly events: EventNetworkRedactionPort;
  readonly clock: { now(): Date };
  /** Event-record retention in days for IP and user agent (default 90). */
  readonly eventNetworkRetentionDays?: number;
  /** Records redacted per round trip. */
  readonly batchSize?: number;
  /** Stop starting new batches after this long; the next pass continues. */
  readonly budgetMs?: number;
}

export interface TrackingRetentionReport {
  readonly profilesDeleted: number;
  readonly eventsRedacted: number;
  readonly tenantsVisited: number;
  readonly errored: number;
}

const DEFAULT_BATCH = 200;
const DEFAULT_BUDGET_MS = 4 * 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One retention pass. A failure for one tenant is counted and does not stop the others; the pass is
 * idempotent, so the next one simply picks up what is left.
 */
export async function runTrackingRetention(
  deps: TrackingRetentionDeps,
): Promise<TrackingRetentionReport> {
  const startedAt = deps.clock.now();
  const batchSize = deps.batchSize ?? DEFAULT_BATCH;
  const budgetMs = deps.budgetMs ?? DEFAULT_BUDGET_MS;
  const cutoff = new Date(startedAt.getTime() - (deps.eventNetworkRetentionDays ?? 90) * DAY_MS);
  const outOfBudget = (): boolean => deps.clock.now().getTime() - startedAt.getTime() > budgetMs;

  let profilesDeleted = 0;
  let eventsRedacted = 0;
  let errored = 0;
  const tenants = new Set<string>();

  try {
    for (const tenantId of await deps.profiles.tenantsWithExpiredProfiles(startedAt)) {
      if (outOfBudget()) break;
      tenants.add(tenantId);
      try {
        profilesDeleted += await deps.profiles.deleteExpiredAnonymous(tenantId, startedAt);
      } catch {
        errored += 1;
      }
    }
  } catch {
    errored += 1;
  }

  try {
    for (const tenantId of await deps.events.tenantsWithUnredactedEvents(cutoff)) {
      tenants.add(tenantId);
      try {
        while (!outOfBudget()) {
          const redacted = await deps.events.redactBatch(
            tenantId,
            cutoff,
            batchSize,
            deps.clock.now(),
          );
          eventsRedacted += redacted;
          if (redacted < batchSize) break;
        }
      } catch {
        errored += 1;
      }
      if (outOfBudget()) break;
    }
  } catch {
    errored += 1;
  }

  return { profilesDeleted, eventsRedacted, tenantsVisited: tenants.size, errored };
}

/**
 * Erases everything the tracking profile store holds about a customer: their profiles and every cookie id that
 * resolved to one. This is the hook a customer-erasure event calls; no such event exists on the platform yet
 * (see the T2 report), so today it is invoked by whichever flow performs the erasure.
 */
export async function eraseCustomerProfiles(
  store: Pick<TrackingProfileStore, "eraseCustomer">,
  tenantId: string,
  customerId: string,
): Promise<number> {
  if (tenantId.trim() === "" || customerId.trim() === "") {
    throw new Error("eraseCustomerProfiles: tenantId and customerId are required");
  }
  return store.eraseCustomer(tenantId, customerId);
}
