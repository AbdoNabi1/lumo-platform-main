import { ConcurrencyError, ConflictError } from "@platform/utils";
import { err, type Result } from "@platform/types";
import { metaConflictCodeOf } from "./error-codes";
import type { OutreachEventInput, OutreachEventPayloads, OutreachEventType } from "./events";
import type { OutreachDeps } from "./outreach-deps";

export const conflict = (code: string): ConflictError => new ConflictError(code);
export const conflictErr = (code: string): Result<never, ConflictError> => err(conflict(code));

/** The Meta adapter's error, matched structurally (the application layer never imports the adapter). */
export interface MetaErrorLike {
  code: string;
  httpStatus: number;
}

export function isMetaError(e: unknown): e is MetaErrorLike & Error {
  return (
    e instanceof Error &&
    e.name === "MetaApiError" &&
    typeof (e as { code?: unknown }).code === "string" &&
    typeof (e as { httpStatus?: unknown }).httpStatus === "number"
  );
}

/** `META_<code>` for a validated provider code, else `META_ERROR`: provider text never leaves the adapter. */
export function metaConflictCode(e: MetaErrorLike): string {
  return metaConflictCodeOf(e.code);
}

export { safeCode } from "./error-codes";

export function isConcurrency(e: unknown): boolean {
  return e instanceof ConcurrencyError;
}

/** What emitting an event needs (the recovery wiring has no ports, vault or repositories beyond these). */
export type EventDeps = Pick<OutreachDeps, "idGenerator" | "clock" | "events">;

export async function emit<T extends OutreachEventType>(
  deps: EventDeps,
  tx: unknown,
  tenantId: string,
  type: T,
  aggregateId: string,
  payload: OutreachEventPayloads[T],
): Promise<void> {
  const event = {
    tenantId,
    type,
    eventId: deps.idGenerator.generate(),
    aggregateId,
    occurredAt: deps.clock.now(),
    payload,
  } as OutreachEventInput;
  await deps.events.emit(event, tx);
}

export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The 24 h customer-service window is open iff `0 <= now - lastInboundAt < 24h` (exactly 24 h is closed). */
export function sessionWindowOpen(lastInboundAt: Date | null, now: Date): boolean {
  if (lastInboundAt === null) return false;
  const age = now.getTime() - lastInboundAt.getTime();
  return age >= 0 && age < SESSION_WINDOW_MS;
}

/** Display name for the From header: strip `" < > \r \n`, trim; empty falls back to "Store". */
export function emailDisplayName(storeName: string): string {
  const cleaned = storeName.replace(/["<>\r\n]/g, "").trim();
  return cleaned.length === 0 ? "Store" : cleaned;
}

const EMAIL_PATTERN = /^[^\s@<>",;:()[\]\\]+@[^\s@<>",;:()[\]\\]+\.[^\s@<>",;:()[\]\\]+$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL_PATTERN.test(e) ? e : null;
}
