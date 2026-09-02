/**
 * Thrown inside an atomic-path transaction (`EventHandler.handleAtomic`) when `recordIfNew` loses
 * the insert race to a concurrent redelivery. Throwing rolls back the handler's domain write in
 * the same transaction — the whole point of the atomic path (ADR-0005, Sprint A0): the marker and
 * the domain effect must commit together or not at all, never the marker alone. Callers catch this
 * specifically to treat it as a benign duplicate, not a handler failure (no retry, no DLQ).
 */
export class DuplicateProcessedEventError extends Error {
  constructor(readonly messageId: string) {
    super(`integration event ${messageId} was concurrently processed twice`);
    this.name = "DuplicateProcessedEventError";
  }
}
