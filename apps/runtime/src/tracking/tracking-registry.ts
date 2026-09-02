/**
 * Production registry adapters for tracking (M6.6.2).
 *
 * Until now the runtime resolved destinations and mapping profiles from `SEED_DESTINATIONS` —
 * static objects compiled into the binary. That is development seed data wearing a registry's
 * clothes: an operator could not add a destination, roll one back, or deprecate one without a
 * deployment, and replay could not resolve a historical configuration version because only one
 * version ever existed. This module makes the Registry the single source of truth.
 *
 * ## Why the ports are synchronous and the store is not
 *
 * `DestinationRegistryPort.resolve` returns a definition, not a promise, because it is called
 * per-destination on the delivery hot path and inside `route()`, which is pure. So the durable rows
 * are loaded once into an in-memory {@link Registry} and served from there.
 *
 * The result is a **snapshot in the strict sense: it is immutable once constructed.** Picking up new
 * definitions means building a new instance and swapping the reference a `TrackingRegistryHandle`
 * holds — see `tracking-registry-handle.ts`. This class deliberately has no `reload`: an in-place
 * refresh would change the definitions under an event already mid-pipeline, which is how a record
 * ends up routed by one rule set version and stamped with another's.
 *
 * ## Why version parity is asserted rather than assumed
 *
 * `Registry.register` mints `previous + 1`. Replaying persisted rows through it therefore only
 * reproduces the stored version numbers if those numbers are contiguous from 1. A gap — a row
 * deleted, a partial restore — would silently renumber everything above it, and a replay of an
 * event pinned to destination version 4 would resolve the configuration that is really version 5.
 * Nothing downstream could detect that: the replay would succeed and send bytes against settings
 * the event never ran under. So {@link buildSnapshot} verifies that every minted version equals its
 * stored version and refuses to build otherwise. A boot failure is the correct outcome; a quietly
 * renumbered registry is not.
 */

import type { Database } from "@platform/db";
import type { IdGenerator } from "@platform/contracts";
import { Registry } from "@platform/registry";
import type { RuleSet } from "@platform/rules";
import type {
  DestinationDefinition,
  DestinationKey,
  DestinationRegistryPort,
  MappingProfile,
  MappingRegistryPort,
  RuleSetRegistryPort,
  VersionResolverPort,
} from "@platform/tracking";

/**
 * The definition kinds the tracking engine executes against.
 *
 * `TrackingRegistryEntry.kind` is a free-text discriminator, so new kinds need no migration and
 * inherit the immutable-version, lifecycle and parity guarantees the existing kinds already have.
 *
 * **P1.3 scope note.** The `event_definition` and `parameter` kinds (P5.5) are deliberately absent
 * from this list. Their types (`EventDefinition`, `ParameterDefinition`) live in
 * `packages/tracking/src/definitions/{event-definition,parameter}.ts`, which K7 deferred for lack of
 * primary-source evidence (`K7_FINAL_RECONCILIATION_REPORT.md`). Nothing on the ingest path reads
 * them: `ingestTrackingEvent` resolves only destinations, mappings and rule sets. Rows of those
 * kinds, if any were ever written, are simply not projected into the snapshot — the store's schema
 * and parity checks are untouched, so re-adding the two kinds later is a one-line change here plus
 * the two registries, with no migration and no data change.
 */
export const REGISTRY_KINDS = ["destination", "mapping", "rule_set"] as const;
export type TrackingRegistryKind = (typeof REGISTRY_KINDS)[number];

/** One persisted, immutable definition version, as stored and as read back. */
export interface TrackingRegistryRow {
  readonly kind: string;
  readonly key: string;
  readonly version: number;
  readonly status: string;
  readonly value: unknown;
}

