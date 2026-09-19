import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, Money, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import { Order } from "../domain/order";
import type { OrderRepository } from "../domain/order-repository";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { OrderTotalsSnapshot } from "../domain/value-objects/order-totals-snapshot";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";

export interface CreateOrderFromCheckoutAddressInput {
  readonly line1: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}

export interface CreateOrderFromCheckoutItemInput {
  readonly productId: string;
  readonly name: string;
  readonly unitPriceAmountMinor: number;
  readonly quantity: number;
}

export interface CreateOrderFromCheckoutTotalsInput {
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly shippingMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
}

export interface CreateOrderFromCheckoutInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly checkoutRef: string;
  readonly customerRef: string;
  readonly currency: string;
  readonly items: readonly CreateOrderFromCheckoutItemInput[];
  readonly billingAddress: CreateOrderFromCheckoutAddressInput;
  readonly shippingAddress: CreateOrderFromCheckoutAddressInput;
  readonly totals: CreateOrderFromCheckoutTotalsInput;
}

export interface CreateOrderFromCheckoutOutput {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: string;
}

export interface CreateOrderFromCheckoutDeps {
  readonly orders: OrderRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Creates an order from Checkout's order-draft snapshot — the only entry point to the full Sprint 4.7 lifecycle. */
export class CreateOrderFromCheckout implements UseCase<
  CreateOrderFromCheckoutInput,
  CreateOrderFromCheckoutOutput,
  DomainError
> {
  private readonly deps: CreateOrderFromCheckoutDeps;

  constructor(deps: CreateOrderFromCheckoutDeps) {
    this.deps = deps;
  }

  async execute(
    input: CreateOrderFromCheckoutInput,
  ): Promise<Result<CreateOrderFromCheckoutOutput, DomainError>> {
    const checkoutRef = Guard.againstEmpty(input.checkoutRef, "checkoutRef");
    if (!checkoutRef.ok) return err(checkoutRef.error);
    const customerRef = Guard.againstEmpty(input.customerRef, "customerRef");
    if (!customerRef.ok) return err(customerRef.error);
    if (input.items.length === 0) {
      return err(
        new ValidationError("An order needs at least one item", [
          { field: "items", message: "at least one is required" },
        ]),
      );
    }

    const items: OrderItem[] = [];
    for (const item of input.items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        return err(
          new ValidationError("Invalid quantity", [
            { field: "quantity", message: "must be a positive integer" },
          ]),
        );
      }
      const unitPrice = Money.create(item.unitPriceAmountMinor, input.currency);
      if (!unitPrice.ok) return err(unitPrice.error);
      const snapshot = ProductSnapshot.create(item.productId, item.name, unitPrice.value);
      if (!snapshot.ok) return err(snapshot.error);
      items.push(
        OrderItem.create(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          snapshot.value,
          item.quantity,
        ),
      );
    }

    const billingAddress = AddressSnapshot.create(
      input.billingAddress.line1,
      input.billingAddress.city,
      input.billingAddress.postalCode,
      input.billingAddress.country,
    );
    if (!billingAddress.ok) return err(billingAddress.error);
    const shippingAddress = AddressSnapshot.create(
      input.shippingAddress.line1,
      input.shippingAddress.city,
      input.shippingAddress.postalCode,
      input.shippingAddress.country,
    );
    if (!shippingAddress.ok) return err(shippingAddress.error);

    const orderNumber = OrderNumber.create(`ORD-${this.deps.idGenerator.generate()}`);
    if (!orderNumber.ok) return err(orderNumber.error);

    const totals = OrderTotalsSnapshot.create({ ...input.totals, currency: input.currency });

    return this.deps.unitOfWork.run<Result<CreateOrderFromCheckoutOutput, DomainError>>(
      async (tx) => {
        const id = UniqueEntityId.from(this.deps.idGenerator.generate());
        const order = Order.createFromCheckout(
          id,
          orderNumber.value,
          input.customerRef,
          input.currency,
          items,
          shippingAddress.value,
          billingAddress.value,
          totals,
          input.checkoutRef,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
        await this.deps.orders.save(order, input.tenantId, tx);
        return ok({
          orderId: id.toString(),
          orderNumber: orderNumber.value.value,
          status: order.status,
        });
      },
    );
  }
}
