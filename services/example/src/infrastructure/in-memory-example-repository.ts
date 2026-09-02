import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { ExampleAggregate } from "../domain/example-aggregate";
import type { ExampleRepository } from "../domain/example-repository";

export interface InMemoryExampleRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory repository for the walking skeleton. On save it persists the aggregate and writes its
 * pulled domain events to the outbox in the same logical unit — the standard outbox pattern (a
 * real adapter does this inside the DB transaction). This is where infrastructure depends on
 * `@platform/messaging`; the application layer never does. Non-business reference only.
 */
export class InMemoryExampleRepository implements ExampleRepository {
  private readonly store = new Map<string, ExampleAggregate>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryExampleRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(example: ExampleAggregate, tx?: unknown): Promise<void> {
    this.store.set(example.id.toString(), example);
    await this.outbox.write(example.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<ExampleAggregate | null> {
    return this.store.get(id) ?? null;
  }
}