type RegistryDb = Database & {
  trackingRegistryEntry: {
    create(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<TrackingRegistryRow[]>;
    findFirst(args: unknown): Promise<{ readonly registeredAt: Date } | null>;
    count(args: unknown): Promise<number>;
  };
};

/**
 * Durable store for registry definitions.
 *
 * Writes are `create` only, mirroring the Event Record store: a definition version is immutable
 * once written, and "editing" a destination means registering the next version. That is what makes
 * `resolveVersion` meaningful six months later.
 */
export class PrismaTrackingRegistryStore {
  constructor(
    private readonly db: RegistryDb,
    private readonly idGenerator: IdGenerator,
  ) {}

  async loadAll(tenantId: string): Promise<readonly TrackingRegistryRow[]> {
    return this.db.trackingRegistryEntry.findMany({
      where: { tenantId },
      orderBy: [{ kind: "asc" }, { key: "asc" }, { version: "asc" }],
    });
  }

  async count(tenantId: string): Promise<number> {
    return this.db.trackingRegistryEntry.count({ where: { tenantId } });
  }

  /**
   * The change fingerprint the hot-reload watcher polls.
   *
   * Two indexed queries rather than reading every row: the watcher runs on an interval forever, and
   * a full table read plus a registry rebuild every tick would be real load in exchange for nothing
   * — the vast majority of ticks find no change at all. See `RegistrySignal` for what this can and
   * cannot detect.
   */
  async signal(tenantId: string): Promise<{ readonly count: number; readonly latestAt: number }> {
    const [count, newest] = await Promise.all([
      this.db.trackingRegistryEntry.count({ where: { tenantId } }),
      this.db.trackingRegistryEntry.findFirst({
        where: { tenantId },
        orderBy: { registeredAt: "desc" },
        select: { registeredAt: true },
      }),
    ]);

    return { count, latestAt: newest === null ? 0 : newest.registeredAt.getTime() };
  }

  /** Appends the next version of a definition. Never updates an existing row. */
  async append(input: {
    readonly tenantId: string;
    readonly kind: TrackingRegistryKind;
    readonly key: string;
    readonly version: number;
    readonly status: string;
    readonly value: unknown;
    readonly at: Date;
  }): Promise<void> {
    await this.db.trackingRegistryEntry.create({
      data: {
        id: this.idGenerator.generate(),
        tenantId: input.tenantId,
        kind: input.kind,
        key: input.key,
        version: input.version,
        status: input.status,
        value: input.value,
        registeredAt: input.at,
      },
    });
  }
}

/** Thrown when persisted versions cannot be reproduced faithfully — see the module note. */
export class RegistryVersionParityError extends Error {
  constructor(kind: string, key: string, stored: number, minted: number) {
    super(
      `tracking registry: ${kind} "${key}" is stored as version ${String(stored)} but replays as ` +
        `${String(minted)} — the version history has a gap and cannot be loaded without renumbering`,
    );
    this.name = "RegistryVersionParityError";
  }
}

function buildRegistry<T>(name: string, rows: readonly TrackingRegistryRow[]): Registry<T> {
  const registry = new Registry<T>({ name });

  for (const row of rows) {
    const entry = registry.register({ key: row.key, value: row.value as T });
    if (!entry.ok)
      throw new Error(`tracking registry: ${name} "${row.key}": ${entry.error.message}`);
    if (entry.value.version !== row.version) {
      throw new RegistryVersionParityError(name, row.key, row.version, entry.value.version);
    }
    // Lifecycle is applied after registration because `register` always mints `active`; a stored
    // `deprecated` or `retired` must survive the round-trip or a retired destination would come
    // back to life on the next boot.
    if (row.status !== "active") {
      registry.transition(row.key, row.status as "draft" | "deprecated" | "retired");
    }
  }

  return registry;
}

/**
 * The loaded registry, serving the ports the ingest path resolves against.
 *
 * `VersionResolverPort` is served from the same snapshot as the definitions themselves. That is
 * deliberate: the version pinned onto an event record must be the version of the definition that
 * actually produced the payload, and reading them from two places is how those drift.
 *
 * **P1.3 scope note.** `EventDefinitionRegistryPort` and `ParameterRegistryPort` are not served
 * here — see `REGISTRY_KINDS` above. `ingestTrackingEvent` never resolves either.
 */
export class TrackingRegistrySnapshot implements DestinationRegistryPort, VersionResolverPort {
  private readonly destinations: Registry<DestinationDefinition>;
  private readonly mappings: Registry<MappingProfile>;
  private readonly ruleSets: Registry<RuleSet<DestinationKey>>;

  constructor(rows: readonly TrackingRegistryRow[]) {
    const of = (kind: TrackingRegistryKind): readonly TrackingRegistryRow[] =>
      rows.filter((row) => row.kind === kind);

    this.destinations = buildRegistry<DestinationDefinition>("destination", of("destination"));
    this.mappings = buildRegistry<MappingProfile>("mapping", of("mapping"));
    this.ruleSets = buildRegistry<RuleSet<DestinationKey>>("rule_set", of("rule_set"));
  }

  // --- DestinationRegistryPort ---------------------------------------------

  /**
   * The current definition, or null.
   *
   * A `deprecated` or `retired` entry resolves to null rather than to its value. Replay depends on
   * this: `destination_missing` and `destination_disabled` are refusals an operator must act on,
   * and serving a retired destination's configuration would send conversions to an integration the
   * merchant has explicitly withdrawn.
   */
  resolve(key: DestinationKey): DestinationDefinition | null {
    const entry = this.destinations.get(key);
    return entry === null || entry.status !== "active" ? null : entry.value;
  }

  /**
   * A specific historical version.
   *
   * Lifecycle is deliberately **not** checked here. This answers "did the configuration this event
   * ran under still exist?", which is a question about history; whether the destination may receive
   * traffic today is answered by `resolve`, and replay checks both. Conflating them would report a
   * deprecated destination as `configuration_removed`, sending an operator after the wrong problem.
   */
  resolveVersion(key: DestinationKey, version: number): DestinationDefinition | null {
    return this.destinations.getVersion(key, version)?.value ?? null;
  }

  listActive(): readonly DestinationDefinition[] {
    return this.destinations.list({ status: "active" }).map((entry) => entry.value);
  }

  // --- MappingRegistryPort --------------------------------------------------

  resolveMapping(key: string): MappingProfile | null {
    const entry = this.mappings.get(key);
    return entry === null || entry.status !== "active" ? null : entry.value;
  }

  resolveMappingVersion(key: string, version: number): MappingProfile | null {
    return this.mappings.getVersion(key, version)?.value ?? null;
  }

  // --- RuleSetRegistryPort --------------------------------------------------

  resolveRuleSet(key: string): RuleSet<DestinationKey> | null {
    const entry = this.ruleSets.get(key);
    return entry === null || entry.status !== "active" ? null : entry.value;
  }

  resolveRuleSetVersion(key: string, version: number): RuleSet<DestinationKey> | null {
    return this.ruleSets.getVersion(key, version)?.value ?? null;
  }

  // --- VersionResolverPort --------------------------------------------------

  /**
   * Pinned onto the record as provenance.
   *
   * Throws rather than defaulting to 0. A zero would be written to the record as though it were a
   * real version, and a replay months later would compare stored bytes against a configuration that
   * never produced them — fabricated provenance is worse than an admitted gap.
   */
  destinationVersion(key: DestinationKey): number {
    const entry = this.destinations.get(key);
    if (entry === null) throw new Error(`tracking: destination "${key}" is not registered`);
    return entry.version;
  }

  mappingVersion(mappingProfileKey: string): number {
    const entry = this.mappings.get(mappingProfileKey);
    if (entry === null) {
      throw new Error(`tracking: mapping profile "${mappingProfileKey}" is not registered`);
    }
    return entry.version;
  }

  /** The active routing rule set, when one is configured for this key. */
  ruleSetFor(key: string): { readonly id: string; readonly version: number } | null {
    const entry = this.ruleSets.get(key);
    return entry === null ? null : { id: entry.key, version: entry.version };
  }

  ruleSet(): { readonly id: string; readonly version: number } | null {
    const entries = this.ruleSets.list({ status: "active" });
    const first = entries[0];
    return first === undefined ? null : { id: first.key, version: first.version };
  }
}

/**
 * Adapts the snapshot to the two ports whose method names collide.
 *
 * `MappingRegistryPort` and `RuleSetRegistryPort` both declare `resolve`/`resolveVersion` with
 * different types, so one class cannot implement both under those names. Rather than splitting the
 * snapshot — which would let the destination registry and the version resolver be loaded from
 * different reads and drift — the collision is resolved by two thin views over the one snapshot.
 */
export function mappingRegistryOf(snapshot: TrackingRegistrySnapshot): MappingRegistryPort {
  return {
    resolve: (key) => snapshot.resolveMapping(key),
    resolveVersion: (key, version) => snapshot.resolveMappingVersion(key, version),
  };
}

export function ruleSetRegistryOf(snapshot: TrackingRegistrySnapshot): RuleSetRegistryPort {
  return {
    resolve: (key) => snapshot.resolveRuleSet(key),
    resolveVersion: (key, version) => snapshot.resolveRuleSetVersion(key, version),
  };
}

/**
 * Loads the registry for a tenant.
 *
 * **Fails when the registry is empty.** An empty registry is not a neutral starting state: every
 * event would route nowhere, `receiveAndDeliver` would record each one with no destinations, and
 * the platform would report perfect health while forwarding nothing at all. That failure is silent
 * and can run for weeks. Refusing to start is loud and takes minutes to fix.
 */
export async function loadTrackingRegistry(
  store: PrismaTrackingRegistryStore,
  tenantId: string,
): Promise<TrackingRegistrySnapshot> {
  const rows = await store.loadAll(tenantId);
  if (rows.length === 0) {
    throw new Error(
      `tracking: no registry definitions for tenant "${tenantId}" — seed the registry before ` +
        `starting ingest, or every event will be captured and forwarded nowhere`,
    );
  }
  return new TrackingRegistrySnapshot(rows);
}

// `eventDefinitionRegistryOf` / `parameterRegistryOf` (the two P5.5 registry views) are omitted
// for the same reason as the kinds they read -- see the `REGISTRY_KINDS` note above. They return
// `EventDefinitionRegistryPort` / `ParameterRegistryPort`, which `@platform/tracking` does not
// export on this branch, and no ingest-path caller resolves either.
