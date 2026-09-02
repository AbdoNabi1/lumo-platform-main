import { BusinessRuleError, ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface StockLevelProps {
  readonly onHand: number;
  readonly reserved: number;
}

/**
 * On-hand and reserved quantities for an inventory item. Immutable: the mutation helpers return a
 * new `StockLevel` and throw a `BusinessRuleError` on an invariant violation (insufficient stock /
 * adjusting below reserved). `available = onHand - reserved`.
 */
export class StockLevel extends ValueObject<StockLevelProps> {
  static create(onHand: number, reserved: number): Result<StockLevel, ValidationError> {
    const issues: { readonly field: string; readonly message: string }[] = [];
    if (!Number.isInteger(onHand) || onHand < 0) {
      issues.push({ field: "onHand", message: "must be a non-negative integer" });
    }
    if (!Number.isInteger(reserved) || reserved < 0) {
      issues.push({ field: "reserved", message: "must be a non-negative integer" });
    }
    if (issues.length === 0 && reserved > onHand) {
      issues.push({ field: "reserved", message: "cannot exceed on-hand" });
    }
    if (issues.length > 0) {
      return err(new ValidationError("Invalid stock level", issues));
    }
    return ok(new StockLevel({ onHand, reserved }));
  }

  static zero(): StockLevel {
    return new StockLevel({ onHand: 0, reserved: 0 });
  }

  get onHand(): number {
    return this.props.onHand;
  }

  get reserved(): number {
    return this.props.reserved;
  }

  get available(): number {
    return this.props.onHand - this.props.reserved;
  }

  receive(quantity: number): StockLevel {
    return new StockLevel({ onHand: this.props.onHand + quantity, reserved: this.props.reserved });
  }

  reserve(quantity: number): StockLevel {
    if (this.available < quantity) {
      throw new BusinessRuleError("Insufficient available stock");
    }
    return new StockLevel({ onHand: this.props.onHand, reserved: this.props.reserved + quantity });
  }

  release(quantity: number): StockLevel {
    const reserved = Math.max(0, this.props.reserved - quantity);
    return new StockLevel({ onHand: this.props.onHand, reserved });
  }

  adjustTo(onHand: number): StockLevel {
    if (onHand < this.props.reserved) {
      throw new BusinessRuleError("Cannot adjust on-hand below reserved");
    }
    return new StockLevel({ onHand, reserved: this.props.reserved });
  }

  /** Fulfills a reservation: on-hand and reserved both drop by `quantity` (ADR-0013 commit step). */
  commit(quantity: number): StockLevel {
    if (this.props.reserved < quantity) {
      throw new BusinessRuleError("Cannot commit more than reserved");
    }
    return new StockLevel({
      onHand: this.props.onHand - quantity,
      reserved: this.props.reserved - quantity,
    });
  }

  /** Removes unreserved on-hand stock (e.g. the out-leg of a warehouse transfer) — available-guarded. */
  remove(quantity: number): StockLevel {
    if (this.available < quantity) {
      throw new BusinessRuleError("Insufficient available stock");
    }
    return new StockLevel({ onHand: this.props.onHand - quantity, reserved: this.props.reserved });
  }
}
