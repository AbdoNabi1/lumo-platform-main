/**
 * Registry hot reload (M6.7) — the runtime picks up definition changes without a restart.
 *
 * M6.6 loaded the registry once, in `trackingIngestModule.start`, and held that snapshot for the
 * lifetime of the process. Publishing a destination, deprecating one, or correcting a mapping
 * profile therefore required a deploy. That is not acceptable for configuration an operator is
 * expected to change: the interval between "the merchant disconnected Pinterest" and "the runtime
 * stops sending to Pinterest" was however long until the next restart.
 *
 * ## Why the old `TrackingRegistrySnapshot.reload` was not the answer
 *
 * It existed, nothing called it, and it would have been wrong if anything had. It reassigned the
 * three internal registries *on the live object*, and every consumer — the router, the mapping
 * engine, the version resolver — holds a reference to that same object and reads it at several
 * points across `await` boundaries. A swap landing between routing and version pinning would produce
 * an event routed by rule set v4 and stamped with destination version v5: a record whose provenance
 * describes bytes it never produced, which is unrecoverable and completely silent. That is precisely
 * the partial state a hot reload must not have.
 *
 * ## The construction
 *
 * The snapshot becomes **immutable**, and a mutable {@link TrackingRegistryHandle} holds a reference
 * to the current one. Replacement is a single assignment of an already-built snapshot, so there is
 * no window in which the handle points at a half-populated registry.
 *
 * Atomicity for an *event* comes from pinning, not from the assignment: the composition root reads
 * `handle.current()` exactly once per event and threads that one instance through routing, mapping,
 * delivery and version stamping. An event that started before a swap finishes on the definitions it
 * started with; an event that starts after uses the new ones. There is no in-between case, because
 * no consumer ever re-reads the handle mid-flight.
 *
 * ## Replay is unaffected by design
 *
 * Replay resolves destinations by the *version pinned on the record*, via `resolveVersion`, and
 * definition versions are immutable rows that a reload re-reads rather than replaces. So a freshly
 * swapped snapshot still contains every historical version, and a replay of a six-month-old event
 * resolves the configuration that event actually ran under. The one case that would break this — a
 * version row having been deleted — is caught by the parity guard in `buildSnapshot`, which fails
 * the *swap* and leaves the previous snapshot serving. A registry that cannot be loaded faithfully
 * is never allowed to become the live one.
 */

import type { Logger } from "@platform/utils";

import {
  loadTrackingRegistry,
  type PrismaTrackingRegistryStore,
  type TrackingRegistrySnapshot,
} from "./tracking-registry";

/**
 * A cheap fingerprint of the stored row set, used to decide whether a reload is worth doing.
 *
 * Rows are immutable and append-only — a status change appends a new version rather than updating a
 * row — so the pair `(count, latestAt)` changes whenever the set changes. Polling this instead of
 * reloading unconditionally keeps a 30-second watcher to two indexed queries rather than a full
 * table read plus a registry rebuild every tick.
 *
 * The one change it cannot see is a delete paired with an insert that preserves both the count and
 * the maximum `registered_at`. That requires direct SQL against an append-only table, and the next
 * genuine reload would fail the version-parity guard rather than serve a renumbered registry — so
 * the failure mode is a refused swap, not silent corruption.
 */
export interface RegistrySignal {
  readonly count: number;
  /** Epoch millis of the newest `registered_at`, or 0 when the registry is empty. */
  readonly latestAt: number;
}

export function signalsDiffer(a: RegistrySignal, b: RegistrySignal): boolean {
  return a.count !== b.count || a.latestAt !== b.latestAt;
}

/** What a refresh attempt did. Every outcome is reported; none is silent. */
export type RefreshOutcome =
  | { readonly status: "unchanged"; readonly signal: RegistrySignal }
  | {
      readonly status: "swapped";
      readonly signal: RegistrySignal;
      readonly generation: number;
      readonly activeDestinations: number;
    }
  /**
   * The new definitions could not be loaded faithfully. The previous snapshot stays live — serving
   * slightly stale but *correct* configuration beats serving a registry whose version numbers no
   * longer match the records that reference them.
   */
  | { readonly status: "failed"; readonly error: Error };

/**
 * Holds the current snapshot and hands it out one pin at a time.
 *
 * `current()` is the only way to reach a snapshot. Callers must treat the returned instance as the
 * one they use for an entire unit of work — that is what makes the reload invisible to it.
 */
export class TrackingRegistryHandle {
  private snapshot: TrackingRegistrySnapshot;
  private signal: RegistrySignal;
  private generationCount = 1;

