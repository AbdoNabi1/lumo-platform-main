import { AggregateRoot, type UniqueEntityId } from "@platform/domain";
import { ExampleRegistered } from "./example-registered.event";

interface ExampleProps {
  readonly label: string;
}

/**
 * Reference aggregate for the walking skeleton — NOT a business concept. It exists only to prove
 * the architecture wires end to end. The identity, event id, and timestamp are supplied by the
 * application layer (the domain stays pure and deterministic).
 */
export class ExampleAggregate extends AggregateRoot<ExampleProps> {
  static register(
    id: UniqueEntityId,
    label: string,
    eventId: string,
    occurredAt: Date,
  ): ExampleAggregate {
    const example = new ExampleAggregate({ label }, id);
    example.addDomainEvent(new ExampleRegistered({ eventId, aggregateId: id, occurredAt }, label));
    return example;
  }

  get label(): string {
    return this.props.label;
  }
}
