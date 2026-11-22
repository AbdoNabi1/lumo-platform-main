import { AsyncLocalStorage } from "node:async_hooks";
import type {
  ConsentEventRecord,
  ContactRecord,
  InboundRecord,
  OutboundRecord,
  OutreachUnitOfWork,
  StatusEventRecord,
  TemplateRecord,
  UnmatchedStatusRecord,
  WhatsAppConnectionRecord,
} from "../domain/repositories";

/**
 * The in-memory unit of work's transaction context. Writes made with it push an undo step, so a thrown error restores
 * exactly what THIS transaction changed. An undo step only restores a key the transaction itself still owns, so it can
 * never erase a value a different writer put there afterwards.
 */
export class InMemoryOutreachTransaction {
  readonly undo: Array<() => void> = [];
  /** Keyed locks this transaction holds until it ends (the twin of Postgres transaction-scoped advisory locks). */
  readonly heldKeys = new Map<string, () => void>();
  constructor(readonly tenantId: string | undefined) {}

  /** Releases every keyed lock (commit or rollback). */
  releaseKeys(): void {
    for (const release of this.heldKeys.values()) release();
    this.heldKeys.clear();
  }

  /** Restores exactly what this transaction wrote, newest first, and forgets the steps. */
  rollback(): void {
    for (const undo of this.undo.splice(0).reverse()) undo();
  }
}

/** Runs `fn` synchronously and returns its outcome as a settled promise (a throw becomes a rejection). */
export function settle<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/** FIFO async mutex: one holder at a time, released in order. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => held);
    await previous;
    return release;
  }
}

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryTable<V> {
  private readonly rows = new Map<string, V>();

  get(key: string): V | undefined {
    const value = this.rows.get(key);
    return value === undefined ? undefined : clone(value);
  }

  values(): V[] {
    return [...this.rows.values()].map(clone);
  }

  set(key: string, value: V, tx: InMemoryOutreachTransaction | undefined): void {
    const previous = this.rows.get(key);
    const written = clone(value);
    this.rows.set(key, written);
    tx?.undo.push(() => {
      if (this.rows.get(key) !== written) return;
      if (previous === undefined) this.rows.delete(key);
      else this.rows.set(key, previous);
    });
  }

  delete(key: string, tx: InMemoryOutreachTransaction | undefined): void {
    const previous = this.rows.get(key);
    if (previous === undefined) return;
    this.rows.delete(key);
    tx?.undo.push(() => {
      if (!this.rows.has(key)) this.rows.set(key, previous);
    });
  }
}

export interface DirectoryRow {
  tenantId: string;
  phoneNumberId: string;
  shopTenantId: string;
  wabaId: string;
}

/** Shared state of the in-memory twins: one instance per "database". */
export class InMemoryOutreachStore {
  readonly connections = new MemoryTable<WhatsAppConnectionRecord>();
  readonly directory = new MemoryTable<DirectoryRow>();
  readonly templates = new MemoryTable<TemplateRecord>();
  readonly contacts = new MemoryTable<ContactRecord>();
  readonly consentEvents = new MemoryTable<ConsentEventRecord>();
  readonly outbound = new MemoryTable<OutboundRecord>();
  readonly statusEvents = new MemoryTable<StatusEventRecord>();
  readonly inbound = new MemoryTable<InboundRecord>();
  readonly unmatched = new MemoryTable<UnmatchedStatusRecord>();
  readonly emailCounters = new MemoryTable<number>();
  /** Serialises every access of this store: a standalone call never sees (or races) an open transaction's writes. */
  private readonly lock = new Mutex();
  /** The live transaction handles: ONE when serialised (the gate admits one at a time), several when overlapping. */
  private readonly live = new Set<InMemoryOutreachTransaction>();
  /** The handle of the unit of work whose async context the running code belongs to (if any). */
  private readonly context = new AsyncLocalStorage<InMemoryOutreachTransaction>();
  private readonly keyLocks = new Map<string, Mutex>();

  /**
   * `serialize: false` lets transactions OVERLAP (read-committed-like: each repository operation is atomic, nothing
   * else is isolated), which is what Postgres allows. Only a transaction-scoped keyed lock ({@link lockKey}) orders
   * them then. The default (`true`) runs one transaction at a time.
   */
  constructor(private readonly options: { serialize: boolean } = { serialize: true }) {}

