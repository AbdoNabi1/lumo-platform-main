import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { AiGovernanceProfile } from "./ai-governance-profile";

const now = new Date("2026-07-17T00:00:00.000Z");
let n = 0;
const id = (): UniqueEntityId => UniqueEntityId.from(`id-${(n += 1)}`);
const govern = (config = {}): AiGovernanceProfile =>
  AiGovernanceProfile.govern(
    id(),
    "ai-1",
    { tokenBudget: 1000, callQuota: 3, windowSeconds: 3600, ...config },
    "e",
    now,
  );

describe("AiGovernanceProfile (§20)", () => {
  it("allows consumption within budget and quota", () => {
    const p = govern();
    const d = p.consume(400, 1, now, "e");
    expect(d.allowed).toBe(true);
    expect(d.remainingTokens).toBe(600);
    expect(d.remainingCalls).toBe(2);
  });

  it("denies and records when the token budget is exceeded", () => {
    const p = govern();
    p.consume(700, 1, now, "e");
    const d = p.consume(400, 1, now, "e"); // 700 + 400 > 1000
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("token budget exceeded");
    expect(p.tokensConsumed).toBe(700); // not incremented on denial
  });

  it("denies when the call quota is exceeded", () => {
    const p = govern();
    p.consume(1, 3, now, "e");
    expect(p.consume(1, 1, now, "e").allowed).toBe(false);
  });

  it("rolls the window and resets consumption", () => {
    const p = govern();
    p.consume(900, 1, now, "e");
    const later = new Date(now.getTime() + 3601 * 1000);
    const d = p.consume(900, 1, later, "e");
    expect(d.allowed).toBe(true); // window reset
    expect(p.tokensConsumed).toBe(900);
  });

  it("enforces sandboxing (tools) and isolation (resources)", () => {
    const p = govern({ allowedTools: ["search"], allowedResources: ["morbeh:catalog:*:*"] });
    expect(p.permitsTool("search")).toBe(true);
    expect(p.permitsTool("delete_all")).toBe(false);
    expect(p.permitsResource("morbeh:catalog:product:p1")).toBe(true);
    expect(p.permitsResource("morbeh:finance:ledger:l1")).toBe(false);
  });

  it("denies all consumption once suspended", () => {
    const p = govern();
    p.suspend("e", now);
    expect(p.consume(1, 1, now, "e").allowed).toBe(false);
  });
});
