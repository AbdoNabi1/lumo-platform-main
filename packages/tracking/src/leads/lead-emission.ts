/**
 * Once-per-session lead decision (lead-site plan B, Task 3).
 *
 * The claim lives exactly as long as the session: same 30-minute TTL as the collector's session
 * cookie, slid forward by `extendLeadClaim` on every request that renews an existing session. It is
 * only ever created by `decideLeadEmission`, so page views alone never suppress a lead.
 */

import { SESSION_TTL_SECONDS } from "../collector/collector";

export interface LeadEmissionLedgerPort {
  /** Atomic: true only if `key` is absent, then stores it for `ttlSeconds` (production: Redis SET key 1 NX EX ttl). */
  claimOnce(key: string, ttlSeconds: number): Promise<boolean>;
  /** Resets the TTL of an existing `key`; never creates it (production: Redis EXPIRE key ttl — a no-op on a missing key). */
  extend(key: string, ttlSeconds: number): Promise<void>;
}

export const LEAD_CLAIM_TTL_SECONDS: number = SESSION_TTL_SECONDS;

export function leadEmissionKey(tenantId: string, sessionId: string): string {
  return `lead-emit:${tenantId}:${sessionId}`;
}

interface SessionRef {
  readonly tenantId: string;
  readonly sessionId: string;
}

function keyFor(input: SessionRef): string {
  if (typeof input.tenantId !== "string" || input.tenantId.trim() === "") {
    throw new RangeError("lead emission: tenantId is blank");
  }
  if (typeof input.sessionId !== "string" || input.sessionId.trim() === "") {
    throw new RangeError("lead emission: sessionId is blank");
  }
  return leadEmissionKey(input.tenantId, input.sessionId);
}

export async function decideLeadEmission(
  ledger: LeadEmissionLedgerPort,
  input: SessionRef,
): Promise<"emit" | "suppressed"> {
  const key = keyFor(input);
  return (await ledger.claimOnce(key, LEAD_CLAIM_TTL_SECONDS)) ? "emit" : "suppressed";
}

export async function extendLeadClaim(
  ledger: LeadEmissionLedgerPort,
  input: SessionRef,
): Promise<void> {
  const key = keyFor(input);
  await ledger.extend(key, LEAD_CLAIM_TTL_SECONDS);
}

/** Test/dev ledger. A key is expired when `now >= storedAt + ttl*1000`. */
export class InMemoryLeadEmissionLedger implements LeadEmissionLedgerPort {
  private readonly entries = new Map<string, { storedAt: number; ttlSeconds: number }>();

  constructor(private readonly clock: { now(): number }) {}

  private live(key: string, now: number): boolean {
    const entry = this.entries.get(key);
    if (entry === undefined) return false;
    if (now >= entry.storedAt + entry.ttlSeconds * 1000) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  claimOnce(key: string, ttlSeconds: number): Promise<boolean> {
    // check-and-set is synchronous: two concurrent calls cannot both observe the key as absent
    const now = this.clock.now();
    if (this.live(key, now)) return Promise.resolve(false);
    this.entries.set(key, { storedAt: now, ttlSeconds });
    return Promise.resolve(true);
  }

  extend(key: string, ttlSeconds: number): Promise<void> {
    const now = this.clock.now();
    if (this.live(key, now)) this.entries.set(key, { storedAt: now, ttlSeconds });
    return Promise.resolve();
  }
}
