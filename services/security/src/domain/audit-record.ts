/**
 * A single **WORM audit record** — one link in an append-only, hash-chained ledger (SOC2 CC7 /
 * ISO 27001 A.12.4 / PCI DSS 10.x; extends ADR-0009's deferred archival hash-chain). Immutable by
 * construction: every field is readonly and the instance is frozen. `hash` binds the record's
 * content to `prevHash`, so any later tampering breaks the chain. `signature` is reserved for
 * signed records (a signing provider is wired later — the shape is ready now).
 */
export interface AuditRecordContent {
  readonly sequence: number;
  readonly principalRef: string;
  /** The action/permission evaluated, `"<resource>:<action>"` or a canonical security event name. */
  readonly action: string;
  /** The recorded outcome — `allow` / `deny` / `challenge` / `block` / `review` / event status. */
  readonly decision: string;
  readonly resource: string | null;
  readonly tenantRef: string | null;
  /** RFC 3339 UTC timestamp, caller-supplied (deterministic in tests). */
  readonly occurredAt: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly prevHash: string;
}

export class AuditRecord {
  readonly id: string;
  readonly content: AuditRecordContent;
  readonly hash: string;
  readonly signature: string | null;

  constructor(props: {
    id: string;
    content: AuditRecordContent;
    hash: string;
    signature?: string | null;
  }) {
    this.id = props.id;
    this.content = Object.freeze({
      ...props.content,
      metadata: Object.freeze({ ...props.content.metadata }),
    });
    this.hash = props.hash;
    this.signature = props.signature ?? null;
    Object.freeze(this);
  }

  get sequence(): number {
    return this.content.sequence;
  }
  get prevHash(): string {
    return this.content.prevHash;
  }
}

/** The canonical, order-stable serialization hashed for chain integrity (sorted metadata keys). */
export function canonicalizeAuditContent(content: AuditRecordContent): string {
  const metadata = Object.keys(content.metadata)
    .sort()
    .map((key) => [key, content.metadata[key]] as const);
  return JSON.stringify({
    sequence: content.sequence,
    principalRef: content.principalRef,
    action: content.action,
    decision: content.decision,
    resource: content.resource,
    tenantRef: content.tenantRef,
    occurredAt: content.occurredAt,
    metadata,
    prevHash: content.prevHash,
  });
}
