import { UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { beforeEach, describe, expect, it } from "vitest";
import { MfaEnrollment } from "../domain/mfa-enrollment";
import { buildStaffKit, type StaffKit } from "../infrastructure/staff-test-kit";
import { ResetStaffTwoStep } from "./staff-commands.use-cases";
import { ListStaffActivity } from "./staff-activity.use-cases";

const T = "shop-a";
const OTHER = "shop-b";

function failure<V>(result: Result<V, DomainError>): DomainError {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.value)}`);
  return result.error;
}
function value<V>(result: Result<V, DomainError>): V {
  if (!result.ok)
    throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function enrol(
  kit: StaffKit,
  internalId: string,
  status: "active" | "pending",
  tenant = T,
): Promise<MfaEnrollment> {
  const enrollment = MfaEnrollment.enroll(
    UniqueEntityId.from(kit.deps.idGenerator.generate()),
    { principalRef: internalId, method: "totp", secretRef: "secret-ref" },
    kit.deps.idGenerator.generate(),
    kit.clock.now(),
  );
  if (status === "active")
    enrollment.markVerified(kit.deps.idGenerator.generate(), kit.clock.now());
  await kit.mfaEnrollments.save(enrollment, tenant);
  return enrollment;
}

async function cast(kit: StaffKit) {
  const owner = await kit.seedStaff(T, {
    externalId: "p-owner",
    email: "owner@x.com",
    roles: ["platform-admin"],
  });
  const admin = await kit.seedStaff(T, {
    externalId: "p-admin",
    email: "admin@x.com",
    roles: ["admin"],
  });
  const op = await kit.seedStaff(T, { externalId: "p-op", email: "op@x.com", roles: ["operator"] });
  const view = await kit.seedStaff(T, {
    externalId: "p-view",
    email: "view@x.com",
    roles: ["viewer"],
  });
  return { owner, admin, op, view };
}

const reset = (kit: StaffKit, input: { actor?: string; target: string; tenant?: string }) =>
  new ResetStaffTwoStep(kit.deps).execute({
    tenantId: input.tenant ?? T,
    actorExternalId: input.actor ?? "p-admin",
    targetExternalId: input.target,
  });
const audits = async (kit: StaffKit, tenant = T) =>
  (await kit.deps.auditLedger.list(null, tenant)).map((r) => r.content);
const statusesOf = async (kit: StaffKit, internalId: string, tenant = T) =>
  (await kit.mfaEnrollments.listByPrincipal(internalId, tenant)).map((e) => e.status).sort();

beforeEach(() => {
  expect.hasAssertions();
});

describe("ResetStaffTwoStep", () => {
  it("revokes the target's active AND pending enrolments, signs them out, audits {actor,target}", async () => {
    const kit = buildStaffKit();
    const ids = await cast(kit);
    await enrol(kit, ids.op, "active");
    await enrol(kit, ids.op, "pending");
    await kit.seedSession(T, ids.op, kit.clock.now());
    await kit.seedSession(T, ids.op, kit.clock.now());
    await kit.seedSession(T, ids.view, kit.clock.now());

    const out = value(await reset(kit, { target: "p-op" }));

    expect(out).toEqual({ reset: true, revokedEnrollments: 2 });
    expect(await statusesOf(kit, ids.op)).toEqual(["revoked", "revoked"]);
    const sessions = await kit.sessions.listByPrincipal(ids.op, T);
    expect(sessions.every((s) => !s.isActive)).toBe(true);
    // Someone else's session is untouched.
    expect((await kit.sessions.listByPrincipal(ids.view, T)).every((s) => s.isActive)).toBe(true);
    const record = (await audits(kit)).find((a) => a.action === "security.staff.two_step_reset");
    expect(record).toMatchObject({
      principalRef: "p-op",
      decision: "allow",
      metadata: { actor: "p-admin", target: "p-op" },
    });
    expect(Object.keys(record?.metadata ?? {}).sort()).toEqual([
      "actor",
      "revokedSessions",
      "target",
    ]);
  });

  it("the owner may reset an admin; a target with no enrolment still succeeds (sessions revoked)", async () => {
    const kit = buildStaffKit();
    const ids = await cast(kit);
    await kit.seedSession(T, ids.admin, kit.clock.now());

    const out = value(await reset(kit, { actor: "p-owner", target: "p-admin" }));

    expect(out).toEqual({ reset: true, revokedEnrollments: 0 });
    expect((await kit.sessions.listByPrincipal(ids.admin, T)).every((s) => !s.isActive)).toBe(true);
  });

  it("resetting twice is harmless (the second finds nothing live)", async () => {
    const kit = buildStaffKit();
    const ids = await cast(kit);
    await enrol(kit, ids.op, "active");

    expect(value(await reset(kit, { target: "p-op" })).revokedEnrollments).toBe(1);
    expect(value(await reset(kit, { target: "p-op" })).revokedEnrollments).toBe(0);
    expect(await statusesOf(kit, ids.op)).toEqual(["revoked"]);
  });

  it("the store owner's two-step can't be reset (BUSINESS_RULE), nothing written", async () => {
    const kit = buildStaffKit();
    const ids = await cast(kit);
    await enrol(kit, ids.owner, "active");
    const before = await kit.snapshot(T);

    const error = failure(await reset(kit, { target: "p-owner" }));

    expect([error.code, error.message]).toEqual([
      "BUSINESS_RULE",
      "The store owner's two-step verification can't be reset",
    ]);
    expect(await kit.snapshot(T)).toBe(before);
    expect(await statusesOf(kit, ids.owner)).toEqual(["active"]);
  });

  it("nobody resets their own (BUSINESS_RULE), nothing written", async () => {
    const kit = buildStaffKit();
    const ids = await cast(kit);
    await enrol(kit, ids.admin, "active");
    const before = await kit.snapshot(T);

    const error = failure(await reset(kit, { target: "p-admin" }));

    expect([error.code, error.message]).toEqual([
      "BUSINESS_RULE",
      "Reset your own two-step from your account page",
    ]);
    expect(await kit.snapshot(T)).toBe(before);
  });

  it("an unknown target is NOT_FOUND; a customer-like principal without a staff credential too", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    await kit.seedStaff(T, {
      externalId: "p-cust",
      email: "cust@x.com",
      roles: [],
      credential: false,
    });
    expect(failure(await reset(kit, { target: "nobody" })).code).toBe("NOT_FOUND");
    expect(failure(await reset(kit, { target: "p-cust" })).code).toBe("NOT_FOUND");
  });

  it("a non-admin actor (operator, viewer) is refused with FORBIDDEN and nothing changes", async () => {
    const kit = buildStaffKit();
    const ids = await cast(kit);
    await enrol(kit, ids.view, "active");
    const before = await kit.snapshot(T);

    for (const actor of ["p-op", "p-view"]) {
      expect(failure(await reset(kit, { actor, target: "p-view" })).code).toBe("FORBIDDEN");
    }
    expect(await kit.snapshot(T)).toBe(before);
  });

  it("a suspended admin actor is refused", async () => {
    const kit = buildStaffKit();
    const ids = await cast(kit);
    await kit.seedStaff(T, {
      externalId: "p-sus",
      email: "sus@x.com",
      roles: ["admin"],
      status: "suspended",
    });
    await enrol(kit, ids.op, "active");
    expect(failure(await reset(kit, { actor: "p-sus", target: "p-op" })).code).toBe("FORBIDDEN");
    expect(await statusesOf(kit, ids.op)).toEqual(["active"]);
  });

  it("another store's member is NOT_FOUND (the directory is tenant-scoped)", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    const other = await kit.seedStaff(OTHER, {
      externalId: "p-b",
      email: "b@y.com",
      roles: ["viewer"],
    });
    await enrol(kit, other, "active", OTHER);

    expect(failure(await reset(kit, { target: "p-b" })).code).toBe("NOT_FOUND");
    expect(await statusesOf(kit, other, OTHER)).toEqual(["active"]);
  });

  it("the activity list shows 'two_step_reset' with actor and subject emails", async () => {
    const kit = buildStaffKit();
    const ids = await cast(kit);
    await enrol(kit, ids.op, "active");
    value(await reset(kit, { target: "p-op" }));

    const listed = value(await new ListStaffActivity(kit.deps).execute({ tenantId: T }));

    expect(listed.items.find((i) => i.kind === "two_step_reset")).toMatchObject({
      kind: "two_step_reset",
      actorEmail: "admin@x.com",
      subjectEmail: "op@x.com",
    });
  });
});
