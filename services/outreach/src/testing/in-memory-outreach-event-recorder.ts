import type { OutreachEventInput, OutreachEventSink } from "../application/events";

/**
 * Records every emitted event. Tests and local (no Prisma) wiring only; production wiring with Prisma uses the outbox
 * sink. When a transaction context is passed and it can roll back (`undo` list, as the in-memory unit of work), the
 * recorded event is dropped on rollback so a rolled-back transaction leaves no event behind.
 */
export class InMemoryOutreachEventRecorder implements OutreachEventSink {
  readonly calls: OutreachEventInput[] = [];

  emit(e: OutreachEventInput, tx?: unknown): Promise<void> {
    this.calls.push(e);
    const undo = (tx as { undo?: Array<() => void> } | undefined)?.undo;
    if (Array.isArray(undo)) {
      undo.push(() => {
        const idx = this.calls.indexOf(e);
        if (idx >= 0) this.calls.splice(idx, 1);
      });
    }
    return Promise.resolve();
  }

  ofType<T extends OutreachEventInput["type"]>(
    type: T,
  ): Array<Extract<OutreachEventInput, { type: T }>> {
    return this.calls.filter((c): c is Extract<OutreachEventInput, { type: T }> => c.type === type);
  }
}
