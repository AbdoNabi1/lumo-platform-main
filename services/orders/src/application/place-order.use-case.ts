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

export interface PlaceOrderItemInput {
  readonly productId: string;
  readonly name: string;
  readonly unitPriceAmountMinor: number;
  readonly quantity: number;
}

export interface PlaceOrderAddressInput {
  readonly line1: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}

export interface PlaceOrderInput {
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

    const address = AddressSnapshot.create(
      input.shippingAddress.line1,
      input.shippingAddress.city,
      input.shippingAddress.postalCode,
      input.shippingAddress.country,
    );
    if (!address.ok) return err(address.error);

    const orderNumber = OrderNumber.create(`ORD-${this.deps.idGenerator.generate()}`);
    if (!orderNumber.ok) return err(orderNumber.error);

    return this.deps.unitOfWork.run<Result<PlaceOrderOutput, DomainError>>(async (tx) => {
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
      await this.deps.orders.save(order, tx);
      return ok({
        orderId: id.toString(),
        orderNumber: orderNumber.value.value,
        totalAmountMinor: order.totalAmount().amountMinor,
      });
    });
  }
}