  /** Runs `work` in ONE transaction at a time (unless overlapping); an error undoes exactly this transaction's writes. */
  async transaction<T>(
    tenantId: string | undefined,
    work: (tx: InMemoryOutreachTransaction) => Promise<T>,
  ): Promise<T> {
    const release = this.options.serialize ? await this.lock.acquire() : undefined;
    const tx = new InMemoryOutreachTransaction(tenantId);
    this.live.add(tx);
    try {
      return await this.context.run(tx, () => work(tx));
    } catch (error) {
      tx.rollback();
      throw error;
    } finally {
      this.live.delete(tx);
      tx.releaseKeys();
      release?.();
    }
  }

  /**
   * A transaction-scoped keyed lock (twin of `pg_advisory_xact_lock`): waits for any other transaction holding `key`,
   * then holds it until THIS transaction ends. Re-entrant for the holder. `tx` must be a live transaction.
   */
  async lockKey(tx: unknown, key: string): Promise<void> {
    const joined = this.liveTransaction(tx);
    if (joined === undefined) throw new Error("a keyed lock needs the caller's transaction");
    if (joined.heldKeys.has(key)) return;
    let mutex = this.keyLocks.get(key);
    if (mutex === undefined) {
      mutex = new Mutex();
      this.keyLocks.set(key, mutex);
    }
    joined.heldKeys.set(key, await mutex.acquire());
  }

  /**
   * The live transaction `tx` denotes: `undefined` when no transaction was given (a standalone call), the handle
   * itself when it is this store's open one. A handle that is closed, or that belongs to another store, is an error:
   * its writes could never be rolled back, so it must not be accepted as if it were live.
   */
  liveTransaction(tx: unknown): InMemoryOutreachTransaction | undefined {
    if (!(tx instanceof InMemoryOutreachTransaction)) return undefined;
    if (!this.live.has(tx)) {
      throw new Error("the transaction handle is not an open transaction of this store");
    }
    return tx;
  }

  /**
   * One repository operation. Joined to the live same-store transaction `tx` it runs at once (it must not relock: that
   * transaction already holds the gate). Standalone it goes through the SAME gate, so it waits for an open transaction
   * to commit or abort and only then reads or writes committed state; its own writes roll back if it throws.
   */
  access<T>(
    tx: unknown,
    work: (t: InMemoryOutreachTransaction, standalone: boolean) => T,
  ): Promise<T> {
    let joined: InMemoryOutreachTransaction | undefined;
    try {
      joined = this.liveTransaction(tx);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    if (joined !== undefined) {
      const live = joined;
      return settle(() => work(live, false));
    }
    return this.standalone((t) => settle(() => work(t, true)));
  }

  /**
   * A multi-step (awaiting) write: joins the caller's live transaction, or (standalone) runs in its own gated
   * transaction that is rolled back when the work throws, so a half-applied operation is never committed.
   */
  owned<T>(tx: unknown, work: (t: InMemoryOutreachTransaction) => Promise<T>): Promise<T> {
    let joined: InMemoryOutreachTransaction | undefined;
    try {
      joined = this.liveTransaction(tx);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return joined === undefined ? this.standalone(work) : work(joined);
  }

  /**
   * A FRESH gate acquisition for a call that was given no transaction. Made from inside this store's own open unit of
   * work (the context handle is the store's current active handle) it could only wait for the gate its own caller
   * holds, forever: fail fast instead. Prisma would run such a call in a separate transaction, so joining it silently
   * would hide the missing `tx`. Identity, not `active !== undefined`: an independent caller still queues, and a
   * detached callback whose context handle is no longer the active one is not the owner.
   */
  private standalone<T>(work: (t: InMemoryOutreachTransaction) => Promise<T>): Promise<T> {
    const inside = this.context.getStore();
    if (inside !== undefined && this.live.has(inside)) {
      return Promise.reject(
        new Error("Already inside this outreach unit of work; pass tx to the repository call"),
      );
    }
    return this.transaction(undefined, work);
  }
}

/** In-memory unit of work with real rollback, tenant-bound like the production one and serialised per store. */
export class InMemoryOutreachUnitOfWork implements OutreachUnitOfWork {
  constructor(private readonly store: InMemoryOutreachStore) {}

  run<T>(tenantId: string, work: (context: unknown) => Promise<T>): Promise<T> {
    if (typeof tenantId !== "string" || tenantId.trim() === "") {
      return Promise.reject(new Error("an outreach unit of work needs a non-empty tenant id"));
    }
    return this.store.transaction(tenantId, (tx) => work(tx));
  }
}
