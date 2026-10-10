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
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import type { OrderNumberAllocator } from "./ports";

export interface PlaceOrderItemInput {
  readonly productId: string;
  readonly name: string;
  readonly unitPriceAmountMinor: number;
  readonly quantity: number;
  /** Plan 2A: the variant sold (all three together, or none for a legacy line). */
  readonly variantRef?: string;
  readonly sku?: string;
  readonly variantTitle?: string | null;
}

export interface PlaceOrderAddressInput {
  /** Plan 3A: who receives the order, and the second address line. */
  readonly name?: string;
  readonly phone?: string;
  readonly line2?: string;
  readonly line1: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}

export interface PlaceOrderInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly customerRef: string;
  readonly currency: string;
  readonly items: readonly PlaceOrderItemInput[];
  readonly shippingAddress: PlaceOrderAddressInput;
}

export interface PlaceOrderOutput {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly totalAmountMinor: number;
}

export interface PlaceOrderDeps {
  readonly orders: OrderRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly orderNumbers: OrderNumberAllocator;
}

/** Places an order from caller-supplied line snapshots + a shipping address. */
export class PlaceOrder implements UseCase<PlaceOrderInput, PlaceOrderOutput, DomainError> {
  private readonly deps: PlaceOrderDeps;

  constructor(deps: PlaceOrderDeps) {
    this.deps = deps;
  }

  async execute(input: PlaceOrderInput): Promise<Result<PlaceOrderOutput, DomainError>> {
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
      const snapshot = ProductSnapshot.create(
        item.productId,
        item.name,
        unitPrice.value,
        item.variantRef === undefined
          ? undefined
          : {
              variantRef: item.variantRef,
              sku: item.sku ?? "",
              variantTitle: item.variantTitle ?? null,
            },
      );
      if (!snapshot.ok) return err(snapshot.error);
      items.push(
        OrderItem.create(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          snapshot.value,
          item.quantity,
        ),
      );
    }

    const address = AddressSnapshot.create(
      input.shippingAddress.line1,
      input.shippingAddress.city,
      input.shippingAddress.postalCode,
      input.shippingAddress.country,
      {
        recipientName: input.shippingAddress.name,
        phone: input.shippingAddress.phone,
        line2: input.shippingAddress.line2,
      },
    );
    if (!address.ok) return err(address.error);

    return this.deps.unitOfWork.run<Result<PlaceOrderOutput, DomainError>>(async (tx) => {
      // Allocated inside the order's transaction: a failed save rolls the counter back too.
      const orderNumber = OrderNumber.create(await this.deps.orderNumbers.next(input.tenantId, tx));
      if (!orderNumber.ok) return err(orderNumber.error);
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const order = Order.place(
        id,
        orderNumber.value,
        input.customerRef,
        input.currency,
        items,
        address.value,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.orders.save(order, input.tenantId, tx);
      return ok({
        orderId: id.toString(),
        orderNumber: orderNumber.value.value,
        totalAmountMinor: order.totalAmount().amountMinor,
      });
    });
  }
}
