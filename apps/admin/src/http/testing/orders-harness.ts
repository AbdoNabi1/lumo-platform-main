import { RoleTableAccessControl } from "@platform/auth";
import type { DraftOrderCompletionPort } from "@platform/checkout";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { InMemoryStaffDirectory } from "@platform/orders";
import { wireAdmin, type WiredAdmin } from "../../composition";

/** Order operations Part 1 — the real in-memory composition with the real role table. */
export const HARNESS_NOW = new Date("2026-07-05T00:00:00.000Z");
export const HARNESS_TENANT = "shop-a";

export const adminStaff: Principal = {
  id: "staff-admin",
  kind: "staff",
  roles: ["admin"],
  tenantId: HARNESS_TENANT,
};
export const operatorStaff: Principal = {
  id: "staff-op",
  kind: "staff",
  roles: ["operator"],
  tenantId: HARNESS_TENANT,
};
export const viewerStaff: Principal = {
  id: "staff-viewer",
  kind: "staff",
  roles: ["viewer"],
  tenantId: HARNESS_TENANT,
};

export function buildOrdersAdmin(
  options: {
    readonly staffNames?: Readonly<Record<string, string>>;
    /** Order operations Part 3: a clock the test moves (abandoned = idle an hour). */
    readonly clock?: Clock;
    /** Order operations Part 4: replaces Checkout's report to Orders (a stub that throws, say). */
    readonly draftCompletion?: DraftOrderCompletionPort;
  } = {},
): WiredAdmin {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-7000-8000-${(n += 1).toString().padStart(12, "0")}`,
  };
  const clock: Clock = options.clock ?? { now: () => HARNESS_NOW };
  return wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    tenantId: "tenant-local",
    accessControl: new RoleTableAccessControl(),
    ...(options.staffNames === undefined
      ? {}
      : { staffDirectory: new InMemoryStaffDirectory(options.staffNames) }),
    ...(options.draftCompletion === undefined ? {} : { draftCompletion: options.draftCompletion }),
  });
}

/** A legacy `placed` order (payment pending, open, unfulfilled) — returns its id. */
export async function placeTestOrder(
  admin: WiredAdmin,
  tenantId = HARNESS_TENANT,
): Promise<string> {
  const response = await admin.orders.placeOrder(adminStaff, {
    tenantId,
    customerRef: "customer-1",
    currency: "EGP",
    items: [{ productId: "p-1", name: "Toy Wagon", unitPriceAmountMinor: 1000, quantity: 1 }],
    shippingAddress: { line1: "1 Main St", city: "Cairo", postalCode: "11511", country: "EG" },
  });
  if (response.status !== 201) throw new Error(`placeOrder answered ${response.status}`);
  return (response.body as { orderId: string }).orderId;
}

/** Runs a route's handler directly (the route-level guard is the server's; controllers still authorize). */
export async function callRoute(
  routes: readonly RouteDefinition[],
  method: RouteDefinition["method"],
  path: string,
  input: { readonly params?: unknown; readonly query?: unknown; readonly body?: unknown },
  principal: Principal = adminStaff,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const route = routes.find((candidate) => candidate.method === method && candidate.path === path);
  if (route === undefined) throw new Error(`no ${method} ${path} route`);
  return route.handle({
    body: input.body,
    params: input.params,
    query: input.query ?? {},
    context: {
      tenantId: principal.tenantId,
      principal,
      requestId: "req-1",
      correlationId: "corr-1",
    },
  });
}
