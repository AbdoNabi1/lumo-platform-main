import { beforeEach, describe, expect, it } from "vitest";

import { SESSION_TTL_SECONDS } from "../collector/collector";
import {
  decideLeadEmission,
  extendLeadClaim,
  InMemoryLeadEmissionLedger,
  LEAD_CLAIM_TTL_SECONDS,
  leadEmissionKey,
} from "./lead-emission";

describe("once-per-session lead decision", () => {
  let nowMs: number;
  let ledger: InMemoryLeadEmissionLedger;
  const at = (iso: string) => {
    nowMs = Date.parse(iso);
  };
  const s1 = { tenantId: "t-1", sessionId: "s-1" };

  beforeEach(() => {
    expect.hasAssertions();
    nowMs = Date.parse("2026-11-20T10:00:00.000Z");
    ledger = new InMemoryLeadEmissionLedger({ now: () => nowMs });
  });

  it("a second submit in an active session is suppressed", async () => {
    expect(await decideLeadEmission(ledger, s1)).toBe("emit");
    at("2026-11-20T10:20:00.000Z");
    expect(await decideLeadEmission(ledger, s1)).toBe("suppressed");
  });
  it("activity keeps the claim alive across many hours (and past 48 h)", async () => {
    expect(await decideLeadEmission(ledger, s1)).toBe("emit");
    for (let minute = 25; minute <= 50 * 60; minute += 25) {
      // a page view every 25 min for 50 h
      nowMs = Date.parse("2026-11-20T10:00:00.000Z") + minute * 60_000;
      await extendLeadClaim(ledger, s1);
    }
    expect(await decideLeadEmission(ledger, s1)).toBe("suppressed");
  });
  it("the claim ends with the session: 30 idle minutes", async () => {
    await decideLeadEmission(ledger, s1);
    at("2026-11-20T10:29:59.000Z");
    expect(await decideLeadEmission(ledger, s1)).toBe("suppressed");
    at("2026-11-20T10:30:00.000Z");
    expect(await decideLeadEmission(ledger, s1)).toBe("emit");
  });
  it("a new session id emits again", async () => {
    await decideLeadEmission(ledger, s1);
    at("2026-11-20T11:05:00.000Z");
    expect(await decideLeadEmission(ledger, { tenantId: "t-1", sessionId: "s-2" })).toBe("emit");
  });
  it("extending never creates a claim: page views alone do not suppress", async () => {
    await extendLeadClaim(ledger, s1);
    expect(await decideLeadEmission(ledger, s1)).toBe("emit");
  });
  it("sessions are tenant-scoped", async () => {
    await decideLeadEmission(ledger, s1);
    expect(await decideLeadEmission(ledger, { tenantId: "t-2", sessionId: "s-1" })).toBe("emit");
  });
  it("two concurrent submits in one session emit once", async () => {
    const both = await Promise.all([
      decideLeadEmission(ledger, s1),
      decideLeadEmission(ledger, s1),
    ]);
    expect([...both].sort()).toEqual(["emit", "suppressed"]);
  });
  it.each([
    ["", "s-1"],
    ["t-1", ""],
    ["t-1", "  "],
  ])("refuses tenant %j / session %j", async (tenantId, sessionId) => {
    await expect(decideLeadEmission(ledger, { tenantId, sessionId })).rejects.toThrow(RangeError);
    await expect(extendLeadClaim(ledger, { tenantId, sessionId })).rejects.toThrow(RangeError);
  });
  it("uses the documented key and the collector's session length", () => {
    expect(leadEmissionKey("t-1", "s-1")).toBe("lead-emit:t-1:s-1");
    expect(LEAD_CLAIM_TTL_SECONDS).toBe(SESSION_TTL_SECONDS);
    expect(LEAD_CLAIM_TTL_SECONDS).toBe(1800);
  });
});
