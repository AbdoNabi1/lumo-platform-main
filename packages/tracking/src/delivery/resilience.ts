/**
 * Circuit breaking and rate limiting (directive §Retry Engine).
 *
 * Backoff itself is **not** implemented here — `RetryPolicy` in `@platform/messaging` already owns
 * bounded exponential backoff with jitter, and this module composes it rather than duplicating it.
 * What is genuinely absent from messaging, and added here, is per-destination circuit breaking and
 * rate limiting: both are properties of an *external vendor endpoint*, not of the internal bus.
 *
 * Both are pure state machines with an injected clock — no timers, no I/O — so a breaker's
 * behaviour over hours is testable in microseconds and replays identically.
 */

import type { CircuitBreakerDescriptor, RateLimitDescriptor } from "./destination";

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

export type CircuitStatus = "closed" | "open" | "half_open";

export interface CircuitState {
  readonly status: CircuitStatus;
  readonly consecutiveFailures: number;
  readonly halfOpenSuccesses: number;
  /** Epoch ms when an open circuit may next be probed. */
  readonly openedUntilMs?: number;
  readonly lastTransitionAtMs?: number;
}

export const INITIAL_CIRCUIT: CircuitState = {
  status: "closed",
  consecutiveFailures: 0,
  halfOpenSuccesses: 0,
};

/**
 * Whether a call may proceed. An open circuit becomes half-open once its reset window elapses —
 * evaluated lazily here rather than by a timer, which is what keeps the state machine pure.
 */
export function canAttempt(state: CircuitState, nowMs: number): boolean {
  if (state.status === "closed" || state.status === "half_open") return true;
  return state.openedUntilMs !== undefined && nowMs >= state.openedUntilMs;
}

/** Transitions an open circuit to half-open once its window has elapsed. */
export function refreshCircuit(state: CircuitState, nowMs: number): CircuitState {
  if (state.status !== "open") return state;
  if (state.openedUntilMs === undefined || nowMs < state.openedUntilMs) return state;

  return {
    ...state,
    status: "half_open",
    halfOpenSuccesses: 0,
    lastTransitionAtMs: nowMs,
  };
}

export function recordSuccess(
  state: CircuitState,
  descriptor: CircuitBreakerDescriptor,
  nowMs: number,
): CircuitState {
  if (state.status === "half_open") {
    const successes = state.halfOpenSuccesses + 1;
    // Only close after sustained recovery: closing on a single probe flaps straight back open
    // and hammers a vendor that is still degraded.
    if (successes >= descriptor.halfOpenSuccesses) {
      return { ...INITIAL_CIRCUIT, lastTransitionAtMs: nowMs };
    }
    return { ...state, halfOpenSuccesses: successes };
  }

  return { ...state, status: "closed", consecutiveFailures: 0, halfOpenSuccesses: 0 };
}

export function recordFailure(
  state: CircuitState,
  descriptor: CircuitBreakerDescriptor,
  nowMs: number,
): CircuitState {
  // A failure while probing re-opens immediately — the vendor has not recovered.
  if (state.status === "half_open") {
    return {
      status: "open",
      consecutiveFailures: state.consecutiveFailures + 1,
      halfOpenSuccesses: 0,
      openedUntilMs: nowMs + descriptor.resetTimeoutMs,
      lastTransitionAtMs: nowMs,
    };
  }

  const failures = state.consecutiveFailures + 1;
  if (failures >= descriptor.failureThreshold) {
    return {
      status: "open",
      consecutiveFailures: failures,
      halfOpenSuccesses: 0,
      openedUntilMs: nowMs + descriptor.resetTimeoutMs,
      lastTransitionAtMs: nowMs,
    };
  }

  return { ...state, status: "closed", consecutiveFailures: failures };
}

// ---------------------------------------------------------------------------
// Rate limiting — token bucket
// ---------------------------------------------------------------------------

export interface RateLimitState {
  readonly tokens: number;
  readonly lastRefillMs: number;
}

export function initialRateLimit(descriptor: RateLimitDescriptor, nowMs: number): RateLimitState {
  return { tokens: descriptor.burst, lastRefillMs: nowMs };
}

/** Refills the bucket for elapsed time, capped at burst. */
export function refill(
  state: RateLimitState,
  descriptor: RateLimitDescriptor,
  nowMs: number,
): RateLimitState {
  const elapsedMs = Math.max(0, nowMs - state.lastRefillMs);
  const replenished = (elapsedMs / 1000) * descriptor.requestsPerSecond;

  return {
    tokens: Math.min(descriptor.burst, state.tokens + replenished),
    lastRefillMs: nowMs,
  };
}

export type RateLimitDecision =
  | { readonly allowed: true; readonly state: RateLimitState }
  | { readonly allowed: false; readonly state: RateLimitState; readonly retryAfterMs: number };

/**
 * Consumes one token. When the bucket is empty the caller is told **how long to wait** rather than
 * simply refused — a delivery worker that knows the wait can reschedule instead of spinning.
 */
export function consumeToken(
  state: RateLimitState,
  descriptor: RateLimitDescriptor,
  nowMs: number,
): RateLimitDecision {
  const refilled = refill(state, descriptor, nowMs);

  if (refilled.tokens >= 1) {
    return { allowed: true, state: { ...refilled, tokens: refilled.tokens - 1 } };
  }

  const deficit = 1 - refilled.tokens;
  const retryAfterMs = Math.ceil((deficit / descriptor.requestsPerSecond) * 1000);
  return { allowed: false, state: refilled, retryAfterMs };
}
