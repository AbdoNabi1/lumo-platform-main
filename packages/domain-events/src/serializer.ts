import type { IntegrationEvent } from "./integration-event";

/** A serialized envelope ready for transport — the broker record value plus routing descriptors. */
export interface SerializedEnvelope {
  /** Event type `<context>.<aggregate>.<event>` (used to select the schema on deserialize). */
  readonly type: string;
  /** Schema version. */
  readonly eventVersion: number;
  /** Serializer content type, e.g. `avro/binary` in production. */
  readonly contentType: string;
  /** The serialized envelope bytes (the broker record value). */
  readonly data: Uint8Array;
}

/**
 * Serializes / deserializes the integration-event envelope to and from transport bytes.
 *
 * The **production** implementation (Avro/Protobuf via the schema registry) is added in the
 * broker-wiring sprint; it is intentionally left unimplemented here. Tests use
 * `InMemoryEventSerializer` from `@platform/domain-events/testing`. The envelope contract is
 * already Avro-compatible, so adding the production serializer requires no envelope migration.
 */
export interface EventSerializer {
  /** Identifies the wire format produced by this serializer. */
  readonly contentType: string;
  serialize<TPayload>(event: IntegrationEvent<TPayload>): SerializedEnvelope;
  deserialize<TPayload>(serialized: SerializedEnvelope): IntegrationEvent<TPayload>;
}
