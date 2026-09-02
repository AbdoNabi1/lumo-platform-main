/**
 * Write-key → tenant resolution.
 *
 * The collector endpoint is public and unauthenticated: anyone can POST to it. The write key is the
 * only thing that says which merchant an event belongs to, and it is **not** a secret — it ships in
 * browser JavaScript and is trivially readable. So it is an *identifier*, not a credential, and this
 * registry treats it as one: it maps a key to a tenant and nothing more. It grants no authority
 * beyond "these events are filed under this tenant", which is exactly the authority a public beacon
 * needs and no more.
 *
 * What matters is that the mapping is **server-side**. A body-supplied tenant would let any visitor
 * write events into any merchant's account, and every such event would look well-formed forever.
 *
 * Rate limiting and abuse control belong in front of this (the edge/CDN tier), not here — a write
 * key cannot defend itself, and pretending otherwise would be security theatre.
 */

import type { WriteKeyResolverPort } from "@platform/tracking";

export interface WriteKeyBinding {
  readonly writeKey: string;
  readonly tenantId: string;
  readonly storeId?: string;
}

/**
 * In-memory registry loaded at boot.
 *
 * Deliberately not a database read on the hot path: the mapping is small, changes rarely, and a
 * per-request query would put Postgres in the path of every browser beacon. When merchant
 * self-service key management arrives it should reload on an interval and swap atomically — the
 * same construction the tracking registry uses (`TrackingRegistryHandle`), for the same reason.
 */
export class WriteKeyRegistry implements WriteKeyResolverPort {
  private readonly bindings: ReadonlyMap<string, WriteKeyBinding>;

  constructor(bindings: readonly WriteKeyBinding[]) {
    const map = new Map<string, WriteKeyBinding>();
    for (const binding of bindings) {
      if (map.has(binding.writeKey)) {
        // Two tenants claiming one key is unresolvable, and picking either silently misfiles one
        // merchant's conversions into another's account. Refuse to start instead.
        throw new Error(
          `collector: write key "${binding.writeKey}" is bound to more than one tenant — ` +
            `a duplicate key cannot be resolved and would misfile events`,
        );
      }
      map.set(binding.writeKey, binding);
    }
    this.bindings = map;
  }

  resolve(writeKey: string): { readonly tenantId: string; readonly storeId?: string } | null {
    const binding = this.bindings.get(writeKey);
    if (binding === undefined) return null;
    return {
      tenantId: binding.tenantId,
      ...(binding.storeId === undefined ? {} : { storeId: binding.storeId }),
    };
  }

  get size(): number {
    return this.bindings.size;
  }
}

/**
 * Parses the `COLLECTOR_WRITE_KEYS` binding list: `key:tenant[:store]`, comma-separated.
 *
 * Refuses an empty or malformed configuration rather than starting with zero bindings. A collector
 * with no write keys accepts nothing — it would answer every beacon with a refusal while reporting
 * itself healthy, which is a total capture outage that looks like a quiet day.
 */
export function parseWriteKeyBindings(raw: string): readonly WriteKeyBinding[] {
  const bindings: WriteKeyBinding[] = [];

  for (const entry of raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")) {
    const [writeKey, tenantId, storeId] = entry.split(":").map((part) => part.trim());
    if (writeKey === undefined || writeKey === "" || tenantId === undefined || tenantId === "") {
      throw new Error(
        `collector: malformed write-key binding "${entry}" — expected "writeKey:tenantId[:storeId]"`,
      );
    }
    bindings.push({
      writeKey,
      tenantId,
      ...(storeId === undefined || storeId === "" ? {} : { storeId }),
    });
  }

  if (bindings.length === 0) {
    throw new Error(
      "collector: COLLECTOR_WRITE_KEYS is empty — the collector would refuse every event while " +
        "reporting itself healthy. Configure at least one binding.",
    );
  }

  return bindings;
}
