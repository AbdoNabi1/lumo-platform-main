export interface RetryPolicyOptions {
  /** Total attempts before dead-lettering (>= 1). */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  /** Growth factor per attempt (>= 1). */
  readonly factor: number;
  readonly maxDelayMs: number;
  /** Jitter source returning [0, 1); injected for deterministic tests (default `Math.random`). */
  readonly jitter?: () => number;
}

/**
 * Bounded exponential backoff with jitter (docs/architecture/05 §2). Pure and deterministic given
 * the jitter source. The delay grows as `baseDelayMs * factor^(attempt-1)`, capped at `maxDelayMs`,
 * then scaled to 50%–100% by jitter to avoid thundering herds.
 */
export class RetryPolicy {
  readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly factor: number;
  private readonly maxDelayMs: number;
  private readonly jitter: () => number;

  constructor(options: RetryPolicyOptions) {
    if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
      throw new Error("RetryPolicy: maxAttempts must be an integer >= 1.");
    }
    if (options.baseDelayMs < 0 || options.maxDelayMs < 0) {
      throw new Error("RetryPolicy: delays must be >= 0.");
    }
    if (options.factor < 1) {
      throw new Error("RetryPolicy: factor must be >= 1.");
    }
    this.maxAttempts = options.maxAttempts;
    this.baseDelayMs = options.baseDelayMs;
    this.factor = options.factor;
    this.maxDelayMs = options.maxDelayMs;
    this.jitter = options.jitter ?? Math.random;
  }

  /** Delay in ms before the given 1-based attempt. */
  delayForAttempt(attempt: number): number {
    if (!Number.isInteger(attempt) || attempt < 1) {
      throw new Error("RetryPolicy: attempt must be an integer >= 1.");
    }
    const exponential = this.baseDelayMs * Math.pow(this.factor, attempt - 1);
    const capped = Math.min(exponential, this.maxDelayMs);
    return Math.round(capped * (0.5 + this.jitter() * 0.5));
  }
}
