/* eslint-disable no-console */
/**
 * Logging foundation — isomorphic, dependency-free. No business logging.
 * Emits structured JSON; level filtered by LOG_LEVEL (default "info").
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(scope: string): Logger;
}

export interface LoggerOptions {
  readonly scope?: string;
  readonly level?: LogLevel;
  /** Additional field names whose values are redacted before output (merged with the defaults). */
  readonly redact?: readonly string[];
  /** Set `false` to disable the built-in sensitive-key list (defaults to `true`). */
  readonly redactDefaults?: boolean;
}

function resolveLevel(explicit?: LogLevel): LogLevel {
  if (explicit) return explicit;
  const fromEnv =
    typeof process !== "undefined" ? (process.env?.LOG_LEVEL as LogLevel | undefined) : undefined;
  return fromEnv && fromEnv in LEVEL_WEIGHT ? fromEnv : "info";
}

const REDACTED = "[redacted]";

/**
 * Sensitive keys redacted by default (secure-by-default; docs/architecture/14 §2). Matching is
 * case-insensitive and ignores `_`/`-`, so `apiKey`, `api_key`, and `API-KEY` all match.
 * Includes common credential material and directly identifying PII.
 */
export const DEFAULT_REDACT_KEYS: readonly string[] = [
  "password",
  "passphrase",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "apikey",
  "authorization",
  "cookie",
  "setcookie",
  "sessionid",
  "clientsecret",
  "privatekey",
  "email",
  "phone",
  "cardnumber",
  "pan",
  "cvv",
  "ssn",
];

const MAX_REDACT_DEPTH = 8;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively replaces the values of sensitive keys with `[redacted]`. Descends into plain
 * objects and arrays only (class instances, `Date`s, etc. pass through untouched), is
 * cycle-safe, and stops at a bounded depth so pathological inputs cannot stall logging.
 */
function redactValue(
  value: unknown,
  keys: ReadonlySet<string>,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (depth >= MAX_REDACT_DEPTH) return value;
  if (Array.isArray(value)) {
    if (seen.has(value)) return REDACTED;
    seen.add(value);
    return value.map((item) => redactValue(item, keys, depth + 1, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return REDACTED;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = keys.has(normalizeKey(key))
        ? REDACTED
        : redactValue(nested, keys, depth + 1, seen);
    }
    return out;
  }
  return value;
}

function redactFields(fields: LogFields, keys: ReadonlySet<string>): LogFields {
  if (keys.size === 0) return fields;
  return redactValue(fields, keys, 0, new WeakSet()) as LogFields;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const scope = options.scope ?? "app";
  const level = resolveLevel(options.level);
  const redact = new Set(
    [
      ...(options.redactDefaults === false ? [] : DEFAULT_REDACT_KEYS),
      ...(options.redact ?? []),
    ].map(normalizeKey),
  );

  function emit(entryLevel: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_WEIGHT[entryLevel] < LEVEL_WEIGHT[level]) return;
    const record = {
      ts: new Date().toISOString(),
      level: entryLevel,
      scope,
      msg: message,
      ...(fields ? redactFields(fields, redact) : {}),
    };
    const line = JSON.stringify(record);
    if (entryLevel === "error") console.error(line);
    else if (entryLevel === "warn") console.warn(line);
    else console.log(line);
  }

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (childScope) => createLogger({ ...options, scope: `${scope}:${childScope}` }),
  };
}

/** Default root logger. */
export const logger: Logger = createLogger();
