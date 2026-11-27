import type { Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import { InMemoryTotpMfaProvider } from "../infrastructure/in-memory-auth-adapters";
import { buildStaffKit, type StaffKit } from "../infrastructure/staff-test-kit";
import { VerifyMfaLogin } from "./mfa-login.use-cases";
import {
  ConfirmOwnTwoStep,
  DisableOwnTwoStep,
  RegenerateOwnBackupCodes,
  StartOwnTwoStep,
} from "./own-mfa.use-cases";
import { ListStaffActivity, type StaffActivityItem } from "./staff-activity.use-cases";
import {
  AcceptStaffInvitation,
  ChangeStaffRole,
  CreateStaffInvitation,
  RevokeStaffInvitation,
  SetStaffActive,
} from "./staff-commands.use-cases";
import { SetRequireTwoStep } from "./staff-policy.use-cases";

const T = "shop-a";
const OTHER = "shop-b";
const hash = (c: string): string => c.repeat(64);
const iso = (n: number): string =>
  new Date(Date.UTC(2026, 10, 27, 10, 0, 0) + n * 1000).toISOString();

function failure<V>(result: Result<V, DomainError>): DomainError {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.value)}`);
  return result.error;
}
function value<V>(result: Result<V, DomainError>): V {
  if (!result.ok)
    throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

interface Row {
  readonly action: string;
  readonly principalRef: string;
  /** Seconds after the epoch of the test; rows are inserted with this occurredAt (not the clock). */
  readonly at: number;
  readonly tenantRef?: string | null;
  readonly decision?: string;
  readonly metadata?: Record<string, string>;
  readonly tenant?: string;
}

/** Appends a ledger row at an explicit time into the chain scope `tenantRef` (null = platform chain). */
async function addRow(kit: StaffKit, row: Row): Promise<string> {
  const tenantId = row.tenant ?? T;
  const tenantRef = row.tenantRef === undefined ? null : row.tenantRef;
  const tail = await kit.deps.auditLedger.tail(tenantRef, tenantId);
  const record = kit.deps.auditChain.append(tail, {
    id: kit.deps.idGenerator.generate(),
    principalRef: row.principalRef,
    action: row.action,
    decision: row.decision ?? "allow",
    tenantRef,
    occurredAt: iso(row.at),
    ...(row.metadata === undefined ? {} : { metadata: row.metadata }),
  });
  await kit.deps.auditLedger.append(record, tenantId);
  return record.id;
}

async function setup() {
  const kit = buildStaffKit();
  const sam = await kit.seedStaff(T, {
    externalId: "p-sam",
    email: "sam@x.com",
    roles: ["platform-admin"],
  });
  const mona = await kit.seedStaff(T, {
    externalId: "p-mona",
    email: "mona@x.com",
    roles: ["viewer"],
  });
  return { kit, sam, mona };
}

const list = (
  kit: StaffKit,
  input: { tenant?: string; member?: string; cursor?: string; limit?: number } = {},
) =>
  new ListStaffActivity(kit.deps).execute({
    tenantId: input.tenant ?? T,
    ...(input.member === undefined ? {} : { memberExternalId: input.member }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
const cursorOf = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

describe("ListStaffActivity — reading the ledger", () => {
  it("returns rows of EVERY scope of the tenant newest first, with emails; tenant B rows never", async () => {
    const { kit } = await setup();
    // null-scope staff rows (1d commands), tenantRef-scoped auth rows (Authenticate), a bootstrap-owner row in the platform chain
    await addRow(kit, {
      action: "security.staff.role_changed",
      principalRef: "p-mona",
      at: 10,
      metadata: { actor: "p-sam", target: "p-mona", from: "operator", to: "viewer" },
    });
    await addRow(kit, {
      action: "security.auth.succeeded",
      principalRef: "p-mona",
      at: 30,
      tenantRef: T,
      metadata: { method: "password", risk: "low", mfa: "none" },
    });
    await addRow(kit, {
      action: "security.auth.succeeded",
      principalRef: "p-sam",
      at: 20,
      tenantRef: null,
      metadata: { method: "password", risk: "low", mfa: "optional" },
    });
    await addRow(kit, {
      action: "security.mfa.enabled",
      principalRef: "p-sam",
      at: 25,
      tenantRef: "some-other-scope",
      metadata: { actor: "p-sam", target: "p-sam", method: "totp" },
    });
    await addRow(kit, {
      action: "security.mfa.enabled",
      principalRef: "p-sam",
      at: 99,
      tenant: OTHER,
      tenantRef: OTHER,
      metadata: {},
    });

    const out = value(await list(kit));
    expect(out.nextCursor).toBeNull();
    expect(out.items.map((i) => [i.at, i.kind, i.subjectEmail])).toEqual([
      [iso(30), "signed_in", "mona@x.com"],
      [iso(25), "two_step_on", "sam@x.com"],
      [iso(20), "signed_in", "sam@x.com"],
      [iso(10), "role_changed", "mona@x.com"],
    ]);
    expect(out.items[3]).toMatchObject({
      actorEmail: "sam@x.com",
      detail: { from: "operator", to: "viewer" },
    });
    // tenant B sees only its own
    expect(value(await list(kit, { tenant: OTHER })).items).toHaveLength(1);
    expect(value(await list(kit, { tenant: "shop-c" })).items).toEqual([]);
  });

  it("an item carries exactly id, at, kind, actorEmail, subjectEmail, detail — no raw metadata, hash or sequence", async () => {
    const { kit } = await setup();
    const id = await addRow(kit, {
      action: "security.staff.role_changed",
      principalRef: "p-mona",
      at: 1,
      metadata: { actor: "p-sam", target: "p-mona", from: "viewer", to: "admin", secret: "x" },
    });
    const [item] = value(await list(kit)).items;
    expect(item?.id).toBe(id);
    expect(Object.keys(item!).sort()).toEqual([
      "actorEmail",
      "at",
      "detail",
      "id",
      "kind",
      "subjectEmail",
    ]);
    expect(JSON.stringify(item)).not.toContain("secret");
  });

  it("maps every allow-listed action to its kind and detail", async () => {
    const { kit } = await setup();
    const rows: Array<
      [string, string, Record<string, string>, string, StaffActivityItem["detail"]]
    > = [
      [
        "security.mfa.login_verified",
        "p-mona",
        { actor: "p-mona", target: "p-mona", method: "totp" },
        "signed_in",
        {},
      ],
      ["security.auth.succeeded", "p-mona", { mfa: "optional" }, "signed_in", {}],
      ["security.auth.failed", "staff:mona@x.com", { reason: "x" }, "sign_in_failed", {}],
      [
        "security.mfa.login_failed",
        "p-mona",
        { actor: "p-mona", target: "p-mona" },
        "code_failed",
        {},
      ],
      [
        "security.staff.invited",
        "p-mona",
        { actor: "p-sam", target: "p-mona", role: "viewer", invitationId: "i-1" },
        "invited",
        { to: "viewer" },
      ],
      [
        "security.staff.invitation_accepted",
        "p-mona",
        { actor: "invitee", target: "p-mona" },
        "invitation_accepted",
        {},
      ],
      [
        "security.staff.invitation_revoked",
        "p-mona",
        { actor: "p-sam", target: "p-mona" },
        "invitation_revoked",
        {},
      ],
      [
        "security.staff.role_changed",
        "p-mona",
        { actor: "p-sam", target: "p-mona", from: "viewer", to: "admin" },
        "role_changed",
        { from: "viewer", to: "admin" },
      ],
      [
        "security.staff.deactivated",
        "p-mona",
        { actor: "p-sam", target: "p-mona" },
        "deactivated",
        {},
      ],
      [
        "security.staff.reactivated",
        "p-mona",
        { actor: "p-sam", target: "p-mona" },
        "reactivated",
        {},
      ],
      ["security.mfa.enabled", "p-mona", { actor: "p-mona", target: "p-mona" }, "two_step_on", {}],
      [
        "security.mfa.disabled",
        "p-mona",
        { actor: "p-mona", target: "p-mona" },
        "two_step_off",
        {},
      ],
      [
        "security.mfa.backup_codes_regenerated",
        "p-mona",
        { actor: "p-mona", target: "p-mona", count: "10" },
        "backup_codes_regenerated",
        {},
      ],
      [
        "security.staff.two_step_policy_changed",
        "p-sam",
        { actor: "p-sam", target: "p-sam", enabled: "true" },
        "two_step_policy_changed",
        { enabled: true },
      ],
      [
        "security.staff.two_step_policy_changed",
        "p-sam",
        { actor: "p-sam", target: "p-sam", enabled: "false" },
        "two_step_policy_changed",
        { enabled: false },
      ],
    ];
    let at = 0;
    for (const [action, principalRef, metadata] of rows)
      await addRow(kit, { action, principalRef, metadata, at: (at += 1) });
    const items = value(await list(kit, { limit: 50 }))
      .items.slice()
      .reverse();
    expect(items.map((i) => i.kind)).toEqual(rows.map((r) => r[3]));
    expect(items.map((i) => i.detail)).toEqual(rows.map((r) => r[4]));
    // actors: self-events are their own actor; staff.* use metadata.actor; "invitee" = the subject
    expect(items[0]?.actorEmail).toBe("mona@x.com");
    expect(items[2]?.subjectEmail).toBe("mona@x.com"); // staff:<email> → email
    expect(items[4]?.actorEmail).toBe("sam@x.com");
    expect(items[5]?.actorEmail).toBe("mona@x.com");
    expect(items[13]).toMatchObject({ actorEmail: "sam@x.com", subjectEmail: "sam@x.com" });
  });

  it("skips: waiting-for-code sign-ins, customers' sign-ins and failures, non-staff identifiers, actions off the list", async () => {
    const { kit } = await setup();
    await addRow(kit, {
      action: "security.auth.succeeded",
      principalRef: "p-mona",
      at: 1,
      tenantRef: T,
      metadata: { mfa: "required" },
    });
    await addRow(kit, {
      action: "security.auth.succeeded",
      principalRef: "customer-42",
      at: 2,
      tenantRef: null,
      metadata: { mfa: "none" },
    });
    await addRow(kit, {
      action: "security.auth.failed",
      principalRef: "customer:buyer@x.com",
      at: 3,
      decision: "deny",
    });
    await addRow(kit, {
      action: "security.auth.failed",
      principalRef: "merchant:owner@x.com",
      at: 4,
      decision: "deny",
    });
    await addRow(kit, { action: "security.session.established", principalRef: "p-mona", at: 5 });
    await addRow(kit, {
      action: "security.staff.invitation_renewed",
      principalRef: "p-mona",
      at: 6,
    });
    await addRow(kit, { action: "security.role.defined", principalRef: "system", at: 7 });
    await addRow(kit, { action: "security.mfa.verified", principalRef: "p-mona", at: 8 });
    // visible: a failed staff sign-in for an unknown email, and a passed one with mfa not required
    await addRow(kit, {
      action: "security.auth.failed",
      principalRef: "staff:ghost@x.com",
      at: 9,
      decision: "deny",
    });
    await addRow(kit, {
      action: "security.auth.succeeded",
      principalRef: "p-mona",
      at: 10,
      tenantRef: T,
      metadata: { mfa: "none" },
    });

    const out = value(await list(kit));
    expect(out.items.map((i) => [i.kind, i.subjectEmail])).toEqual([
      ["signed_in", "mona@x.com"],
      ["sign_in_failed", "ghost@x.com"],
    ]);
  });

  it("resolves emails: internal id → externalId → email; unknown principal → null; revoked invitee → the invitation's email", async () => {
    const { kit, mona } = await setup();
    await addRow(kit, {
      action: "security.mfa.enabled",
      principalRef: mona, // internal uuid (legacy refs)
      at: 1,
      metadata: {},
    });
    await addRow(kit, {
      action: "security.staff.role_changed",
      principalRef: "p-stranger",
      at: 2,
      metadata: { actor: "p-sam", target: "p-stranger", from: "viewer", to: "admin" },
    });
    const invited = value(
      await new CreateStaffInvitation(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-sam",
        principalExternalId: "p-new",
        email: "new@x.com",
        role: "viewer",
        tokenHash: hash("a"),
        now: kit.clock.now(),
      }),
    );
    value(
      await new RevokeStaffInvitation(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-sam",
        invitationId: invited.invitationId,
        expectedVersion: 1,
        now: kit.clock.now(),
      }),
    );
    const out = value(await list(kit)).items;
    const byKind = Object.fromEntries(out.map((i) => [i.kind, i]));
    expect(byKind["two_step_on"]).toMatchObject({
      subjectEmail: "mona@x.com",
      actorEmail: "mona@x.com",
    });
    expect(byKind["role_changed"]).toMatchObject({ subjectEmail: null, actorEmail: "sam@x.com" });
    // the revoked invitee's principal is disabled (not staff any more): email comes from the invitation
    expect(byKind["invitation_revoked"]).toMatchObject({
      subjectEmail: "new@x.com",
      actorEmail: "sam@x.com",
    });
    expect(byKind["invited"]).toMatchObject({
      subjectEmail: "new@x.com",
      detail: { to: "viewer" },
    });
  });
});

describe("ListStaffActivity — paging", () => {
  async function seed(kit: StaffKit, count: number, scopes: Array<string | null> = [null, T]) {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      ids.push(
        await addRow(kit, {
          action: "security.mfa.login_failed",
          principalRef: "p-mona",
          at: i,
          tenantRef: scopes[i % scopes.length] ?? null,
          decision: "deny",
          metadata: { actor: "p-mona", target: "p-mona" },
        }),
      );
    }
    return ids;
  }

  it("default page 25, next page via cursor with no overlap, last page ends with null; across scopes", async () => {
    const { kit } = await setup();
    const ids = await seed(kit, 60);
    const page1 = value(await list(kit));
    expect(page1.items).toHaveLength(25);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = value(await list(kit, { cursor: page1.nextCursor! }));
    expect(page2.items).toHaveLength(25);
    const page3 = value(await list(kit, { cursor: page2.nextCursor! }));
    expect(page3.items).toHaveLength(10);
    expect(page3.nextCursor).toBeNull();
    const all = [...page1.items, ...page2.items, ...page3.items].map((i) => i.id);
    expect(new Set(all).size).toBe(60);
    expect(all).toEqual([...ids].reverse());
  });

  it("an exactly full last page has a null cursor (no phantom empty page)", async () => {
    const { kit } = await setup();
    await seed(kit, 25);
    expect(value(await list(kit))).toMatchObject({ nextCursor: null });
    expect(value(await list(kit)).items).toHaveLength(25);
  });

  it("rows with the same occurredAt page stably by id descending", async () => {
    const { kit } = await setup();
    for (let i = 0; i < 7; i += 1)
      await addRow(kit, {
        action: "security.mfa.login_failed",
        principalRef: "p-mona",
        at: 5,
        metadata: {},
      });
    const a = value(await list(kit, { limit: 3 }));
    const b = value(await list(kit, { limit: 3, cursor: a.nextCursor! }));
    const c = value(await list(kit, { limit: 3, cursor: b.nextCursor! }));
    const ids = [...a.items, ...b.items, ...c.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(7);
    expect(ids).toEqual([...ids].sort().reverse());
    expect(c.nextCursor).toBeNull();
  });

  it("limit 1..50; default 25; anything else is a validation error on `limit`", async () => {
    const { kit } = await setup();
    await seed(kit, 60);
    expect(value(await list(kit, { limit: 1 })).items).toHaveLength(1);
    expect(value(await list(kit, { limit: 50 })).items).toHaveLength(50);
    for (const limit of [0, 51, -1, 1.5, Number.NaN]) {
      const error = failure(await list(kit, { limit }));
      expect(error.code).toBe("VALIDATION");
      expect((error as { fields?: Array<{ field: string }> }).fields?.[0]?.field).toBe("limit");
    }
  });

  it("a malformed cursor is a validation error on `cursor`", async () => {
    const { kit } = await setup();
    const bad = [
      "",
      "not base64 !!",
      "a".repeat(600),
      Buffer.from("not json").toString("base64url"),
      cursorOf("a string"),
      cursorOf(null),
      cursorOf({ occurredAt: iso(1) }),
      cursorOf({ id: "x" }),
      cursorOf({ occurredAt: 5, id: "x" }),
      cursorOf({ occurredAt: "yesterday", id: "x" }),
      cursorOf({ occurredAt: iso(1), id: "" }),
    ];
    for (const cursor of bad) {
      const error = failure(await list(kit, { cursor }));
      expect(error.code).toBe("VALIDATION");
      expect((error as { fields?: Array<{ field: string }> }).fields?.[0]?.field).toBe("cursor");
    }
  });

  it("skipped rows do not eat the page: customers' sign-ins are stepped over", async () => {
    const { kit } = await setup();
    await seed(kit, 30); // staff rows, older
    for (let i = 0; i < 150; i += 1)
      await addRow(kit, {
        action: "security.auth.succeeded",
        principalRef: `customer-${i}`,
        at: 1000 + i,
        tenantRef: T,
        metadata: { mfa: "none" },
      });
    const page = value(await list(kit));
    expect(page.items).toHaveLength(25);
    expect(page.items.every((i) => i.kind === "code_failed")).toBe(true);
    expect(page.nextCursor).not.toBeNull();
    const rest = value(await list(kit, { cursor: page.nextCursor! }));
    expect(rest.items).toHaveLength(5);
    expect(rest.nextCursor).toBeNull();
  });

  it("when the scan limit is hit the cursor still makes progress (a short page, never a stuck one)", async () => {
    const { kit } = await setup();
    await seed(kit, 1); // the only visible row, the oldest
    for (let i = 0; i < 2100; i += 1)
      await addRow(kit, {
        action: "security.auth.succeeded",
        principalRef: "customer-1",
        at: 1000 + i,
        tenantRef: T,
        metadata: { mfa: "none" },
      });
    const first = value(await list(kit));
    expect(first.items).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    const second = value(await list(kit, { cursor: first.nextCursor! }));
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });
});

describe("ListStaffActivity — member filter", () => {
  it("keeps rows of the member under every ref form (externalId, internal id, staff:<email>) and nothing else", async () => {
    const { kit, mona } = await setup();
    await addRow(kit, {
      action: "security.mfa.enabled",
      principalRef: "p-mona",
      at: 1,
      metadata: { actor: "p-mona" },
    });
    await addRow(kit, { action: "security.mfa.disabled", principalRef: mona, at: 2, metadata: {} });
    await addRow(kit, {
      action: "security.auth.failed",
      principalRef: "staff:mona@x.com",
      at: 3,
      decision: "deny",
    });
    await addRow(kit, {
      action: "security.mfa.enabled",
      principalRef: "p-sam",
      at: 4,
      metadata: { actor: "p-sam" },
    });
    await addRow(kit, {
      action: "security.auth.failed",
      principalRef: "staff:sam@x.com",
      at: 5,
      decision: "deny",
    });
    await addRow(kit, {
      action: "security.mfa.enabled",
      principalRef: "p-mona",
      at: 6,
      tenant: OTHER,
      metadata: {},
    });

    const out = value(await list(kit, { member: "p-mona" }));
    expect(out.items.map((i) => i.kind)).toEqual(["sign_in_failed", "two_step_off", "two_step_on"]);
    expect(out.items.every((i) => i.subjectEmail === "mona@x.com")).toBe(true);
  });

  it("an unknown member yields an empty list, and a filtered page pages like any other", async () => {
    const { kit } = await setup();
    for (let i = 0; i < 8; i += 1)
      await addRow(kit, {
        action: "security.mfa.enabled",
        principalRef: "p-mona",
        at: i,
        metadata: {},
      });
    for (let i = 0; i < 8; i += 1)
      await addRow(kit, {
        action: "security.mfa.enabled",
        principalRef: "p-sam",
        at: 100 + i,
        metadata: {},
      });
    expect(value(await list(kit, { member: "p-nobody" })).items).toEqual([]);
    const a = value(await list(kit, { member: "p-mona", limit: 5 }));
    const b = value(await list(kit, { member: "p-mona", limit: 5, cursor: a.nextCursor! }));
    expect(a.items).toHaveLength(5);
    expect(b.items).toHaveLength(3);
    expect(b.nextCursor).toBeNull();
    expect(new Set([...a.items, ...b.items].map((i) => i.id)).size).toBe(8);
  });
});

describe("ListStaffActivity — the real commands' rows", () => {
  it("a scripted sequence shows its kinds newest first with the right emails and details", async () => {
    const { kit } = await setup();
    const mfa = kit.mfaDeps(new InMemoryTotpMfaProvider());
    const CODE = "123456";
    // each step is a new 30 s TOTP step so the replay guard never interferes
    const tick = (): void => kit.clock.advance(31_000);
    const turnOn = async (externalId: string, email: string): Promise<void> => {
      const started = value(
        await new StartOwnTwoStep(mfa, { mfaConfigured: true }).execute({
          tenantId: T,
          principalExternalId: externalId,
          email,
        }),
      );
      value(
        await new ConfirmOwnTwoStep(mfa).execute({
          tenantId: T,
          principalExternalId: externalId,
          enrollmentId: started.enrollmentId,
          code: CODE,
          now: kit.clock.now(),
        }),
      );
    };

    value(
      await new CreateStaffInvitation(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-sam",
        principalExternalId: "p-lee",
        email: "lee@x.com",
        role: "operator",
        tokenHash: hash("a"),
        now: kit.clock.now(),
      }),
    );
    tick();
    value(
      await new AcceptStaffInvitation(kit.deps).execute({
        tenantId: T,
        tokenHash: hash("a"),
        password: "correct horse battery",
        now: kit.clock.now(),
      }),
    );
    tick();
    value(
      await new ChangeStaffRole(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-sam",
        targetExternalId: "p-lee",
        role: "viewer",
      }),
    );
    tick();
    await turnOn("p-sam", "sam@x.com");
    tick();
    await turnOn("p-lee", "lee@x.com");
    tick();
    await turnOn("p-mona", "mona@x.com");
    tick();
    value(
      await new RegenerateOwnBackupCodes(mfa).execute({
        tenantId: T,
        principalExternalId: "p-sam",
        code: CODE,
        now: kit.clock.now(),
      }),
    );
    tick();
    value(
      await new VerifyMfaLogin(mfa).execute({
        tenantId: T,
        principalExternalId: "p-sam",
        code: CODE,
        now: kit.clock.now(),
      }),
    );
    tick();
    failure(
      await new VerifyMfaLogin(mfa).execute({
        tenantId: T,
        principalExternalId: "p-sam",
        code: "000000",
        now: kit.clock.now(),
      }),
    );
    tick();
    const policy = (enabled: boolean) =>
      new SetRequireTwoStep(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-sam",
        enabled,
        codeStepAvailable: true,
      });
    value(await policy(true));
    tick();
    value(await policy(false));
    tick();
    const setActive = (active: boolean) =>
      new SetStaffActive(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-sam",
        targetExternalId: "p-lee",
        active,
      });
    value(await setActive(false));
    tick();
    value(await setActive(true));
    tick();
    value(
      await new DisableOwnTwoStep(mfa).execute({
        tenantId: T,
        principalExternalId: "p-sam",
        now: kit.clock.now(),
      }),
    );

    const out = value(await list(kit, { limit: 50 }));
    expect(out.nextCursor).toBeNull();
    expect(out.items.map((i) => i.kind)).toEqual([
      "two_step_off",
      "reactivated",
      "deactivated",
      "two_step_policy_changed",
      "two_step_policy_changed",
      "code_failed",
      "signed_in",
      "backup_codes_regenerated",
      "two_step_on",
      "two_step_on",
      "two_step_on",
      "role_changed",
      "invitation_accepted",
      "invited",
    ]);
    const emails = out.items.map((i) => [i.actorEmail, i.subjectEmail]);
    expect(emails).toEqual([
      ["sam@x.com", "sam@x.com"],
      ["sam@x.com", "lee@x.com"],
      ["sam@x.com", "lee@x.com"],
      ["sam@x.com", "sam@x.com"],
      ["sam@x.com", "sam@x.com"],
      ["sam@x.com", "sam@x.com"],
      ["sam@x.com", "sam@x.com"],
      ["sam@x.com", "sam@x.com"],
      ["mona@x.com", "mona@x.com"],
      ["lee@x.com", "lee@x.com"],
      ["sam@x.com", "sam@x.com"],
      ["sam@x.com", "lee@x.com"],
      ["lee@x.com", "lee@x.com"],
      ["sam@x.com", "lee@x.com"],
    ]);
    expect(out.items[3]?.detail).toEqual({ enabled: false });
    expect(out.items[4]?.detail).toEqual({ enabled: true });
    expect(out.items[11]?.detail).toEqual({ from: "operator", to: "viewer" });
    expect(out.items[13]?.detail).toEqual({ to: "operator" });
    // a member filter narrows to the member's own subject rows
    const lee = value(await list(kit, { member: "p-lee", limit: 50 }));
    expect(lee.items.map((i) => i.kind)).toEqual([
      "reactivated",
      "deactivated",
      "two_step_on",
      "role_changed",
      "invitation_accepted",
      "invited",
    ]);
    // nothing sensitive in the rows: no codes, secrets or links in any item
    expect(JSON.stringify(out.items)).not.toMatch(/otpauth|secret|123456/);
  });
});
