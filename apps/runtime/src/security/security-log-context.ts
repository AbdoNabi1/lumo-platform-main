import { traceFields } from "@platform/observability";
import type { LogFields } from "@platform/utils";

/**
 * Structured security log context (H-4 / G-SEC-3). Every security log line carries the correlation /
 * request / principal / tenant ids plus the active **trace/span ids** (via `traceFields()`, so logs join
 * traces), and is passed through {@link redact} so a **secret / token / password / private key** can never
 * be logged even if a caller accidentally includes one. Reuses the platform logger + observability
 * trace-field helper — no new logging engine.
 */
export interface SecurityLogContext {
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly principalId?: string;
  readonly tenantId?: string;
}

/** Field-name patterns that must never appear in logs (defence in depth against accidental leakage). */
const SENSITIVE_KEY =
  /(secret|token|password|passwd|pwd|private[_-]?key|api[_-]?key|authorization|credential|bearer)/i;
const REDACTED = "[redacted]";

/** Returns a copy of `fields` with any sensitive-looking key's value replaced by `[redacted]`. */
export function redact(fields: LogFields): LogFields {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : value;
  }
  return out;
}

/** Builds redacted, trace-correlated log fields from a security context plus optional extra fields. */
export function securityLogFields(context: SecurityLogContext, extra: LogFields = {}): LogFields {
  const base: LogFields = {};
  if (context.correlationId !== undefined) base["correlationId"] = context.correlationId;
  if (context.requestId !== undefined) base["requestId"] = context.requestId;
  if (context.principalId !== undefined) base["principalId"] = context.principalId;
  if (context.tenantId !== undefined) base["tenantId"] = context.tenantId;
  return redact({ ...base, ...traceFields(), ...extra });
}
