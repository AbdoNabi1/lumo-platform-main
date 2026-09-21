import type { OrderController } from "@platform/orders";
import type { OrderCreationPort } from "@platform/checkout";
import type { CustomerController } from "@platform/identity";
import { ValidationError } from "@platform/utils";

interface ResolveGuestCustomerBody {
  readonly customerId: string;
}

interface CreateFromCheckoutBody {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: string;
}

type OrderCreationInput = Parameters<OrderCreationPort["create"]>[0];

/**
 * Real `OrderCreationPort` over Orders' own `CreateOrderFromCheckout` use case (Task 17a, C-2) —
 * Checkout's `CompleteCheckout` calls this instead of the offline `InMemoryOrderCreationAdapter`
 * stub (`services/checkout/src/composition.ts`), which fabricated a deterministic `orderRef`
 * without ever creating a real `Order` aggregate.
 *
 * Mapping gaps, documented rather than silently papered over:
 *
 * - `customerRef` undefined (guest checkout) — **CLOSED by WP-1 / G-52 (2026-09-21)**: the adapter
 *   now resolves (finds or creates) a guest customer in Identity from the session's contact email
 *   (`ResolveGuestCustomer`, scoped to `input.tenantId`) and places the order against that id. A
 *   session with no contact email throws a `ValidationError` (a 4xx — the caller can fix it by
 *   supplying an email), not a plain `Error`. Resolving is not authenticating: the guest gets an
 *   order attached to that customer, never a session as them. The paragraph below is kept as the
 *   record of the original limitation and the decision that closed it.
 * - (historical) `customerRef` undefined (guest checkout): `CreateOrderFromCheckout`'s input requires a
 *   non-optional `customerRef: string`, but `OrderCreationPort.create`'s `customerRef` is
 *   `string | undefined` because `CheckoutSession` supports guest checkout (`session.isGuest`).
 *   This adapter throws rather than fabricating a placeholder value like `"guest"` — guest
 *   checkout cannot complete an order today; that is a known, deliberate C-2 scope boundary that
 *   needs a product decision (e.g. "require account creation before order creation" or "widen
 *   Orders to accept a nullable customerRef") before it can be closed.
 * - `CheckoutItem.productRef` is mapped to BOTH `productId` and `name` in Orders' item input.
 *   `CheckoutItem` carries no display-name field of its own (widening it is out of scope here), so
 *   order line items will show a product ref instead of a friendly name until a future task
 *   threads a real name through Cart -> Checkout snapshots.
 * - `CheckoutAddress.line2` is dropped: Orders' `CreateOrderFromCheckoutAddressInput` has no
 *   `line2` field to receive it.
 *
 * Residual idempotency risk — documented, not closed here, and WIDER than a crash window (an
 * earlier revision of this comment understated it; corrected per the C-2 final review):
 * `OrderRepository` has no `findByIdempotencyKey`/`findByCheckoutRef`, so
 * `CreateOrderFromCheckout` itself does not dedupe by `checkoutRef` or by the `idempotencyKey` this
 * port receives (the parameter is accepted for shape-compatibility with `OrderCreationPort` and
 * future use, but this adapter does not act on it yet). `CompleteCheckout` (Task 16) closes only
 * the case where the session was already persisted as completed — its state short-circuit means a
 * caller retrying AFTER a fully successful completion never re-reaches this adapter. Two distinct
 * holes remain, both producing duplicate `Order` aggregates for one checkout session:
 *
 *  - **Any failure after order creation, not just a process crash.** `create()` here runs inside
 *    `CompleteCheckout`'s `unitOfWork.run` but opens its OWN `unitOfWork.run` (inside
 *    `CreateOrderFromCheckout`), so the order can commit while the enclosing session write does
 *    not. Anything that fails between the two — `session.complete()` throwing, the session `save`
 *    failing, the outer transaction rolling back, a network/timeout error surfacing to the caller —
 *    leaves a live `Order` with no `orderRef` recorded on the session. The ordinary retry that
 *    follows calls `create()` again and mints a second order. This is the ERROR path, not a rare
 *    crash window.
 *  - **Concurrent double-submit.** Two `/complete` requests for the same session racing each other
 *    both read `session.orderRef === null` before either writes, so the state short-circuit sees
 *    nothing to short-circuit on and both call `create()`. No lock, unique constraint, or
 *    idempotency record stands between them.
 *
 * Closing either needs a real transaction-boundary redesign (a shared transaction across the two
 * contexts, or an idempotency record keyed on `checkoutRef`/`idempotencyKey` with a unique
 * constraint behind it) — a design decision with several valid shapes, deliberately not made
 * unilaterally here. Tracked as a known residual risk, same posture as `OrdersPaymentAdapter`'s
 * documented concurrent-capture window.
 */
