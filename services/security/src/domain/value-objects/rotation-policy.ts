import { ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

export interface RotationPolicyProps {
  /** Days between scheduled rotations. */
  readonly intervalDays: number;
  /** Seconds a rotated credential stays valid after rotation (overlap window). */
  readonly graceSeconds: number;
  /** When true, a due credential is rotated automatically by the scheduler. */
  readonly autoRotate: boolean;
}

/**
 * A **rotation policy** for a credential (sprint P2.0-C §7) — how often it rotates, how long the
 * superseded credential stays valid (grace/overlap so callers aren't cut off mid-flight), and
 * whether rotation is automatic. Immutable value object; the durable scheduler consumes it.
 */
export class RotationPolicy extends ValueObject<RotationPolicyProps> {
  private constructor(props: RotationPolicyProps) {
    super(props);
  }

  static create(props: RotationPolicyProps): Result<RotationPolicy, ValidationError> {
    if (!Number.isInteger(props.intervalDays) || props.intervalDays <= 0) {
      return err(
        new ValidationError("rotation interval is invalid", [
          { field: "intervalDays", message: "must be a positive integer" },
        ]),
      );
    }
    if (!Number.isInteger(props.graceSeconds) || props.graceSeconds < 0) {
      return err(
        new ValidationError("rotation grace is invalid", [
          { field: "graceSeconds", message: "must be a non-negative integer" },
        ]),
      );
    }
    return ok(new RotationPolicy({ ...props }));
  }

  get intervalDays(): number {
    return this.props.intervalDays;
  }
  get graceSeconds(): number {
    return this.props.graceSeconds;
  }
  get autoRotate(): boolean {
    return this.props.autoRotate;
  }

  /** Next rotation due time from a base instant. */
  nextDue(from: Date): Date {
    return new Date(from.getTime() + this.props.intervalDays * 86_400_000);
  }
}
