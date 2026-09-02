import { describe, expect, it } from "vitest";
import { AuditChain, GENESIS_HASH } from "./audit-chain";
import { AuditRecord } from "./audit-record";

function append(chain: AuditChain, tail: AuditRecord | null, seqLabel: string): AuditRecord {
  return chain.append(tail, {
    id: `rec-${seqLabel}`,
    principalRef: "svc-billing",
    action: "orders:refund",
    decision: "allow",
    occurredAt: "2026-07-17T00:00:00.000Z",
    metadata: { note: seqLabel },
  });
}

describe("AuditChain (WORM hash chain)", () => {
  it("links records to the genesis anchor and verifies a clean chain", () => {
    const chain = new AuditChain();
    const r1 = append(chain, null, "1");
    const r2 = append(chain, r1, "2");
    const r3 = append(chain, r2, "3");

    expect(r1.prevHash).toBe(GENESIS_HASH);
    expect(r2.prevHash).toBe(r1.hash);
    expect(r3.sequence).toBe(3);
    expect(chain.verify([r1, r2, r3])).toEqual({ valid: true });
  });

  it("detects a tampered record (content mutated, hash stale)", () => {
    const chain = new AuditChain();
    const r1 = append(chain, null, "1");
    const r2 = append(chain, r1, "2");
    const tampered = new AuditRecord({
      id: r2.id,
      content: { ...r2.content, decision: "block" },
      hash: r2.hash,
    });

    const result = chain.verify([r1, tampered]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
    expect(result.reason).toContain("tampered");
  });

  it("detects a broken prevHash / reorder", () => {
    const chain = new AuditChain();
    const r1 = append(chain, null, "1");
    const r2 = append(chain, r1, "2");
    const r3 = append(chain, r2, "3");
    expect(chain.verify([r1, r3, r2]).valid).toBe(false);
  });

  it("is deterministic — same content yields the same hash", () => {
    const a = new AuditChain();
    const b = new AuditChain();
    expect(append(a, null, "1").hash).toBe(append(b, null, "1").hash);
  });
});
