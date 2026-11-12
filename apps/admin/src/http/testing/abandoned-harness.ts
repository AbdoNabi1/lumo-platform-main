import type { DraftOrderCompletionPort } from "@platform/checkout";
import type { Clock, Principal } from "@platform/contracts";
import type { RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../../composition";
import { adminRoutes } from "../admin-routes";
import { adminStaff, buildOrdersAdmin, HARNESS_NOW, HARNESS_TENANT } from "./orders-harness";
import { controllerDriver, seedSingleVariantProduct, type SeededProduct } from "./seed-catalog";
import { controllerStockDriver, seedStock } from "./seed-stock";

/** TEST-ONLY (order operations Part 3): the real in-memory composition with a clock the test moves. */
export const HOUR_MS = 3_600_000;

export interface SteppingClock extends Clock {
  advance(ms: number): void;
}

export function steppingClock(start: Date = HARNESS_NOW): SteppingClock {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
  };
}

export interface Reply {
  readonly status: number;
  readonly body: unknown;
}

type Method = RouteDefinition["method"];

export interface RecoveryWorld {
  readonly admin: WiredAdmin;
  readonly routes: readonly RouteDefinition[];
  readonly clock: SteppingClock;
  /** A public route as the storefront's server calls it (`sessionRef` in the header on reads). */
  publicCall(
    method: Method,
    path: string,
    input: {
      readonly params?: Record<string, string>;
      readonly body?: unknown;
      readonly sessionRef?: string;
      readonly tenantId?: string;
    },
  ): Promise<Reply>;
  /** A staff route; the controllers authorize `principal` with the real role table. */
  staffCall(
    method: Method,
    path: string,
    input: {
      readonly params?: Record<string, string>;
      readonly query?: Record<string, string>;
      readonly body?: unknown;
    },
    principal?: Principal,
  ): Promise<Reply>;
}

export function recoveryWorld(
  options: { readonly draftCompletion?: DraftOrderCompletionPort } = {},
): RecoveryWorld {
  const clock = steppingClock();
  const admin = buildOrdersAdmin({ clock, ...options });
  const routes = adminRoutes(admin);
  const find = (method: Method, path: string): RouteDefinition => {
    const route = routes.find(
      (candidate) => candidate.method === method && candidate.path === path,
    );
    if (route === undefined) throw new Error(`no ${method} ${path} route`);
    return route;
  };
  return {
    admin,
    routes,
    clock,
    publicCall: (method, path, input) => {
      const route = find(method, path);
      return route.handle({
        body:
          input.body === undefined
            ? undefined
            : (route.schema.body?.parse(input.body) ?? input.body),
        params: input.params ?? {},
        query: {},
        context: {
          tenantId: input.tenantId ?? HARNESS_TENANT,
          principal: { id: "public", kind: "customer", roles: [] },
          requestId: "req-1",
          correlationId: "corr-1",
          headers: input.sessionRef === undefined ? {} : { "x-cart-session": input.sessionRef },
        },
      } as never);
    },
    staffCall: (method, path, input, principal = adminStaff) => {
      const route = find(method, path);
      return route.handle({
        body: input.body === undefined ? undefined : route.schema.body?.parse(input.body),
        params: input.params ?? {},
        query:
          input.query === undefined
            ? {}
            : (route.schema.querystring?.parse(input.query) ?? input.query),
        context: {
          tenantId: principal.tenantId,
          principal,
          requestId: "req-1",
          correlationId: "corr-1",
        },
      });
    },
  };
}

export function unwrap<T>(reply: Reply, what: string): T {
  if (reply.status < 200 || reply.status >= 300) {
    throw new Error(`${what} failed (${reply.status}): ${JSON.stringify(reply.body)}`);
  }
  return reply.body as T;
}

/** One published single-variant product in EGP with stock, as the storefront would sell it. */
export async function seedRecoveryProduct(
  world: RecoveryWorld,
  sku: string,
  priceMinor: number,
): Promise<SeededProduct> {
  const product = await seedSingleVariantProduct(
    controllerDriver(world.admin.publicReads.products, HARNESS_TENANT),
    sku,
    priceMinor,
    "EGP",
  );
  await seedStock(controllerStockDriver(world.admin.inventory, adminStaff, HARNESS_TENANT), {
    productId: product.productId,
    variantId: product.variantId,
    quantity: 100,
  });
  return product;
}

export const RECOVERY_ADDRESS = {
  name: "Mona Ali",
  phone: "01001234567",
  line1: "5 Nile St",
  city: "Cairo",
  country: "EG",
  province: "EG-C",
} as const;

/** A guest who filled the cart, started checkout, typed contact and address — then left. */
export async function abandonCheckout(
  world: RecoveryWorld,
  input: {
    readonly sessionRef: string;
    readonly lines: readonly { readonly product: SeededProduct; readonly quantity: number }[];
    readonly email?: string;
  },
): Promise<{ readonly checkoutSessionId: string; readonly cartId: string }> {
  const { sessionRef } = input;
  const cart = unwrap<{ id: string }>(
    await world.publicCall("POST", "/public/carts", { body: { sessionRef, currency: "EGP" } }),
    "create cart",
  );
  for (const line of input.lines) {
    unwrap(
      await world.publicCall("POST", "/public/carts/:cartId/items", {
        params: { cartId: cart.id },
        body: { sessionRef, productId: line.product.productId, quantity: line.quantity },
      }),
      "add item",
    );
  }
  const started = unwrap<{ id: string }>(
    await world.publicCall("POST", "/public/checkouts", {
      body: { sessionRef, cartRef: cart.id, currency: "EGP" },
    }),
    "start checkout",
  );
  const params = { checkoutSessionId: started.id };
  unwrap(
    await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/items", {
      params,
      body: { sessionRef, cartId: cart.id },
    }),
    "load items",
  );
  if (input.email !== undefined) {
    unwrap(
      await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/contact", {
        params,
        body: { sessionRef, email: input.email },
      }),
      "contact",
    );
  }
  unwrap(
    await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/shipping-address", {
      params,
      body: { sessionRef, ...RECOVERY_ADDRESS },
    }),
    "shipping address",
  );
  return { checkoutSessionId: started.id, cartId: cart.id };
}

/** Billing address, totals, complete — answers the order id. */
export async function completeCheckout(
  world: RecoveryWorld,
  checkoutSessionId: string,
  sessionRef: string,
): Promise<string> {
  const params = { checkoutSessionId };
  unwrap(
    await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/billing-address", {
      params,
      body: { sessionRef, ...RECOVERY_ADDRESS },
    }),
    "billing address",
  );
  unwrap(
    await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/recalculate", {
      params,
      body: { sessionRef },
    }),
    "recalculate",
  );
  const completed = unwrap<{ orderRef: string }>(
    await world.publicCall("POST", "/public/checkouts/:checkoutSessionId/complete", {
      params,
      body: { sessionRef, idempotencyKey: `complete-${checkoutSessionId}` },
    }),
    "complete",
  );
  return completed.orderRef;
}
