/** Global error utilities (foundation only — no feature-specific errors). */

export interface AppErrorOptions {
  readonly code?: string;
  readonly cause?: unknown;
  readonly context?: Record<string, unknown>;
}

/** Base application error. Domain/feature errors extend this in later sprints. */
export class AppError extends Error {
  readonly code: string;
  readonly context?: Record<string, unknown>;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = this.constructor.name;
    this.code = options.code ?? "APP_ERROR";
    this.context = options.context;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Narrow an unknown thrown value to an Error. */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === "string" ? value : "Unknown error", { cause: value });
}

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
}

/** Safe, transport-friendly shape — never leak stack traces or PII to clients. */
export function toSerializableError(value: unknown): SerializedError {
  if (isAppError(value)) return { name: value.name, message: value.message, code: value.code };
  const err = toError(value);
  return { name: err.name, message: err.message };
}

/** Invariant assertion that narrows types and throws on failure. */
export function invariant(condition: unknown, message = "Invariant violation"): asserts condition {
  if (!condition) throw new AppError(message, { code: "INVARIANT" });
}

/** Exhaustiveness helper for switch statements. */
export function assertNever(value: never, message = "Unexpected variant"): never {
  throw new AppError(`${message}: ${String(value)}`, { code: "UNREACHABLE" });
}
