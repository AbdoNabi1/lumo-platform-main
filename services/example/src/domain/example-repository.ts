import type { ExampleAggregate } from "./example-aggregate";

/**
 * Persistence port for {@link ExampleAggregate}. A plain domain-owned interface (the domain stays
 * pure — only `@platform/domain` + its own types). Implemented in infrastructure.
 */
export interface ExampleRepository {
  save(example: ExampleAggregate, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<ExampleAggregate | null>;
}
