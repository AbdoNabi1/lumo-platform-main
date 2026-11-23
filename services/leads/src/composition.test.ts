import { InMemoryLeadEmissionLedger } from "@platform/tracking";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wireLeads } from "./composition";
import { fakeShop, fixedClock, sequentialIds, validInput } from "./testing/fixtures";

beforeEach(() => {
  expect.hasAssertions();
});

describe("wireLeads", () => {
  it("defaults to an in-memory ledger so the second lead in a session is suppressed", async () => {
    const wired = wireLeads({
      clock: fixedClock(),
      idGenerator: sequentialIds(),
      shop: fakeShop(),
    });
    const first = await wired.controller.submit(validInput());
    const second = await wired.controller.submit(validInput());
    expect((first.body as { emission: string }).emission).toBe("emit");
    expect((second.body as { emission: string }).emission).toBe("suppressed");
    expect(await wired.drainOutbox()).toBe(0);
    expect(wired.deliveredEventTypes).toEqual([]);
  });

  it("uses an injected ledger", async () => {
    const clock = fixedClock();
    const ledger = new InMemoryLeadEmissionLedger({ now: () => clock.now().getTime() });
    const claim = vi.spyOn(ledger, "claimOnce");
    const wired = wireLeads({ clock, idGenerator: sequentialIds(), shop: fakeShop(), ledger });
    await wired.controller.submit(validInput());
    expect(claim).toHaveBeenCalledWith("lead-emit:t-1:s-1", 1800);
  });

  it("refuses a Prisma database until persistence is wired (fails loud, never silently in-memory)", () => {
    expect(() =>
      wireLeads({
        clock: fixedClock(),
        idGenerator: sequentialIds(),
        shop: fakeShop(),
        prisma: {} as never,
      }),
    ).toThrow(/not wired/);
  });
});
