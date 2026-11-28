/**
 * The per-store IP block list (Tracking P1-D9): addresses and ranges whose events the store does not want
 * counted — the merchant's own office, a staff member's phone ("exclude this device"), a known scraper.
 *
 * ## What it is, and the rules around it (owner decisions)
 *
 * - **Manual only.** An entry exists because a person added it. Nothing here blocks automatically, and the bot
 *   score never adds an entry: Egyptian mobile carriers put thousands of real shoppers behind one carrier-grade
 *   NAT address, so a rule that learns "this address is bad" would lock a whole district out.
 * - **Never the business.** The collect route skips a blocked address for ordinary events only; an order or a lead
 *   (`isBusinessConversion`) is accepted whatever the address says.
 * - **Fail open.** If the list cannot be read, nothing is blocked — losing a few page views of a test device is
 *   cheaper than losing a store's traffic to a database blip.
 * - **Guard rails.** Entries are normalised to one spelling (a repeat is a no-op), must be no wider than IPv4 /16 or
 *   IPv6 /32 (a typo can never switch tracking off for the whole shop), and a store holds at most
 *   {@link MAX_BLOCKED_IPS_PER_STORE}.
 *
 * The matcher is cached per store for a short while: the collect route calls it for every event, and a list edit
 * on another instance is picked up within the TTL (this instance sees its own edits at once).
 */

import {
  compileIpMatcher,
  isPublicIp,
  normalizeCidr,
  parseIp,
  type IpMatcher,
} from "../enrichment/ip-cidr";

export const MAX_BLOCKED_IPS_PER_STORE = 500;
export const MAX_NOTE_LENGTH = 200;
const DEFAULT_CACHE_TTL_MS = 30_000;

export interface BlockedIpEntry {
  readonly id: string;
  readonly tenantId: string;
  /** Canonical spelling: `203.0.113.7/32`, `198.51.0.0/16`, `2001:db8::/32`. */
  readonly cidr: string;
  readonly note: string | null;
  readonly createdAt: string;
  /** The staff principal that added it, when known. */
  readonly createdBy: string | null;
}

/** Persistence port. Every method takes the tenant first; an adapter must scope every statement by it. */
export interface BlockedIpStore {
  list(tenantId: string): Promise<readonly BlockedIpEntry[]>;
  /** Idempotent on `(tenantId, cidr)`: a second add returns the stored row with `created: false`. */
  add(
    entry: BlockedIpEntry,
  ): Promise<{ readonly entry: BlockedIpEntry; readonly created: boolean }>;
  /** `true` when a row was removed; `false` when there was none (never an error). */
  remove(tenantId: string, id: string): Promise<boolean>;
  count(tenantId: string): Promise<number>;
}

export type AddBlockedIpResult =
  | { readonly status: "created"; readonly entry: BlockedIpEntry }
  | { readonly status: "exists"; readonly entry: BlockedIpEntry }
  | { readonly status: "invalid"; readonly field: "cidr" | "note" | "ip"; readonly message: string }
  | { readonly status: "limit_reached"; readonly limit: number };

export interface BlockedIpServiceDeps {
  readonly store: BlockedIpStore;
  readonly clock: { now(): Date };
  readonly idGenerator: { generate(): string };
  readonly cacheTtlMs?: number;
  /** A failure that was swallowed (fail open). Receives no addresses. */
  readonly onError?: (error: unknown) => void;
}

interface CachedMatcher {
  readonly matcher: IpMatcher;
  readonly expiresAt: number;
}

export class BlockedIpService {
  private readonly cache = new Map<string, CachedMatcher>();
  private readonly ttl: number;

