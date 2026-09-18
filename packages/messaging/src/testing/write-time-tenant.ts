import type { DomainEvent } from "@platform/domain";
import { InMemoryOutboxStore } from "../outbox/in-memory-outbox-store";
import type { EventContext } from "../outbox/event-context";
import { OutboxWriter } from "../outbox/outbox-writer";

/** One `OutboxWriter.write` call as the repository made it. */
export interface CapturedOutboxWrite {
  readonly events: readonly DomainEvent[];
  readonly context: EventContext;
}

/**
 * An `OutboxWriter` that records what repositories hand it instead of translating/appending.
 * Type-compatible with `OutboxWriter` so it drops into any repository's `outbox` dependency.
 */
export class CapturingOutboxWriter<TTx = unknown> extends OutboxWriter<TTx> {
  readonly writes: CapturedOutboxWrite[] = [];

  constructor() {
    super({
      store: new InMemoryOutboxStore(),
      translator: { translate: () => undefined },
      serializer: {
        contentType: "application/json",
        serialize: () => ({ contentType: "application/json", body: "" }) as never,
        deserialize: () => ({}) as never,
      },
      clock: { now: () => new Date(0) },
    });
  }

  override write(events: readonly DomainEvent[], context: EventContext): Promise<void> {
    this.writes.push({ events: [...events], context });
    return Promise.resolve();
  }
}

/**
 * ADR-0014 (amended 2026-09-18): the per-call `tenantId` must reach the event envelope, not only
 * the repository query. Every converted context's suite calls this once.
 *
 * `scenario` builds the repository around the supplied `outbox` (with a *singleton* composition-time
 * context that carries no tenant) and performs one save/append that emits at least one domain event
 * under `tenantId`. The helper runs it for two tenants and asserts each write carried its own
 * tenant — not the other's, and not none.
 *
 * Limitation: it only guards contexts whose suite calls it. Contexts that forget are caught by the
 * write-site check in docs/plans/phase-7/WP-10-multi-tenant-runtime.md (T10.3 done-criterion).
 */
export async function assertWriteTimeTenant(
  contextName: string,
  scenario: (outbox: CapturingOutboxWriter, tenantId: string) => Promise<void>,
): Promise<void> {
  for (const tenantId of ["tenant-a", "tenant-b"]) {
    const outbox = new CapturingOutboxWriter();
    await scenario(outbox, tenantId);
    const withEvents = outbox.writes.filter((w) => w.events.length > 0);
    if (withEvents.length === 0) {
      throw new Error(
        `${contextName}: scenario for ${tenantId} wrote no events to the outbox — the assertion would be vacuous.`,
      );
    }
    for (const write of withEvents) {
      if (write.context.tenantId !== tenantId) {
        throw new Error(
          `${contextName}: event written under ${tenantId} reached the outbox with tenantId ` +
            `${String(write.context.tenantId)} (ADR-0014: merge the per-call tenantId at write time).`,
        );
      }
    }
  }
}
