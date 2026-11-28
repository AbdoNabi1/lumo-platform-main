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

  it("persists through the Prisma repository when a database is given (tenant set before the insert)", async () => {
    const calls: string[] = [];
    const prisma = {
      $executeRaw: (_strings: TemplateStringsArray, tenant: unknown) => {
        calls.push(`set_config:${String(tenant)}`);
        return Promise.resolve(1);
      },
      $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
      lead: {
        findFirst: () => Promise.resolve(null),
        create: () => {
          calls.push("lead.create");
          return Promise.resolve({});
        },
      },
    };
    const wired = wireLeads({
      clock: fixedClock(),
      idGenerator: sequentialIds(),
      shop: fakeShop(),
      prisma: prisma as never,
    });
    const response = await wired.controller.submit(validInput());
    expect(response.status).toBe(201);
    expect(calls).toEqual(["set_config:t-1", "set_config:t-1", "lead.create"]);
  });
});
