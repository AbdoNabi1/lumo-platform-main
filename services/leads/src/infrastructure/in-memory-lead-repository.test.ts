import { beforeEach, describe, expect, it } from "vitest";
import { leadOf } from "../testing/fixtures";
import { InMemoryLeadRepository } from "./in-memory-lead-repository";

beforeEach(() => {
  expect.hasAssertions();
});

const id = (n: number): string => `01930000-0000-7000-8000-${String(n).padStart(12, "0")}`;

describe("InMemoryLeadRepository", () => {
  it("inserts and gets within the tenant only", async () => {
    const repo = new InMemoryLeadRepository();
    await repo.insert("t-1", leadOf({ id: id(1) }));
    expect((await repo.get("t-1", id(1)))?.props.id).toBe(id(1));
    expect(await repo.get("t-2", id(1))).toBeNull();
    expect(await repo.get("t-1", id(9))).toBeNull();
  });

  it("insert reports duplicate for a repeated (tenant, submissionKey) and writes nothing", async () => {
    const repo = new InMemoryLeadRepository();
    expect(await repo.insert("t-1", leadOf({ id: id(1), submissionKey: "key-shared-1" }))).toBe(
      "inserted",
    );
    expect(await repo.insert("t-1", leadOf({ id: id(2), submissionKey: "key-shared-1" }))).toBe(
      "duplicate",
    );
    expect(await repo.get("t-1", id(2))).toBeNull();
    expect(await repo.insert("t-2", leadOf({ id: id(3), submissionKey: "key-shared-1" }))).toBe(
      "inserted",
    );
  });

  it("decides concurrent inserts with one key synchronously: one inserted, one duplicate", async () => {
    const repo = new InMemoryLeadRepository();
    const results = await Promise.all([
      repo.insert("t-1", leadOf({ id: id(1), submissionKey: "key-race-0001" })),
      repo.insert("t-1", leadOf({ id: id(2), submissionKey: "key-race-0001" })),
    ]);
    expect([...results].sort()).toEqual(["duplicate", "inserted"]);
  });

  it("finds a lead by submission key within the tenant only", async () => {
    const repo = new InMemoryLeadRepository();
    await repo.insert("t-1", leadOf({ id: id(1), submissionKey: "key-find-0001" }));
    expect((await repo.findBySubmissionKey("t-1", "key-find-0001"))?.props.id).toBe(id(1));
    expect(await repo.findBySubmissionKey("t-2", "key-find-0001")).toBeNull();
    expect(await repo.findBySubmissionKey("t-1", "key-missing-1")).toBeNull();
  });

  it("markPendingIfSuppressed flips only a matching suppressed row, once, bumping version", async () => {
    const repo = new InMemoryLeadRepository();
    await repo.insert(
      "t-1",
      leadOf({
        id: id(1),
        submissionKey: "key-mark-0001",
        sessionId: "s-1",
        trackingStatus: "suppressed",
      }),
    );
    expect(await repo.markPendingIfSuppressed("t-2", "key-mark-0001", "s-1")).toBe(false);
    expect(await repo.markPendingIfSuppressed("t-1", "key-mark-0001", "s-other")).toBe(false);
    expect(await repo.markPendingIfSuppressed("t-1", "key-mark-0001", "s-1")).toBe(true);
    expect(await repo.markPendingIfSuppressed("t-1", "key-mark-0001", "s-1")).toBe(false);
    const stored = await repo.get("t-1", id(1));
    expect(stored?.props.trackingStatus).toBe("pending");
    expect(stored?.props.version).toBe(1);
  });

  it("rejects a duplicate id for the same tenant", async () => {
    const repo = new InMemoryLeadRepository();
    await repo.insert("t-1", leadOf({ id: id(1) }));
    await expect(repo.insert("t-1", leadOf({ id: id(1) }))).rejects.toThrow(/already exists/);
  });

  it("updateStatus is optimistic: only when stored version equals lead.version - 1", async () => {
    const repo = new InMemoryLeadRepository();
    const lead = leadOf({ id: id(1) });
    await repo.insert("t-1", lead);
    const at = new Date("2026-11-23T00:00:00.000Z");
    const v1 = lead.withStatus("contacted", at);
    expect(await repo.updateStatus("t-1", v1)).toBe(true);
    expect((await repo.get("t-1", id(1)))?.props.status).toBe("contacted");
    // stale: built from the version-0 lead again
    expect(await repo.updateStatus("t-1", lead.withStatus("qualified", at))).toBe(false);
    expect((await repo.get("t-1", id(1)))?.props.status).toBe("contacted");
  });

  it("updateStatus is false for another tenant or an unknown id", async () => {
    const repo = new InMemoryLeadRepository();
    const lead = leadOf({ id: id(1) });
    await repo.insert("t-1", lead);
    const next = lead.withStatus("contacted", new Date());
    expect(await repo.updateStatus("t-2", next)).toBe(false);
    expect(await repo.updateStatus("t-1", leadOf({ id: id(5), version: 1 }))).toBe(false);
  });

  it("lists newest first (id descending), tenant-scoped, returning first+1 rows max", async () => {
    const repo = new InMemoryLeadRepository();
    for (const n of [2, 1, 3, 4]) await repo.insert("t-1", leadOf({ id: id(n) }));
    await repo.insert("t-2", leadOf({ id: id(9) }));
    const page = await repo.list("t-1", { first: 2 });
    expect(page.map((l) => l.props.id)).toEqual([id(4), id(3), id(2)]);
    const rest = await repo.list("t-1", { first: 2, after: id(3) });
    expect(rest.map((l) => l.props.id)).toEqual([id(2), id(1)]);
  });

  it("filters by status, search and createdAt range", async () => {
    const repo = new InMemoryLeadRepository();
    await repo.insert(
      "t-1",
      leadOf({ id: id(1), createdAt: new Date("2026-11-01T00:00:00.000Z") }),
    );
    await repo.insert(
      "t-1",
      leadOf({
        id: id(2),
        status: "spam",
        name: "Bot",
        email: null,
        createdAt: new Date("2026-11-10T00:00:00.000Z"),
      }),
    );
    await repo.insert(
      "t-1",
      leadOf({ id: id(3), createdAt: new Date("2026-11-20T00:00:00.000Z") }),
    );
    expect((await repo.list("t-1", { first: 10, status: "spam" })).map((l) => l.props.id)).toEqual([
      id(2),
    ]);
    expect((await repo.list("t-1", { first: 10, search: "bot" })).map((l) => l.props.id)).toEqual([
      id(2),
    ]);
    const ranged = await repo.list("t-1", {
      first: 10,
      createdFrom: new Date("2026-11-05T00:00:00.000Z"),
      createdTo: new Date("2026-11-15T00:00:00.000Z"),
    });
    expect(ranged.map((l) => l.props.id)).toEqual([id(2)]);
    const fromOnly = await repo.list("t-1", {
      first: 10,
      createdFrom: new Date("2026-11-15T00:00:00.000Z"),
    });
    expect(fromOnly.map((l) => l.props.id)).toEqual([id(3)]);
  });
});
