import { DomainEvent, type DomainEventProps } from "@platform/domain";

/**
 * Reference domain event for the walking skeleton — NOT a business event. Metadata is supplied
 * (the domain neither generates ids nor reads the clock), keeping it deterministic.
 */
export class ExampleRegistered extends DomainEvent {
  readonly eventName = "example.registered";
  readonly label: string;

  constructor(props: DomainEventProps, label: string) {
    super(props);
    this.label = label;
  }
}
