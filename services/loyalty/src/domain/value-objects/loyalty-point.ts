import { ValueObject } from "@platform/domain";

interface LoyaltyPointProps {
  readonly balance: number;
}

/** A points wallet balance — points are not money (never captures payment), pure arithmetic. */
export class LoyaltyPoint extends ValueObject<LoyaltyPointProps> {
  static zero(): LoyaltyPoint {
    return new LoyaltyPoint({ balance: 0 });
  }

  static from(balance: number): LoyaltyPoint {
    return new LoyaltyPoint({ balance });
  }

  add(points: number): LoyaltyPoint {
    return new LoyaltyPoint({ balance: this.props.balance + points });
  }

  subtract(points: number): LoyaltyPoint {
    return new LoyaltyPoint({ balance: this.props.balance - points });
  }

  isAtLeast(points: number): boolean {
    return this.props.balance >= points;
  }

  get balance(): number {
    return this.props.balance;
  }
}
