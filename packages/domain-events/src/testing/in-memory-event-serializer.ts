import type { IntegrationEvent } from "../integration-event";
import type { EventSerializer, SerializedEnvelope } from "../serializer";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * **Test-only** `EventSerializer`. Encodes the envelope to UTF-8 bytes via `JSON` solely so tests
 * can exercise the full serialize → transport → deserialize path deterministically. This is **not**
 * a production wire format — production uses Avro/Protobuf (added in the broker-wiring sprint).
 * Exposed under `@platform/domain-events/testing`; never import it from production code.
 */
export class InMemoryEventSerializer implements EventSerializer {
  readonly contentType = "application/x-in-memory-json";

  serialize<TPayload>(event: IntegrationEvent<TPayload>): SerializedEnvelope {
    return {
      type: event.type,
      eventVersion: event.eventVersion,
      contentType: this.contentType,
      data: encoder.encode(JSON.stringify(event)),
    };
  }

  deserialize<TPayload>(serialized: SerializedEnvelope): IntegrationEvent<TPayload> {
    return JSON.parse(decoder.decode(serialized.data)) as IntegrationEvent<TPayload>;
  }
}
