/**
 * A raw inbound broker message. A broker adapter (Redpanda, later) produces these from consumed
 * records; tests construct them directly. `value` is the serialized envelope; `headers` carry the
 * type/version/content-type needed to deserialize.
 */
export interface IncomingMessage {
  readonly topic: string;
  readonly key: string;
  readonly value: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}
