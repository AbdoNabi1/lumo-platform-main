import type { IntegrationEvent } from "@platform/domain-events";
import type { EventHandler } from "@platform/messaging";

interface ExampleRegisteredPayload {
  readonly label: string;
}

/**
 * Reference consumer for the walking skeleton: reacts to `example.example.registered.v1` and
 * records handled labels so the end-to-end test can assert the event propagated. Non-business.
 */
export class ExampleRegisteredConsumer implements EventHandler<ExampleRegisteredPayload> {
  readonly eventType = "example.example.registered";
  readonly eventVersion = 1;
  readonly handledLabels: string[] = [];

  async handle(event: IntegrationEvent<ExampleRegisteredPayload>): Promise<void> {
    this.handledLabels.push(event.payload.label);
  }
}
