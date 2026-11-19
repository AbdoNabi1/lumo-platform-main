import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createInMemoryOutreach } from "./in-memory-outreach-wiring";

const clock = { now: () => new Date("2026-11-19T10:00:00.000Z") };
const T0 = clock.now();
const open = () => createInMemoryOutreach({ clock, platformTenantId: "platform" });
const limits = { perHour: 1, perDay: 5 };

class Boom extends Error {}

const barrier = () => {
  let open!: () => void;
  const reached = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { reached, open };
};

describe("in-memory store: transaction handles", () => {
  it("reserve rejects another store's LIVE handle and a closed handle, and the next valid reservation still succeeds", async () => {
    expect.hasAssertions();
    const mine = open();
    const foreign = open();
    const tenant = `t-${randomUUID()}`;
    let closed: unknown;
    await mine.unitOfWork.run(tenant, (tx) => {
      closed = tx;
      return Promise.resolve();
    });
    // a handle that is live — but in ANOTHER store — must not seed this store's counters either
    await foreign.unitOfWork.run(tenant, async (foreignTx) => {
      await expect(mine.emailCounters.reserve(tenant, T0, limits, foreignTx)).rejects.toThrow(
        /not an open transaction of this store/,
      );
      await expect(
        mine.emailCounters.reserve(tenant, T0, limits, { not: "a handle" }),
      ).rejects.toThrow(/transaction client/);
    });
    await expect(mine.emailCounters.reserve(tenant, T0, limits, closed)).rejects.toThrow(
      /not an open transaction of this store/,
    );
    // nothing was consumed by the refusals: the first valid reservation takes the only slot, the second is capped
    const reserve = () =>
      mine.unitOfWork.run(tenant, (tx) => mine.emailCounters.reserve(tenant, T0, limits, tx));
    expect(await reserve()).toBe("reserved");
    expect(await reserve()).toBe("hour_cap");
  });

  it("every other repository call also refuses a closed handle instead of writing outside any transaction", async () => {
    expect.hasAssertions();
    const mem = open();
    const tenant = `t-${randomUUID()}`;
    let closed: unknown;
    await mem.unitOfWork.run(tenant, (tx) => {
      closed = tx;
      return Promise.resolve();
    });
    await expect(mem.connections.get(tenant, closed)).rejects.toThrow(
      /not an open transaction of this store/,
    );
    await expect(mem.templates.list(tenant, "waba", closed)).rejects.toThrow(
      /not an open transaction of this store/,
    );
    await expect(mem.directory.find("phone", closed)).rejects.toThrow(
      /not an open transaction of this store/,
    );
  });

  it("a call joined to the live transaction does not relock, and a throwing standalone write leaves nothing", async () => {
    expect.hasAssertions();
    const mem = open();
    const tenant = `t-${randomUUID()}`;
    // many joined calls inside one open unit of work complete (they would deadlock on a second acquisition)
    await mem.unitOfWork.run(tenant, async (tx) => {
      for (let i = 0; i < 3; i += 1) {
        expect(await mem.connections.get(tenant, tx)).toBeNull();
        expect(await mem.templates.list(tenant, "waba", tx)).toEqual([]);
        expect(await mem.directory.findByShop(tenant, tx)).toBeNull();
      }
    });
    // an aborted unit of work is gone for standalone readers that queued behind it
    const opened = barrier();
    const abort = barrier();
    const aborted = mem.unitOfWork.run(tenant, async (tx) => {
      expect(await mem.directory.claim("phone-1", "waba-1", tenant, tx)).toBe("claimed");
      opened.open();
      await abort.reached;
      throw new Boom("abort");
    });
    await opened.reached;
    const reader = mem.directory.find("phone-1");
    abort.open();
    await expect(aborted).rejects.toBeInstanceOf(Boom);
    expect(await reader).toBeNull();
  });
});
