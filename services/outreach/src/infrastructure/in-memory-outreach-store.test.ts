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

const MISSING_TX = "Already inside this outreach unit of work; pass tx to the repository call";

describe("in-memory store: a missing tx inside a unit of work fails fast", () => {
  // a short timeout turns the old behaviour (waiting forever on its own gate) into a failure
  it(
    "a standalone read inside run rejects at once, rolls the unit back, and the store stays usable",
    { timeout: 2000 },
    async () => {
      expect.hasAssertions();
      const mem = open();
      const tenant = `t-${randomUUID()}`;
      const failure = mem.unitOfWork.run(tenant, async (tx) => {
        expect(await mem.directory.claim("phone-1", "waba-1", tenant, tx)).toBe("claimed");
        await mem.connections.get(tenant); // no tx
      });
      await expect(failure).rejects.toThrow(MISSING_TX);
      // the write made with tx was rolled back, and a later standalone read completes
      expect(await mem.directory.find("phone-1")).toBeNull();
      expect(await mem.connections.get(tenant)).toBeNull();
    },
  );

  it(
    "the no-tx multi-step (owned) path fails fast too, and a queued independent caller is not affected",
    { timeout: 2000 },
    async () => {
      expect.hasAssertions();
      const mem = open();
      const tenant = `t-${randomUUID()}`;
      const opened = barrier();
      const proceed = barrier();
      const failure = mem.unitOfWork.run(tenant, async (tx) => {
        expect(await mem.directory.claim("phone-2", "waba-2", tenant, tx)).toBe("claimed");
        opened.open();
        await proceed.reached;
        await mem.templates.applyStatusEvent(tenant, "waba-2", "meta-x", {
          status: "REJECTED",
          reason: null,
          eventAt: T0,
        }); // no tx
      });
      await opened.reached;
      // an independent caller (no async context of the unit of work) still queues behind it and then completes
      const independent = mem.directory.find("phone-2");
      proceed.open();
      await expect(failure).rejects.toThrow(MISSING_TX);
      expect(await independent).toBeNull();
      expect(await mem.directory.find("phone-2")).toBeNull();
    },
  );

  it(
    "a detached callback whose context handle is no longer the active one queues instead of failing",
    { timeout: 2000 },
    async () => {
      expect.hasAssertions();
      const mem = open();
      const tenant = `t-${randomUUID()}`;
      const go = barrier();
      let detached: Promise<unknown> = Promise.resolve();
      // scheduled inside the first unit of work (its handle is in the async context), runs after it has ended
      await mem.unitOfWork.run(tenant, () => {
        detached = go.reached.then(() => mem.connections.get(tenant));
        return Promise.resolve();
      });
      const holding = barrier();
      const finish = barrier();
      const second = mem.unitOfWork.run(tenant, async () => {
        holding.open();
        await finish.reached;
      });
      await holding.reached;
      go.open();
      let settled = false;
      void detached.then(
        () => (settled = true),
        () => (settled = true),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(settled).toBe(false); // queued behind the second unit of work, not rejected as "inside" it
      finish.open();
      await second;
      expect(await detached).toBeNull();
    },
  );
});

describe("in-memory store: keyed transaction locks (overlapping mode)", () => {
  const overlapping = () =>
    createInMemoryOutreach({ clock, platformTenantId: "platform", overlap: true });
  const lock = (mem: ReturnType<typeof open>, tx: unknown, key: string) =>
    mem.unmatched.lockMessage("t", "p", key, tx);
  const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

  it("a second overlapping transaction waits for the same key until the holder commits; other keys do not wait", async () => {
    expect.hasAssertions();
    const mem = overlapping();
    const hold = barrier();
    const order: string[] = [];
    const first = mem.unitOfWork.run("t", async (tx) => {
      await lock(mem, tx, "m1");
      await lock(mem, tx, "m1"); // re-entrant for the holder
      order.push("first-locked");
      await hold.reached;
      order.push("first-done");
    });
    await tick();
    const other = mem.unitOfWork.run("t", async (tx) => {
      await lock(mem, tx, "m2");
      order.push("other-locked");
    });
    const second = mem.unitOfWork.run("t", async (tx) => {
      await lock(mem, tx, "m1");
      order.push("second-locked");
    });
    await tick();
    expect(order).toEqual(["first-locked", "other-locked"]);
    hold.open();
    await Promise.all([first, other, second]);
    expect(order).toEqual(["first-locked", "other-locked", "first-done", "second-locked"]);
  });

  it("the key is released when the holder aborts, and a lock without a live transaction is refused", async () => {
    expect.hasAssertions();
    const mem = overlapping();
    const aborted = mem.unitOfWork.run("t", async (tx) => {
      await lock(mem, tx, "m1");
      throw new Boom("abort");
    });
    await expect(aborted).rejects.toBeInstanceOf(Boom);
    await mem.unitOfWork.run("t", (tx) => lock(mem, tx, "m1"));
    await expect(lock(mem, undefined, "m1")).rejects.toThrow(/needs the caller's transaction/);
  });
});
