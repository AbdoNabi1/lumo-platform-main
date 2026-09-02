import { ValueObject } from "@platform/domain";

interface DeliveryPolicyProps {
  readonly maxAttempts: number;
  readonly expiresAt?: Date;
}

/** Governs how many times and how long a notification may be retried — exponential backoff, no side effects. */
export class DeliveryPolicy extends ValueObject<DeliveryPolicyProps> {
  static create(maxAttempts: number, expiresAt?: Date): DeliveryPolicy {
    return new DeliveryPolicy({ maxAttempts, expiresAt });
  }

  get maxAttempts(): number {
    return this.props.maxAttempts;
  }

  get expiresAt(): Date | undefined {
    return this.props.expiresAt;
  }

  /** Exponential backoff in milliseconds for the given 1-indexed attempt number. */
  backoffForAttempt(attempt: number): number {
    return 1_000 * 2 ** Math.max(0, attempt - 1);
  }

  isExhausted(attemptCount: number): boolean {
    return attemptCount >= this.props.maxAttempts;
  }

  isExpiredAt(now: Date): boolean {
    return this.props.expiresAt !== undefined && now.getTime() >= this.props.expiresAt.getTime();
  }
}
