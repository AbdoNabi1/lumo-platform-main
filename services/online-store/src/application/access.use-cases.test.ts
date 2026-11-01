import { describe, expect, it } from "vitest";
import { harness } from "../testing/fakes";

const T = "t-1";

describe("access use cases", () => {
  it("never returns the password or its hash", async () => {
    const { controller } = harness();
    const res = await controller.updateAccess({
      tenantId: T,
      locked: true,
      password: "open sesame",
      message: { ar: "قريبًا" },
      expectedVersion: 0,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      locked: true,
      passwordSet: true,
      passwordUpdatedAt: "2026-10-27T10:00:00.000Z",
      message: { ar: "قريبًا" },
      version: 1,
    });
    const read = await controller.getAccess({ tenantId: T });
    expect(JSON.stringify(read.body)).not.toMatch(/sesame|hash:/);
  });

  it("refuses to lock with no password (PASSWORD_REQUIRED) and a 3-character password", async () => {
    const { controller, repos } = harness();
    const none = await controller.updateAccess({
      tenantId: T,
      locked: true,
      message: {},
      expectedVersion: 0,
    });
    expect(none.status).toBe(422);
    expect(none.body).toMatchObject({ code: "PASSWORD_REQUIRED" });
    const short = await controller.updateAccess({
      tenantId: T,
      locked: false,
      password: "abc",
      message: {},
      expectedVersion: 0,
    });
    expect(short.body).toMatchObject({
      code: "PASSWORD_LENGTH",
      fields: [{ field: "password", message: "PASSWORD_LENGTH" }],
    });
    expect((await repos.access.get(T)).snapshot().persisted).toBe(false);
  });

  it("a first-time lock with a blank password is PASSWORD_REQUIRED, writing nothing", async () => {
    const { controller, repos, recorded, hasher } = harness();
    const res = await controller.updateAccess({
      tenantId: T,
      locked: true,
      password: "   ",
      message: {},
      expectedVersion: 0,
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: "PASSWORD_REQUIRED",
      fields: [{ field: "password", message: "PASSWORD_REQUIRED" }],
    });
    expect((await repos.access.get(T)).snapshot().persisted).toBe(false);
    expect(hasher.hashedWithOpenUnitsOfWork).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("a stale version is VERSION_CONFLICT, writing nothing", async () => {
    const { controller, repos, recorded } = harness();
    await controller.updateAccess({
      tenantId: T,
      locked: false,
      password: "1234",
      message: {},
      expectedVersion: 0,
    });
    const stale = await controller.updateAccess({
      tenantId: T,
      locked: true,
      message: {},
      expectedVersion: 0,
    });
    expect(stale.body).toMatchObject({ code: "VERSION_CONFLICT" });
    expect((await repos.access.get(T)).snapshot()).toMatchObject({
      locked: false,
      accessVersion: 2,
      version: 1,
    });
    expect(recorded).toHaveLength(1);
  });

  it("the public read carries locked, accessVersion and the visitor message only", async () => {
    const { controller } = harness();
    await controller.updateAccess({
      tenantId: T,
      locked: true,
      password: "1234",
      message: { en: "Soon" },
      expectedVersion: 0,
    });
    expect(await controller.publicAccess({ tenantId: T })).toEqual({
      status: 200,
      // One save that sets a password AND locks bumps the access version once (1 → 2).
      body: { locked: true, accessVersion: 2, message: { en: "Soon" } },
    });
  });

  it("unlock: right password → accessVersion; wrong, unlocked or never set → the same 401", async () => {
    const { controller, hasher } = harness();
    const neverSet = await controller.unlock({ tenantId: T, password: "1234" });
    expect(neverSet).toEqual({
      status: 401,
      body: {
        code: "PASSWORD_INCORRECT",
        message: "Incorrect password",
        retryable: false,
        fields: [],
      },
    });
    expect(hasher.verified).toHaveLength(1); // the dummy hash was verified: equal cost
    await controller.updateAccess({
      tenantId: T,
      locked: false,
      password: "1234",
      message: {},
      expectedVersion: 0,
    });
    expect((await controller.unlock({ tenantId: T, password: "1234" })).body).toEqual(
      neverSet.body,
    );
    await controller.updateAccess({ tenantId: T, locked: true, message: {}, expectedVersion: 1 });
    expect((await controller.unlock({ tenantId: T, password: "nope" })).body).toEqual(
      neverSet.body,
    );
    expect(await controller.unlock({ tenantId: T, password: " 1234 " })).toEqual({
      status: 200,
      body: { accessVersion: 3 },
    });
    expect(hasher.verified).toHaveLength(4);
  });

  it("trims the submitted password exactly as the saved one was trimmed", async () => {
    const { controller } = harness();
    await controller.updateAccess({
      tenantId: T,
      locked: true,
      password: "  open sesame  ",
      message: {},
      expectedVersion: 0,
    });
    for (const attempt of ["open sesame", "  open sesame", "open sesame\t\n"]) {
      const res = await controller.unlock({ tenantId: T, password: attempt });
      expect(res).toEqual({ status: 200, body: { accessVersion: 2 } });
    }
    const inner = await controller.unlock({ tenantId: T, password: "opensesame" });
    expect(inner.status).toBe(401);
  });

  it("the right password on an unlocked store still costs a real verify, and is refused", async () => {
    const { controller, hasher } = harness();
    await controller.updateAccess({
      tenantId: T,
      locked: false,
      password: "1234",
      message: {},
      expectedVersion: 0,
    });
    expect((await controller.unlock({ tenantId: T, password: "1234" })).status).toBe(401);
    expect(hasher.verified).toEqual(["hash:1234"]);
  });

  it("mints the dummy hash once, and never from the submitted password", async () => {
    const { controller, hasher } = harness();
    await controller.unlock({ tenantId: T, password: "first" });
    await controller.unlock({ tenantId: T, password: "second" });
    expect(hasher.verified).toHaveLength(2);
    expect(new Set(hasher.verified).size).toBe(1);
    expect(hasher.verified[0]).not.toMatch(/first|second/);
    expect(hasher.hashedWithOpenUnitsOfWork).toHaveLength(1);
  });

  it("mints no dummy hash when the shop has a password", async () => {
    const { controller, hasher } = harness();
    await controller.updateAccess({
      tenantId: T,
      locked: true,
      password: "1234",
      message: {},
      expectedVersion: 0,
    });
    await controller.unlock({ tenantId: T, password: "1234" });
    await controller.unlock({ tenantId: T, password: "nope" });
    expect(hasher.hashedWithOpenUnitsOfWork).toHaveLength(1); // only the saved password
    expect(hasher.verified).toEqual(["hash:1234", "hash:1234"]);
  });

  it("keeps the password when it is omitted, null or blank", async () => {
    const { controller, repos } = harness();
    await controller.updateAccess({
      tenantId: T,
      locked: true,
      password: "1234",
      message: {},
      expectedVersion: 0,
    });
    const blank = await controller.updateAccess({
      tenantId: T,
      locked: true,
      password: "   ",
      message: {},
      expectedVersion: 1,
    });
    expect(blank.status).toBe(200);
    const kept = await controller.updateAccess({
      tenantId: T,
      locked: true,
      password: null,
      message: {},
      expectedVersion: 2,
    });
    expect(kept.body).toMatchObject({ passwordSet: true, version: 3 });
    expect((await repos.access.get(T)).snapshot()).toMatchObject({
      passwordHash: "hash:1234",
      accessVersion: 2,
    });
  });

  it("records the access event once per save", async () => {
    const { controller, recorded } = harness();
    await controller.updateAccess({
      tenantId: T,
      locked: true,
      password: "1234",
      message: {},
      expectedVersion: 0,
    });
    expect(recorded).toEqual([{ tenantId: T, type: "online_store.access.changed" }]);
  });

  it("refuses an over-long visitor message before hashing or writing", async () => {
    const { controller, repos, hasher } = harness();
    const res = await controller.updateAccess({
      tenantId: T,
      locked: false,
      password: "1234",
      message: { en: "x".repeat(501) },
      expectedVersion: 0,
    });
    expect(res.body).toMatchObject({ fields: [{ field: "message.en", message: "TOO_LONG" }] });
    expect(hasher.hashedWithOpenUnitsOfWork).toEqual([]);
    expect((await repos.access.get(T)).snapshot().persisted).toBe(false);
  });

  it("hashes before the transaction opens (Ruling 10)", async () => {
    const { controller, hasher } = harness();
    await controller.updateAccess({
      tenantId: T,
      locked: false,
      password: "1234",
      message: {},
      expectedVersion: 0,
    });
    expect(hasher.hashedWithOpenUnitsOfWork).toEqual([0]);
  });
});
