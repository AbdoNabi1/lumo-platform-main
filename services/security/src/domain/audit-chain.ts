import { AuditRecord, canonicalizeAuditContent, type AuditRecordContent } from "./audit-record";

/** Genesis anchor for the first record's `prevHash`. */
export const GENESIS_HASH = "genesis";

/**
 * A deterministic content digest. The domain stays pure and dependency-free: production injects a
 * SHA-256 digest via a port adapter; {@link defaultDigest} is a pure-TS fallback (used in tests and
 * offline) that is stable and well-distributed but NOT cryptographic — the chain shape and
 * tamper-detection logic are identical either way (ADR-0023 amendment, gap G-SEC-2).
 */
export type Digest = (input: string) => string;

/** Pure-TS 128-bit hex digest (FNV-1a mixed across four offset streams). Deterministic, no deps. */
export const defaultDigest: Digest = (input: string): string => {
  const seeds = [0x811c9dc5, 0x01000193, 0xdeadbeef, 0xcafebabe];
  const acc = seeds.map((seed) => seed >>> 0);
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    for (let s = 0; s < acc.length; s += 1) {
      acc[s] = (acc[s] ?? 0) ^ ((code + s * 7) & 0xff);
      acc[s] = Math.imul(acc[s] ?? 0, 0x01000193) >>> 0;
    }
  }
  return acc.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
};

export interface AppendAuditInput {
  readonly id: string;
  readonly principalRef: string;
  readonly action: string;
  readonly decision: string;
  readonly resource?: string | null;
  readonly tenantRef?: string | null;
  /** RFC 3339 UTC timestamp (from the Clock port). */
  readonly occurredAt: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface ChainVerification {
  readonly valid: boolean;
  /** Sequence number of the first broken link, when `valid` is false. */
  readonly brokenAt?: number;
  readonly reason?: string;
}

/**
 * The **audit chain** domain service — appends WORM records and verifies tamper-evidence. Appending
 * is pure: `prevHash` links to the ledger tail, `hash = digest(canonical(content))`. Verification
 * recomputes every hash and checks sequence + `prevHash` continuity, so any mutation, reorder, or
 * gap is detected (sprint Part 4). No clock/id generation here — both are supplied.
 */
export class AuditChain {
  constructor(private readonly digest: Digest = defaultDigest) {}

  append(tail: AuditRecord | null, input: AppendAuditInput): AuditRecord {
    const content: AuditRecordContent = {
      sequence: tail === null ? 1 : tail.sequence + 1,
      principalRef: input.principalRef,
      action: input.action,
      decision: input.decision,
      resource: input.resource ?? null,
      tenantRef: input.tenantRef ?? null,
      occurredAt: input.occurredAt,
      metadata: { ...(input.metadata ?? {}) },
      prevHash: tail === null ? GENESIS_HASH : tail.hash,
    };
    const hash = this.digest(canonicalizeAuditContent(content));
    return new AuditRecord({ id: input.id, content, hash });
  }

  /** Recomputes the whole chain and returns the first inconsistency, if any. */
  verify(records: readonly AuditRecord[]): ChainVerification {
    let prevHash = GENESIS_HASH;
    let expectedSeq = 1;
    for (const record of records) {
      if (record.sequence !== expectedSeq) {
        return {
          valid: false,
          brokenAt: record.sequence,
          reason: `expected sequence ${expectedSeq}, found ${record.sequence}`,
        };
      }
      if (record.prevHash !== prevHash) {
        return { valid: false, brokenAt: record.sequence, reason: "prevHash discontinuity" };
      }
      const recomputed = this.digest(canonicalizeAuditContent(record.content));
      if (recomputed !== record.hash) {
        return {
          valid: false,
          brokenAt: record.sequence,
          reason: "content hash mismatch (tampered)",
        };
      }
      prevHash = record.hash;
      expectedSeq += 1;
    }
    return { valid: true };
  }
}
