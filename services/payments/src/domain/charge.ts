import { Entity, type Money, type UniqueEntityId } from "@platform/domain";
import type { PspToken } from "./value-objects/psp-token";

interface ChargeProps {
  readonly amount: Money;
  readonly pspToken: PspToken;
  readonly occurredAt: Date;
}

/** A successful capture against a payment intent (identity by id). */
export class Charge extends Entity<ChargeProps> {
  static create(id: UniqueEntityId, amount: Money, pspToken: PspToken, occurredAt: Date): Charge {
    return new Charge({ amount, pspToken, occurredAt }, id);
  }

  get amount(): Money {
    return this.props.amount;
  }

  get pspToken(): PspToken {
    return this.props.pspToken;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