export class OrderCreationAdapter implements OrderCreationPort {
  private readonly orders: Pick<OrderController, "createFromCheckout">;
  private readonly customers: Pick<CustomerController, "resolveGuestCustomer">;

  /** ADR-0014 (WP-10, T10.3): stateless per tenant — `OrderCreationPort.create`'s input carries `tenantId`. */
  constructor(
    orders: Pick<OrderController, "createFromCheckout">,
    customers: Pick<CustomerController, "resolveGuestCustomer">,
  ) {
    this.orders = orders;
    this.customers = customers;
  }

  async create(input: OrderCreationInput): Promise<{ readonly orderRef: string }> {
    const customerRef = input.customerRef ?? (await this.resolveGuestCustomerRef(input));

    const response = await this.orders.createFromCheckout({
      tenantId: input.tenantId,
      checkoutRef: input.checkoutSessionId,
      customerRef,
      currency: input.currency,
      items: input.items.map((item) => ({
        productId: item.productRef,
        // CheckoutItem carries no display name — see class doc comment.
        name: item.productRef,
        unitPriceAmountMinor: item.unitPriceAmountMinor,
        quantity: item.quantity,
      })),
      billingAddress: {
        line1: input.billingAddress.line1,
        // line2 dropped — Orders' address input has no field for it, see class doc comment.
        city: input.billingAddress.city,
        postalCode: input.billingAddress.postalCode,
        country: input.billingAddress.country,
      },
      shippingAddress: {
        line1: input.shippingAddress.line1,
        city: input.shippingAddress.city,
        postalCode: input.shippingAddress.postalCode,
        country: input.shippingAddress.country,
      },
      totals: {
        subtotalMinor: input.totals.subtotalMinor,
        taxMinor: input.totals.taxMinor,
        shippingMinor: input.totals.shippingMinor,
        discountMinor: input.totals.discountMinor,
        totalMinor: input.totals.totalMinor,
      },
    });

    if (response.status !== 201) {
      throw new Error(
        `OrderCreationAdapter: createFromCheckout failed for checkout session ` +
          `"${input.checkoutSessionId}" (status ${response.status}): ` +
          `${JSON.stringify(response.body)}`,
      );
    }

    const { orderId } = response.body as CreateFromCheckoutBody;
    return { orderRef: orderId };
  }

  /**
   * Guest checkout: find-or-create the customer for the session's contact email, in the session's
   * own tenant (`input.tenantId` — never a default, never re-read from a request header).
   */
  private async resolveGuestCustomerRef(input: OrderCreationInput): Promise<string> {
    if (input.contactEmail === undefined) {
      throw new ValidationError(
        `Checkout session "${input.checkoutSessionId}" has no customer and no contact email — ` +
          `a guest must provide an email address before the order can be placed`,
        [{ field: "email", message: "required to complete a guest checkout" }],
      );
    }
    const response = await this.customers.resolveGuestCustomer({
      email: input.contactEmail,
      // The session carries no name; the local part is a display placeholder, never an identifier.
      name: input.contactEmail.split("@")[0] ?? input.contactEmail,
      tenantId: input.tenantId,
    });
    if (response.status !== 200) {
      throw new Error(
        `OrderCreationAdapter: could not resolve a guest customer for checkout session ` +
          `"${input.checkoutSessionId}" (status ${response.status}): ` +
          `${JSON.stringify(response.body)}`,
      );
    }
    return (response.body as ResolveGuestCustomerBody).customerId;
  }
}
