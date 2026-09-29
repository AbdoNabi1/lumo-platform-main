import type {
  AccessControl,
  AuditEvent,
  AuditTrail,
  Permission,
  Principal,
} from "@platform/contracts";
import type { LicensingController } from "@platform/licensing";
import { describe, expect, it } from "vitest";
import { AdminGuard } from "./admin-guard";
import { LicensingAdminController } from "./licensing.admin-controller";

/**
 * Every OPERATOR action on this controller authorizes before it delegates (ADR-0007). Nothing proved
 * that: every HTTP test drives an allow-everything `AccessControl`, so deleting a `guard.ensure` line
 * from any one method left the whole `@platform/admin` suite green and the `permission` declared on
 * its route became decoration. This walks the PROTOTYPE rather than a hand-written list, so a method
 * added later is covered the day it lands.
 *
 * The two PSP callback methods are exempt BY NAME, and the exemption is checked: their caller is
 * Paymob, authenticated by the callback signature verified inside the use case, and they take no
 * `principal` at all — there is no identity for a guard to authorize. Naming them explicitly (rather
 * than inferring the exemption from arity) means a future operator method that forgets its guard
 * fails here instead of quietly joining them.
 */
const PSP_AUTHENTICATED = ["recordCardToken", "recordInvoiceTransaction"] as const;

const staff: Principal = { id: "staff-1", kind: "staff", roles: [], tenantId: "t-1" };

function denyingGuard(): { guard: AdminGuard; asked: Permission[]; audited: AuditEvent[] } {
  const asked: Permission[] = [];
  const audited: AuditEvent[] = [];
  const accessControl: AccessControl = {
    authorize: async (_principal, permission) => {
      asked.push(permission);
      return false;
    },
  };
  const auditTrail: AuditTrail = {
    record: async (entry) => {
      audited.push(entry);
    },
  };
  return {
    guard: new AdminGuard({ accessControl, auditTrail, clock: { now: () => new Date(0) } }),
    asked,
    audited,
  };
}

/** Fails loudly the moment a method delegates without authorizing first. */
function unreachableLicensing(): LicensingController {
  return new Proxy(
    {},
    {
      get: (_target, property) => () => {
        throw new Error(`reached LicensingController.${String(property)} without authorizing`);
      },
    },
  ) as unknown as LicensingController;
}

function methodsOf(): readonly string[] {
  return Object.getOwnPropertyNames(LicensingAdminController.prototype).filter(
    (name) => name !== "constructor",
  );
}

const operatorMethods = methodsOf().filter(
  (name) => !(PSP_AUTHENTICATED as readonly string[]).includes(name),
);

function build(): { controller: LicensingAdminController } & ReturnType<typeof denyingGuard> {
  const guarded = denyingGuard();
  return {
    ...guarded,
    controller: new LicensingAdminController({
      licensing: unreachableLicensing(),
      guard: guarded.guard,
    }),
  };
}

function invoke(
  controller: LicensingAdminController,
  method: string,
  ...args: readonly unknown[]
): Promise<unknown> {
  const methods = controller as unknown as Record<
    string,
    ((...rest: readonly unknown[]) => Promise<unknown>) | undefined
  >;
  const call = methods[method];
  if (call === undefined) throw new Error(`LicensingAdminController has no ${method}`);
  return call.call(controller, ...args);
}

describe("every licensing admin action authorizes before it delegates", () => {
  it("found the methods it means to check", () => {
    // Guards the guard: a rename that emptied the prototype would make every assertion below vacuous.
    expect(operatorMethods.length).toBeGreaterThanOrEqual(18);
    for (const exempt of PSP_AUTHENTICATED) expect(methodsOf()).toContain(exempt);
  });

  it.each(operatorMethods)("%s is refused 403 and never reaches Licensing", async (method) => {
    const { controller, asked, audited } = build();

    const response = await invoke(controller, method, staff, {});

    expect(response).toEqual({
      status: 403,
      body: expect.objectContaining({ code: "FORBIDDEN", retryable: false }),
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/^licensing:[a-z]+:[a-z]+$/);
    expect(audited.map((entry) => entry.decision)).toEqual(["deny"]);
  });

  it.each(PSP_AUTHENTICATED)("%s takes no principal, so it cannot be guarded", (method) => {
    const prototype = LicensingAdminController.prototype as unknown as Record<
      string,
      ((...a: never[]) => unknown) | undefined
    >;
    expect(prototype[method]?.length).toBe(1);
  });
});
