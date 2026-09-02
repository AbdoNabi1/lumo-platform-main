import { describe, expect, it, vi } from "vitest";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import {
  EntitlementGuard,
  InMemoryEntitlementPort,
  type EntitlementPort,
} from "./entitlement-guard";

describe("EntitlementGuard (@platform/entitlement)", () => {
  it("allows a guarded command when the feature is entitled and runs it exactly once", async () => {
    const port = new InMemoryEntitlementPort().set("t1", "ai.copy", true);
    const guard = new EntitlementGuard(port);
    const run = vi.fn(async (): Promise<Result<string, DomainError>> => ok("ran"));
    const res = await guard.guard({ tenant: "t1", featureKey: "ai.copy" }, run);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toBe("ran");
    expect(run).toHaveBeenCalledOnce();
  });

  it("denies (403/FORBIDDEN) and never invokes the command when not entitled", async () => {
    const port = new InMemoryEntitlementPort().set("t1", "ai.copy", false);
    const guard = new EntitlementGuard(port);
    const run = vi.fn(async (): Promise<Result<string, DomainError>> => ok("ran"));
    const res = await guard.guard({ tenant: "t1", featureKey: "ai.copy" }, run);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
    expect(run).not.toHaveBeenCalled();
  });

  it("defaults to deny for an unknown tenant×feature (fail-closed default)", async () => {
    const guard = new EntitlementGuard(new InMemoryEntitlementPort());
    expect((await guard.ensure({ tenant: "t1", featureKey: "unknown" })).ok).toBe(false);
  });

  it("fails closed when the decision port throws — denies with source guard_error", async () => {
    const throwing: EntitlementPort = {
      check: async () => {
        throw new Error("licensing down");
      },
    };
    const seen: string[] = [];
    const guard = new EntitlementGuard(throwing, { onDecision: (d) => seen.push(d.source) });
    const decision = await guard.evaluate({ tenant: "t1", featureKey: "ai.copy" });
    expect(decision.allowed).toBe(false);
    expect(decision.source).toBe("guard_error");
    expect(seen).toEqual(["guard_error"]);
  });

  it("is deterministic and idempotent — repeated evaluation yields the same verdict with no side effects", async () => {
    const port = new InMemoryEntitlementPort().set("t1", "ai.copy", true);
    const guard = new EntitlementGuard(port);
    const a = await guard.evaluate({ tenant: "t1", featureKey: "ai.copy" });
    const b = await guard.evaluate({ tenant: "t1", featureKey: "ai.copy" });
    expect(a).toEqual(b);
  });
});
