import type { IntegrationEvent } from "./integration-event";
import type { EventSerializer, SerializedEnvelope } from "./serializer";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Production JSON `EventSerializer`. Encodes the integration-event envelope to UTF-8 JSON bytes —
 * **byte-identical** to the envelope format already verified in production through the Worker and
 * the Debezium/CDC pipeline. The `contentType` is preserved verbatim as the frozen wire-format
 * identifier; changing it would alter every outbox row and broker header. The Avro/Protobuf
 * serializer replaces this behind the same contract in the schema-registry sprint (D-050), which is
 * the sanctioned point to evolve the wire format and its content type.
 */
export class JsonEventSerializer implements EventSerializer {
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
