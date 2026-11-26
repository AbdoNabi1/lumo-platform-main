import { beforeEach, describe, expect, it } from "vitest";
import type { AccessControl, Clock, Permission, Principal } from "@platform/contracts";
import { RoleTableAccessControl } from "@platform/auth";
import type { SecurityController } from "@platform/security";
import {
  LiveStaffAccessControl,
  securityStaffAccessReader,
  type StaffAccessReader,
  type StaffAccessSnapshot,
} from "./live-staff-access-control";

const T0 = new Date("2026-11-24T10:00:00.000Z").getTime();

class FakeClock implements Clock {
  private ms = T0;
  now(): Date {
    return new Date(this.ms);
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

class FakeReader implements StaffAccessReader {
  readonly reads: string[] = [];
  readonly snapshots = new Map<string, StaffAccessSnapshot | null>();
  failWith: Error | null = null;
  read(tenantId: string, principalExternalId: string): Promise<StaffAccessSnapshot | null> {
    this.reads.push(`${tenantId}/${principalExternalId}`);
    if (this.failWith !== null) return Promise.reject(this.failWith);
    return Promise.resolve(this.snapshots.get(`${tenantId}/${principalExternalId}`) ?? null);
  }
}

class RecordingInner implements AccessControl {
  readonly calls: { principal: Principal; permission: Permission }[] = [];
  constructor(private readonly answer: boolean) {}
  authorize(principal: Principal, permission: Permission): Promise<boolean> {
    this.calls.push({ principal, permission });
    return Promise.resolve(this.answer);
  }
}

const staff = (roles: string[], id = "m-1", tenantId = "t-1"): Principal => ({
  id,
  kind: "staff",
  roles,
  tenantId,
});

const active = (roles: string[], roleKeys: string[] = roles): StaffAccessSnapshot => ({
  active: true,
  roles,
  roleKeys,
});

let clock: FakeClock;
let reader: FakeReader;

beforeEach(() => {
  expect.hasAssertions();
  clock = new FakeClock();
  reader = new FakeReader();
});

function live(inner: AccessControl, options: { ttlMs?: number; maxEntries?: number } = {}) {
  return new LiveStaffAccessControl({ inner, reader, clock, ...options });
}

describe("LiveStaffAccessControl", () => {
  it("leaves customer and service principals completely untouched (inner answer, no read)", async () => {
    const inner = new RecordingInner(true);
    const control = live(inner);
    for (const kind of ["customer", "service"] as const) {
      const principal: Principal = { id: "x", kind, roles: [], tenantId: "t-1" };
      expect(await control.authorize(principal, "orders:read")).toBe(true);
      expect(await control.authorize(principal, "security:read_session")).toBe(true);
    }
    expect(reader.reads).toEqual([]);
    expect(inner.calls).toHaveLength(4);
    const denying = live(new RecordingInner(false));
    expect(
      await denying.authorize({ id: "c", kind: "customer", roles: [], tenantId: "t" }, "a:b"),
    ).toBe(false);
  });

  it("denies a staff principal the reader does not know (404 -> null)", async () => {
    const inner = new RecordingInner(true);
    expect(await live(inner).authorize(staff(["admin"]), "orders:read")).toBe(false);
    expect(inner.calls).toEqual([]);
  });

  it("denies a suspended or disabled member and never asks the inner control", async () => {
    reader.snapshots.set("t-1/m-1", { active: false, roles: ["admin"], roleKeys: ["admin"] });
    const inner = new RecordingInner(true);
    expect(await live(inner).authorize(staff(["admin"]), "orders:read")).toBe(false);
    expect(inner.calls).toEqual([]);
  });

  it("an active member is decided by the inner control with the token roles", async () => {
    reader.snapshots.set("t-1/m-1", active(["operator"]));
    const inner = new RecordingInner(true);
    expect(await live(inner).authorize(staff(["operator"]), "orders:read")).toBe(true);
    expect(inner.calls[0]?.principal.roles).toEqual(["operator"]);
  });

  it("a role removed after the token was issued is denied after invalidate, with the same instance", async () => {
    reader.snapshots.set("t-1/m-1", active(["operator"]));
    const control = live(new RoleTableAccessControl());
    expect(await control.authorize(staff(["operator"]), "orders:update")).toBe(true);
    reader.snapshots.set("t-1/m-1", active(["viewer"]));
    // Still the cached snapshot until invalidated.
    expect(await control.authorize(staff(["operator"]), "orders:update")).toBe(true);
    control.invalidate("t-1", "m-1");
    expect(await control.authorize(staff(["operator"]), "orders:update")).toBe(false);
    expect(await control.authorize(staff(["operator"]), "orders:read")).toBe(false);
  });

  it("without invalidate the change is seen once the 30 s TTL has passed (fake clock)", async () => {
    reader.snapshots.set("t-1/m-1", active(["operator"]));
    const control = live(new RoleTableAccessControl());
    expect(await control.authorize(staff(["operator"]), "orders:update")).toBe(true);
    reader.snapshots.set("t-1/m-1", active(["viewer"]));
    clock.advance(29_999);
    expect(await control.authorize(staff(["operator"]), "orders:update")).toBe(true);
    expect(reader.reads).toHaveLength(1);
    clock.advance(2);
    expect(await control.authorize(staff(["operator"]), "orders:update")).toBe(false);
    expect(reader.reads).toHaveLength(2);
  });

  it("a deactivated member is denied after invalidate", async () => {
    reader.snapshots.set("t-1/m-1", active(["admin"]));
    const control = live(new RoleTableAccessControl());
    expect(await control.authorize(staff(["admin"]), "customers:read")).toBe(true);
    reader.snapshots.set("t-1/m-1", { active: false, roles: ["admin"], roleKeys: ["admin"] });
    control.invalidate("t-1", "m-1");
    expect(await control.authorize(staff(["admin"]), "customers:read")).toBe(false);
  });

  it("token roles are never widened: snapshot admin, token viewer -> still viewer", async () => {
    reader.snapshots.set("t-1/m-1", active(["admin"]));
    const inner = new RecordingInner(true);
    const control = live(inner);
    await control.authorize(staff(["viewer"]), "orders:read");
    expect(inner.calls[0]?.principal.roles).toEqual([]);
    const real = live(new RoleTableAccessControl());
    expect(await real.authorize(staff(["viewer"]), "orders:update")).toBe(false);
  });

  it("a token role the snapshot no longer holds is dropped (token admin, snapshot viewer)", async () => {
    reader.snapshots.set("t-1/m-1", active(["viewer"]));
    const real = live(new RoleTableAccessControl());
    expect(await real.authorize(staff(["admin"]), "orders:update")).toBe(false);
    expect(await real.authorize(staff(["admin"]), "orders:read")).toBe(false);
  });

  it("fails closed when the reader throws, does not cache the failure and retries next call", async () => {
    reader.snapshots.set("t-1/m-1", active(["admin"]));
    const control = live(new RoleTableAccessControl());
    reader.failWith = new Error("db down");
    expect(await control.authorize(staff(["admin"]), "orders:read")).toBe(false);
    reader.failWith = null;
    expect(await control.authorize(staff(["admin"]), "orders:read")).toBe(true);
    expect(reader.reads).toHaveLength(2);
  });

  it("caches per (tenant, member): another tenant's same id is read separately", async () => {
    reader.snapshots.set("t-1/m-1", active(["admin"]));
    const control = live(new RoleTableAccessControl());
    expect(await control.authorize(staff(["admin"], "m-1", "t-1"), "orders:read")).toBe(true);
    expect(await control.authorize(staff(["admin"], "m-1", "t-2"), "orders:read")).toBe(false);
    expect(reader.reads).toEqual(["t-1/m-1", "t-2/m-1"]);
  });

  it("evicts the oldest entry beyond the cap", async () => {
    for (const id of ["a", "b", "c"]) reader.snapshots.set(`t-1/${id}`, active(["admin"]));
    const control = live(new RoleTableAccessControl(), { maxEntries: 2 });
    for (const id of ["a", "b", "c"]) await control.authorize(staff(["admin"], id), "orders:read");
    expect(reader.reads).toHaveLength(3);
    await control.authorize(staff(["admin"], "c"), "orders:read");
    await control.authorize(staff(["admin"], "b"), "orders:read");
    expect(reader.reads).toHaveLength(3);
    await control.authorize(staff(["admin"], "a"), "orders:read");
    expect(reader.reads).toHaveLength(4);
  });

  it("an invalidate that lands while a read is in flight is not overwritten by the stale read", async () => {
    const releases: ((s: StaffAccessSnapshot) => void)[] = [];
    let reads = 0;
    const slow: StaffAccessReader = {
      read: () => {
        reads += 1;
        return new Promise<StaffAccessSnapshot>((resolve) => releases.push(resolve));
      },
    };
    const control = new LiveStaffAccessControl({
      inner: new RoleTableAccessControl(),
      reader: slow,
      clock,
    });
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const first = control.authorize(staff(["admin"]), "orders:read");
    await tick();
    control.invalidate("t-1", "m-1");
    releases[0]?.(active(["admin"]));
    expect(await first).toBe(true);
    const second = control.authorize(staff(["admin"]), "orders:read");
    await tick();
    releases[1]?.(active(["admin"]));
    expect(await second).toBe(true);
    expect(reads).toBe(2);
  });
});

describe("owner-only resources (R5)", () => {
  const OWNER_ONLY: Permission[] = [
    "security:assign_role",
    "security:revoke_role_assignment",
    "security:transition_principal",
    "security:register_principal",
    "users:create",
    "users:deactivate",
    "memberships:create",
    "organizations:create",
  ];

  it("an admin without platform-admin is denied every owner-only resource but not the rest", async () => {
    reader.snapshots.set("t-1/m-1", active(["admin"], ["admin"]));
    const control = live(new RoleTableAccessControl());
    for (const permission of OWNER_ONLY) {
      expect(await control.authorize(staff(["admin"]), permission)).toBe(false);
    }
    expect(await control.authorize(staff(["admin"]), "orders:update")).toBe(true);
    expect(await control.authorize(staff(["admin"]), "staff:invite")).toBe(true);
  });

  it("the Wave 1e staff:* policy and activity permissions are NOT owner-only: an invited admin passes, operator and viewer do not", async () => {
    reader.snapshots.set("t-1/m-1", active(["admin"], ["admin"]));
    reader.snapshots.set("t-1/op", active(["operator"]));
    reader.snapshots.set("t-1/vw", active(["viewer"]));
    const control = live(new RoleTableAccessControl());
    for (const permission of [
      "staff:read_policy",
      "staff:set_policy",
      "staff:read_activity",
      "staff:reset_two_step",
    ]) {
      expect([permission, await control.authorize(staff(["admin"]), permission)]).toEqual([
        permission,
        true,
      ]);
      expect([permission, await control.authorize(staff(["operator"], "op"), permission)]).toEqual([
        permission,
        false,
      ]);
      expect([permission, await control.authorize(staff(["viewer"], "vw"), permission)]).toEqual([
        permission,
        false,
      ]);
    }
    // Self-service two-step is `account:update_self`, held by every active member.
    for (const [id, role] of [
      ["m-1", "admin"],
      ["op", "operator"],
      ["vw", "viewer"],
    ] as const) {
      expect(await control.authorize(staff([role], id), "account:update_self")).toBe(true);
    }
  });

  it("the owner (platform-admin) keeps today's behaviour on the same resources", async () => {
    reader.snapshots.set("t-1/o-1", active(["admin"], ["platform-admin"]));
    const control = live(new RoleTableAccessControl());
    for (const permission of OWNER_ONLY) {
      expect(await control.authorize(staff(["admin"], "o-1"), permission)).toBe(true);
    }
  });

  it("operator and viewer stay denied as before", async () => {
    reader.snapshots.set("t-1/op", active(["operator"]));
    reader.snapshots.set("t-1/vw", active(["viewer"]));
    const control = live(new RoleTableAccessControl());
    for (const permission of OWNER_ONLY) {
      expect(await control.authorize(staff(["operator"], "op"), permission)).toBe(false);
      expect(await control.authorize(staff(["viewer"], "vw"), permission)).toBe(false);
    }
  });

  it("security:authenticate is exempt from the owner-only rule (O4)", async () => {
    reader.snapshots.set("t-1/m-1", active(["admin"], ["admin"]));
    const control = live(new RoleTableAccessControl());
    expect(await control.authorize(staff(["admin"]), "security:authenticate")).toBe(true);
  });

  it("does not treat a resource that merely starts with the same letters as owner-only", async () => {
    reader.snapshots.set("t-1/m-1", active(["admin"], ["admin"]));
    const control = live(new RoleTableAccessControl());
    expect(await control.authorize(staff(["admin"]), "securityx:read")).toBe(true);
    expect(await control.authorize(staff(["admin"]), "user:read")).toBe(true);
  });
});

describe("securityStaffAccessReader (O1)", () => {
  const security = (answer: { status: number; body: unknown } | Error) =>
    ({
      staffAccess: () =>
        answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
    }) as unknown as SecurityController;

  it("404 -> null", async () => {
    const r = securityStaffAccessReader(security({ status: 404, body: {} }));
    expect(await r.read("t", "p")).toBeNull();
  });

  it("active -> active:true with roleKeys mapped through TOKEN_ROLE and kept raw", async () => {
    const r = securityStaffAccessReader(
      security({
        status: 200,
        body: { status: "active", roleKeys: ["platform-admin", "viewer", "weird"] },
      }),
    );
    expect(await r.read("t", "p")).toEqual({
      active: true,
      roles: ["admin", "viewer"],
      roleKeys: ["platform-admin", "viewer", "weird"],
    });
  });

  it("suspended and disabled -> active:false", async () => {
    for (const status of ["suspended", "disabled"]) {
      const r = securityStaffAccessReader(
        security({ status: 200, body: { status, roleKeys: ["admin"] } }),
      );
      expect((await r.read("t", "p"))?.active).toBe(false);
    }
  });

  it("any other status or a rejection throws (the control fails closed)", async () => {
    await expect(
      securityStaffAccessReader(security({ status: 500, body: {} })).read("t", "p"),
    ).rejects.toThrow();
    await expect(
      securityStaffAccessReader(security(new Error("x"))).read("t", "p"),
    ).rejects.toThrow();
  });
});
