import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HealthRegistry, healthReportToHttp } from "./registry";

describe("HealthRegistry", () => {
  it("reports healthy when all probes pass", async () => {
    const report = await new HealthRegistry()
      .register({ name: "a", probe: () => Promise.resolve() })
      .register({ name: "b", probe: () => Promise.resolve() })
      .run();
    expect(report.status).toBe("healthy");
    expect(report.components).toHaveLength(2);
  });

  it("reports unhealthy when a critical probe fails", async () => {
    const report = await new HealthRegistry()
      .register({ name: "ok", probe: () => Promise.resolve() })
      .register({ name: "db", probe: () => Promise.reject(new Error("down")) })
      .run();
    expect(report.status).toBe("unhealthy");
    expect(healthReportToHttp(report).status).toBe(503);
  });

  it("degrades (not fails) when a non-critical probe fails", async () => {
    const report = await new HealthRegistry()
      .register({ name: "cache", critical: false, probe: () => Promise.reject(new Error("miss")) })
      .run();
    expect(report.status).toBe("degraded");
    expect(healthReportToHttp(report).status).toBe(200);
  });

  describe("bounded probes (Phase 9 hardening)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("reports unhealthy (not a hung run()) when a probe never resolves", async () => {
      const runPromise = new HealthRegistry()
        .register({ name: "ok", probe: () => Promise.resolve() })
        .register({ name: "stuck-jwks", probe: () => new Promise<void>(() => {}) })
        .run();

      await vi.advanceTimersByTimeAsync(5_000);
      const report = await runPromise;

      expect(report.status).toBe("unhealthy");
      const stuck = report.components.find((c) => c.name === "stuck-jwks");
      expect(stuck?.status).toBe("unhealthy");
      expect(stuck?.error).toContain("timed out");
    });

    it("degrades rather than fails a hung NON-critical probe", async () => {
      const runPromise = new HealthRegistry()
        .register({
          name: "stuck-cache",
          critical: false,
          probe: () => new Promise<void>(() => {}),
        })
        .run();

      await vi.advanceTimersByTimeAsync(5_000);
      const report = await runPromise;

      expect(report.status).toBe("degraded");
    });

    it("does not report a timeout for a probe that resolves well within the bound", async () => {
      const runPromise = new HealthRegistry()
        .register({
          name: "fast",
          probe: () => new Promise<void>((resolve) => setTimeout(resolve, 10)),
        })
        .run();

      await vi.advanceTimersByTimeAsync(10);
      const report = await runPromise;

      expect(report.status).toBe("healthy");
    });
  });
});
