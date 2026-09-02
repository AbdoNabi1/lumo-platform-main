import { err, ok, type Result } from "@platform/types";
import {
  type DomainError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@platform/utils";

/**
 * The lifecycle of a registry entry (ADR-0055). Deliberately generic: individual registries (Feature, Usage,
 * Provider, Prompt, …) map their own domain vocabulary onto these four platform-wide states.
 */
export type RegistryLifecycle = "draft" | "active" | "deprecated" | "retired";

/**
 * Rich discovery descriptor (P1.1.1 §6) — metadata only, never runtime logic. Optional and additive; existing
 * entries omit it. Powers search, catalogs, marketplace surfacing and (future) AI reasoning over registries.
 */
export interface RegistryDescriptor {
  readonly aliases?: readonly string[];
  readonly keywords?: readonly string[];
  readonly category?: string;
  readonly owner?: string;
  readonly docsUrl?: string;
  readonly popularity?: number;
  readonly deprecation?: {
    readonly deprecated: boolean;
    readonly since?: string;
    readonly reason?: string;
  };
  readonly replacement?: { readonly replacedBy: string };
  readonly ai?: { readonly description?: string; readonly tags?: readonly string[] };
}

/** A single, immutable version of a registered definition. Registering the same key again mints a new version. */
export interface RegistryEntry<T> {
  readonly key: string;
  /** Monotonic per-key version (1-based). */
  readonly version: number;
  readonly value: T;
  readonly status: RegistryLifecycle;
  readonly tags: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly descriptor?: RegistryDescriptor;
  readonly registeredAt: string;
  readonly updatedAt: string;
}

export interface RegisterInput<T> {
  readonly key: string;
  readonly value: T;
  readonly tags?: readonly string[];
  readonly metadata?: Readonly<Record<string, string>>;
  readonly descriptor?: RegistryDescriptor;
}

/** A portable, definitions-only snapshot of a registry (P1.1.1 §8) — never runtime state. */
export interface RegistrySnapshotEntry<T> {
  readonly key: string;
  readonly value: T;
  readonly status: RegistryLifecycle;
  readonly tags: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly descriptor?: RegistryDescriptor;
}

export interface RegistrySnapshot<T> {
  readonly name: string;
  readonly exportedAt: string;
  readonly entries: readonly RegistrySnapshotEntry<T>[];
}

/** Discovery filter — every clause is ANDed; `tags` matches when the entry carries **any** listed tag. */
export interface RegistryQuery {
  readonly status?: RegistryLifecycle;
  readonly tag?: string;
  readonly tags?: readonly string[];
  readonly metadata?: Readonly<Record<string, string>>;
}

/** Validation hook run before an entry is admitted; throw to reject (surfaces as a `ValidationError`). */
export type RegistryValidator<T> = (value: T, key: string) => void;

export interface RegistryOptions<T> {
  /** Human name (used in error messages/telemetry). */
  readonly name: string;
  readonly validate?: RegistryValidator<T>;
  /** Injectable clock for deterministic timestamps (defaults to `Date`). */
  readonly now?: () => Date;
}

interface Cell<T> {
  current: RegistryEntry<T>;
  readonly history: RegistryEntry<T>[];
}

function matches<T>(entry: RegistryEntry<T>, q: RegistryQuery): boolean {
  if (q.status !== undefined && entry.status !== q.status) return false;
  if (q.tag !== undefined && !entry.tags.includes(q.tag)) return false;
  if (q.tags !== undefined && q.tags.length > 0 && !q.tags.some((t) => entry.tags.includes(t)))
    return false;
  if (q.metadata !== undefined) {
    for (const [k, v] of Object.entries(q.metadata)) if (entry.metadata[k] !== v) return false;
  }
  return true;
}

/**
 * Registry Engine — the reusable platform primitive behind every registry (ADR-0055). It owns **no business
 * logic**: it stores versioned, tagged, metadata-carrying definitions with a uniform lifecycle and discovery.
 * A registry is therefore configuration (an entry type + an optional validator), never a bespoke subsystem.
 *
 * Deterministic and side-effect-free beyond its in-memory store; persistence (when a registry needs durability)
 * is the consumer's concern — this engine is the canonical in-memory reference and contract.
 */
export class Registry<T> {
  private readonly cells = new Map<string, Cell<T>>();
  private readonly name: string;
  private readonly validate?: RegistryValidator<T>;
  private readonly now: () => Date;

  constructor(options: RegistryOptions<T>) {
    this.name = options.name;
    if (options.validate !== undefined) this.validate = options.validate;
    this.now = options.now ?? ((): Date => new Date());
  }

  /** Registers a key (v1, `active`) or mints the next immutable version of an existing key. */
  register(input: RegisterInput<T>): Result<RegistryEntry<T>, DomainError> {
    const key = input.key.trim();
    if (key.length === 0)
      return err(new ValidationError(`${this.name}: a registry key is required`));
    if (this.validate !== undefined) {
      try {
        this.validate(input.value, key);
      } catch (error) {
        return err(
          error instanceof Error
            ? new ValidationError(`${this.name}: ${error.message}`)
            : new ValidationError(`${this.name}: invalid entry`),
        );
      }
    }
    const at = this.now().toISOString();
    const existing = this.cells.get(key);
    const version = existing === undefined ? 1 : existing.current.version + 1;
    const entry: RegistryEntry<T> = {
      key,
      version,
      value: input.value,
      status: "active",
      tags: [...(input.tags ?? [])],
      metadata: { ...(input.metadata ?? {}) },
      ...(input.descriptor !== undefined ? { descriptor: input.descriptor } : {}),
      registeredAt: existing?.history[0]?.registeredAt ?? at,
      updatedAt: at,
    };
    if (existing === undefined) this.cells.set(key, { current: entry, history: [entry] });
    else {
      existing.current = entry;
      existing.history.push(entry);
    }
    return ok(entry);
  }

  /** The current entry for a key, or null when unknown. */
  get(key: string): RegistryEntry<T> | null {
    return this.cells.get(key.trim())?.current ?? null;
  }

  /** A specific historical version of a key. */
  getVersion(key: string, version: number): RegistryEntry<T> | null {
    return this.cells.get(key.trim())?.history.find((e) => e.version === version) ?? null;
  }

  /** Full version history (oldest → newest) for a key. */
  versions(key: string): readonly RegistryEntry<T>[] {
    return this.cells.get(key.trim())?.history ?? [];
  }

  has(key: string): boolean {
    return this.cells.has(key.trim());
  }

  /** Discovery — current entries matching the (optional) query, in insertion order. */
  list(query: RegistryQuery = {}): readonly RegistryEntry<T>[] {
    const out: RegistryEntry<T>[] = [];
    for (const cell of this.cells.values())
      if (matches(cell.current, query)) out.push(cell.current);
    return out;
  }

  /** Transitions the current entry's lifecycle (draft→active→deprecated→retired, or reactivation). */
  transition(key: string, status: RegistryLifecycle): Result<RegistryEntry<T>, DomainError> {
    const cell = this.cells.get(key.trim());
    if (cell === undefined)
      return err(new NotFoundError(`${this.name}: "${key}" is not registered`));
    if (cell.current.status === "retired" && status !== "retired") {
      return err(new ConflictError(`${this.name}: "${key}" is retired and cannot be reactivated`));
    }
    const updated: RegistryEntry<T> = {
      ...cell.current,
      status,
      updatedAt: this.now().toISOString(),
    };
    cell.current = updated;
    cell.history[cell.history.length - 1] = updated;
    return ok(updated);
  }

  deprecate(key: string): Result<RegistryEntry<T>, DomainError> {
    return this.transition(key, "deprecated");
  }

  retire(key: string): Result<RegistryEntry<T>, DomainError> {
    return this.transition(key, "retired");
  }

  /** Guard for callers that must resolve an actionable (active) entry — e.g. billable-resource resolution. */
  requireActive(key: string): Result<RegistryEntry<T>, DomainError> {
    const entry = this.get(key);
    if (entry === null) return err(new NotFoundError(`${this.name}: "${key}" is not registered`));
    if (entry.status !== "active")
      return err(new BusinessRuleError(`${this.name}: "${key}" is ${entry.status}, not active`));
    return ok(entry);
  }

  /** Resolve by descriptor alias (P1.1.1 §6). */
  findByAlias(alias: string): RegistryEntry<T> | null {
    const needle = alias.trim().toLowerCase();
    for (const cell of this.cells.values()) {
      if ((cell.current.descriptor?.aliases ?? []).some((a) => a.toLowerCase() === needle))
        return cell.current;
    }
    return null;
  }

  /** Keyword/alias/tag/category text search across current entries (P1.1.1 §6). Deterministic (sorted by key). */
  search(term: string): readonly RegistryEntry<T>[] {
    const needle = term.trim().toLowerCase();
    if (needle.length === 0) return this.list();
    const hits: RegistryEntry<T>[] = [];
    for (const cell of this.cells.values()) {
      const e = cell.current;
      const haystack = [
        e.key,
        ...e.tags,
        e.descriptor?.category ?? "",
        ...(e.descriptor?.aliases ?? []),
        ...(e.descriptor?.keywords ?? []),
        e.descriptor?.ai?.description ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (haystack.includes(needle)) hits.push(e);
    }
    return hits.sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Export the current entries as a portable, definitions-only snapshot (P1.1.1 §8). Never exports runtime state. */
  exportSnapshot(): RegistrySnapshot<T> {
    const entries: RegistrySnapshotEntry<T>[] = [];
    for (const cell of this.cells.values()) {
      const e = cell.current;
      entries.push({
        key: e.key,
        value: e.value,
        status: e.status,
        tags: e.tags,
        metadata: e.metadata,
        ...(e.descriptor !== undefined ? { descriptor: e.descriptor } : {}),
      });
    }
    entries.sort((a, b) => a.key.localeCompare(b.key));
    return { name: this.name, exportedAt: this.now().toISOString(), entries };
  }

  /** Import a snapshot's definitions (P1.1.1 §8) — registers each entry (minting versions) and applies its status. */
  importSnapshot(snapshot: RegistrySnapshot<T>): Result<number, DomainError> {
    let imported = 0;
    for (const entry of snapshot.entries) {
      const res = this.register({
        key: entry.key,
        value: entry.value,
        tags: entry.tags,
        metadata: entry.metadata,
        ...(entry.descriptor !== undefined ? { descriptor: entry.descriptor } : {}),
      });
      if (!res.ok) return err(res.error);
      if (entry.status !== "active") this.transition(entry.key, entry.status);
      imported += 1;
    }
    return ok(imported);
  }
}