  constructor(snapshot: TrackingRegistrySnapshot, signal: RegistrySignal) {
    this.snapshot = snapshot;
    this.signal = signal;
  }

  /**
   * The live snapshot. Read once per event and threaded through; never re-read mid-pipeline.
   */
  current(): TrackingRegistrySnapshot {
    return this.snapshot;
  }

  /** Increments on every swap. Surfaced in logs so a reload is visible in an incident timeline. */
  generation(): number {
    return this.generationCount;
  }

  currentSignal(): RegistrySignal {
    return this.signal;
  }

  /**
   * Replaces the live snapshot.
   *
   * The caller must pass a snapshot that is already fully built — construction, including the
   * version-parity assertion, happens before this is reached, so a load failure never gets as far as
   * a partial swap. The two assignments below cannot interleave with anything: they are synchronous
   * and contain no `await`, so no consumer can observe the snapshot and the signal disagreeing.
   */
  swap(next: TrackingRegistrySnapshot, signal: RegistrySignal): number {
    this.snapshot = next;
    this.signal = signal;
    this.generationCount += 1;
    return this.generationCount;
  }
}

export interface RegistryWatcherInput {
  readonly handle: TrackingRegistryHandle;
  readonly store: PrismaTrackingRegistryStore;
  readonly tenantId: string;
  readonly logger: Logger;
  /** Poll interval. Configuration, not a compiled-in constant. */
  readonly intervalMs: number;
}

/**
 * Polls for definition changes and swaps the snapshot when it finds one.
 *
 * ## Why polling rather than an event
 *
 * A `tracking.registry.changed` event would be lower latency, and it is the right answer once the
 * admin write path that would publish it exists. Today registry rows are written by an operator
 * script (`tracking-registry-seed.ts`) and by future admin endpoints, neither of which publishes
 * anything — so a consumer would be subscribing to a topic nobody produces, which is a fake. Polling
 * a fingerprint is honest, has a bounded worst-case staleness equal to the interval, and does not
 * stop being correct when the event is added later: the swap path is the same either way, and
 * {@link TrackingRegistryWatcher.refreshNow} is already the handler an event would call.
 *
 * ## Failure handling
 *
 * A refresh that throws is logged and swallowed. It must not take the ingest consumer down: the
 * currently loaded registry is still valid, events still route correctly against it, and a
 * transient database blip that killed ingest would turn a stale-configuration problem into a
 * conversion-loss problem. Repeated failures are visible in the log and in the unchanged generation.
 */
export class TrackingRegistryWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshing = false;

  constructor(private readonly input: RegistryWatcherInput) {}

  start(): void {
    if (this.timer !== null) return;

    this.timer = setInterval(() => {
      void this.tick();
    }, this.input.intervalMs);

    // Never hold the process open for a poll — shutdown should not wait on the next tick.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    // A slow load must not stack: reloads are idempotent, so a skipped tick costs at most one
    // interval of staleness, whereas overlapping loads would race two swaps of different vintages
    // and the later-finishing older read could win.
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const outcome = await this.refreshNow();
      if (outcome.status === "failed") {
        this.input.logger.error("tracking registry refresh failed", {
          tenantId: this.input.tenantId,
          error: outcome.error.message,
        });
      }
    } finally {
      this.refreshing = false;
    }
  }

  /**
   * Checks the signal and swaps if it moved.
   *
   * Public because it is the same operation an admin "reload now" action and a future
   * `tracking.registry.changed` consumer both need, and having one implementation is what keeps
   * those paths from drifting into three different reload semantics.
   */
  async refreshNow(): Promise<RefreshOutcome> {
    try {
      const signal = await this.input.store.signal(this.input.tenantId);
      if (!signalsDiffer(signal, this.input.handle.currentSignal())) {
        return { status: "unchanged", signal };
      }

      // Built completely — including the version-parity assertion — before anything is swapped. A
      // registry that throws here never becomes live, and the previous snapshot keeps serving.
      const next = await loadTrackingRegistry(this.input.store, this.input.tenantId);
      const generation = this.input.handle.swap(next, signal);

      const activeDestinations = next.listActive().length;
      this.input.logger.info("tracking registry reloaded", {
        tenantId: this.input.tenantId,
        generation,
        definitions: signal.count,
        activeDestinations,
      });

      return { status: "swapped", signal, generation, activeDestinations };
    } catch (cause) {
      return { status: "failed", error: cause instanceof Error ? cause : new Error(String(cause)) };
    }
  }
}
