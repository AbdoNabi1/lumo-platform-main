import { ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

export type ResolutionOutcome = "refund" | "replacement" | "repair";

interface RefundDecisionProps {
  readonly outcome: ResolutionOutcome;
  readonly amountMinor?: number;
  readonly currency?: string;
}

/**
 * The chosen resolution for an accepted return — refund/replacement/repair. For `refund`, the
 * amount is caller-provided (never calculated by Returns; Returns prices nothing).
 */
export class RefundDecision extends ValueObject<RefundDecisionProps> {
  static create(
    outcome: ResolutionOutcome,
    amountMinor?: number,
    currency?: string,
  ): Result<RefundDecision, ValidationError> {
    if (outcome === "refund" && (amountMinor === undefined || currency === undefined)) {
      return err(
        new ValidationError("Invalid refund decision", [
          { field: "amountMinor", message: "amountMinor and currency are required for a refund" },
        ]),
      );
    }
    return ok(new RefundDecision({ outcome, amountMinor, currency }));
  }

  get outcome(): ResolutionOutcome {
    return this.props.outcome;
  }

  get amountMinor(): number | undefined {
    return this.props.amountMinor;
  }

  get currency(): string | undefined {
    return this.props.currency;
  }
}
