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
  constructor(readonly tenantId: string | undefined) {}

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
  /** The ONE live transaction handle (the lock admits one at a time); invalidated when its transaction ends. */
  private active: InMemoryOutreachTransaction | undefined;

  /** Runs `work` in ONE transaction at a time; an error undoes exactly this transaction's writes. */
  async transaction<T>(
    tenantId: string | undefined,
    work: (tx: InMemoryOutreachTransaction) => Promise<T>,
  ): Promise<T> {
    const release = await this.lock.acquire();
    const tx = new InMemoryOutreachTransaction(tenantId);
    this.active = tx;
    try {
      return await work(tx);
    } catch (error) {
      tx.rollback();
      throw error;
    } finally {
      this.active = undefined;
      release();
    }
  }

  /**
   * The live transaction `tx` denotes: `undefined` when no transaction was given (a standalone call), the handle
   * itself when it is this store's open one. A handle that is closed, or that belongs to another store, is an error:
   * its writes could never be rolled back, so it must not be accepted as if it were live.
   */
  liveTransaction(tx: unknown): InMemoryOutreachTransaction | undefined {
    if (!(tx instanceof InMemoryOutreachTransaction)) return undefined;
    if (tx !== this.active) {
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
    return this.transaction(undefined, (t) => settle(() => work(t, true)));
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
    return joined === undefined ? this.transaction(undefined, work) : work(joined);
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