  constructor(private readonly deps: BlockedIpServiceDeps) {
    this.ttl = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  list(tenantId: string): Promise<readonly BlockedIpEntry[]> {
    return this.deps.store.list(tenantId);
  }

  /** Adds an address or range. Idempotent: the same range in any spelling is `exists`, not a second row. */
  async add(
    tenantId: string,
    input: {
      readonly cidr: string;
      readonly note?: string | null;
      readonly createdBy?: string | null;
    },
  ): Promise<AddBlockedIpResult> {
    const cidr = normalizeCidr(input.cidr);
    if (cidr === null) {
      return {
        status: "invalid",
        field: "cidr",
        message: "Enter an IPv4 or IPv6 address, or a range no wider than /16 (IPv4) or /32 (IPv6)",
      };
    }
    const note = (input.note ?? "").trim();
    if (note.length > MAX_NOTE_LENGTH) {
      return {
        status: "invalid",
        field: "note",
        message: `The note can be at most ${String(MAX_NOTE_LENGTH)} characters`,
      };
    }

    const existing = (await this.deps.store.list(tenantId)).find((entry) => entry.cidr === cidr);
    if (existing !== undefined) return { status: "exists", entry: existing };
    if ((await this.deps.store.count(tenantId)) >= MAX_BLOCKED_IPS_PER_STORE) {
      return { status: "limit_reached", limit: MAX_BLOCKED_IPS_PER_STORE };
    }

    const stored = await this.deps.store.add({
      id: this.deps.idGenerator.generate(),
      tenantId,
      cidr,
      note: note === "" ? null : note,
      createdAt: this.deps.clock.now().toISOString(),
      createdBy: input.createdBy ?? null,
    });
    this.cache.delete(tenantId);
    return { status: stored.created ? "created" : "exists", entry: stored.entry };
  }

  /** "Exclude this device": the caller's own address as a single-host entry. Refuses a non-public address. */
  excludeDevice(
    tenantId: string,
    input: { readonly ip: string | null | undefined; readonly createdBy?: string | null },
  ): Promise<AddBlockedIpResult> {
    const ip = input.ip === null || input.ip === undefined ? null : parseIp(input.ip);
    if (ip === null || !isPublicIp(input.ip)) {
      return Promise.resolve({
        status: "invalid",
        field: "ip",
        message: "Your public IP address could not be determined from this request; add it by hand",
      });
    }
    return this.add(tenantId, {
      cidr: input.ip as string,
      note: "Excluded device",
      createdBy: input.createdBy ?? null,
    });
  }

  /** Removes an entry. Idempotent: removing one that is already gone is not an error. */
  async remove(tenantId: string, id: string): Promise<boolean> {
    const removed = await this.deps.store.remove(tenantId, id);
    this.cache.delete(tenantId);
    return removed;
  }

  /** True when `ip` lies inside any of the store's entries. Fails OPEN: an unreadable list blocks nothing. */
  async isBlocked(tenantId: string, ip: string | null | undefined): Promise<boolean> {
    if (ip === null || ip === undefined || ip === "") return false;
    try {
      return (await this.matcherFor(tenantId))(ip);
    } catch (error) {
      this.deps.onError?.(error);
      return false;
    }
  }

  private async matcherFor(tenantId: string): Promise<IpMatcher> {
    const nowMs = this.deps.clock.now().getTime();
    const cached = this.cache.get(tenantId);
    if (cached !== undefined && cached.expiresAt > nowMs) return cached.matcher;
    const entries = await this.deps.store.list(tenantId);
    const matcher = compileIpMatcher(entries.map((entry) => entry.cidr));
    this.cache.set(tenantId, { matcher, expiresAt: nowMs + this.ttl });
    return matcher;
  }
}

/** In-memory twin of the Postgres store, for unit tests of the service and the routes. */
export class InMemoryBlockedIpStore implements BlockedIpStore {
  private readonly rows = new Map<string, BlockedIpEntry[]>();
  /** Test seam: make every call fail (the fail-open path). */
  failWith: Error | undefined;

  private of(tenantId: string): BlockedIpEntry[] {
    if (this.failWith !== undefined) throw this.failWith;
    let list = this.rows.get(tenantId);
    if (list === undefined) {
      list = [];
      this.rows.set(tenantId, list);
    }
    return list;
  }

  /** Runs a synchronous body as a promise, so a thrown error is a rejection like a real adapter's. */
  private run<T>(body: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      try {
        resolve(body());
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  list(tenantId: string): Promise<readonly BlockedIpEntry[]> {
    return this.run(() =>
      [...this.of(tenantId)].sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      ),
    );
  }

  add(entry: BlockedIpEntry): Promise<{ entry: BlockedIpEntry; created: boolean }> {
    return this.run(() => {
      const list = this.of(entry.tenantId);
      const existing = list.find((row) => row.cidr === entry.cidr);
      if (existing !== undefined) return { entry: existing, created: false };
      list.push(entry);
      return { entry, created: true };
    });
  }

  remove(tenantId: string, id: string): Promise<boolean> {
    return this.run(() => {
      const list = this.of(tenantId);
      const index = list.findIndex((row) => row.id === id);
      if (index < 0) return false;
      list.splice(index, 1);
      return true;
    });
  }

  count(tenantId: string): Promise<number> {
    return this.run(() => this.of(tenantId).length);
  }
}
