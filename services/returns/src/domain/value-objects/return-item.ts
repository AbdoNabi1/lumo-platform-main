import { Entity, type ProductRef, type UniqueEntityId } from "@platform/domain";
import type { ReturnDisposition } from "./return-disposition";
import type { ReturnReason } from "./return-reason";

interface ReturnItemProps {
  readonly orderItemRef: string;
  readonly productRef: ProductRef;
  readonly quantity: number;
  readonly reason: ReturnReason;
  disposition?: ReturnDisposition;
}

/** One line of a return request — the order item being returned, why, and (once inspected) what happens to it. */
export class ReturnItem extends Entity<ReturnItemProps> {
  static create(
    id: UniqueEntityId,
    orderItemRef: string,
    productRef: ProductRef,
    quantity: number,
    reason: ReturnReason,
    disposition?: ReturnDisposition,
  ): ReturnItem {
    return new ReturnItem({ orderItemRef, productRef, quantity, reason, disposition }, id);
  }

  /** Records the inspector's disposition decision for this item — mutates after inspection, never before. */
  setDisposition(disposition: ReturnDisposition): void {
    this.props.disposition = disposition;
  }

  get orderItemRef(): string {
    return this.props.orderItemRef;
  }

  get productRef(): ProductRef {
    return this.props.productRef;
  }

  get quantity(): number {
    return this.props.quantity;
  }

  get reason(): ReturnReason {
    return this.props.reason;
  }

  get disposition(): ReturnDisposition | undefined {
    return this.props.disposition;
  }
}
