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
}

export function transactionOf(tx: unknown): InMemoryOutreachTransaction | undefined {
  return tx instanceof InMemoryOutreachTransaction ? tx : undefined;
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
  /** Serialises every transaction of this store: concurrent units of work never interleave their writes. */
  private readonly lock = new Mutex();

  /** Runs `work` in ONE transaction at a time; an error undoes exactly this transaction's writes. */
  async transaction<T>(
    tenantId: string | undefined,
    work: (tx: InMemoryOutreachTransaction) => Promise<T>,
  ): Promise<T> {
    const release = await this.lock.acquire();
    const tx = new InMemoryOutreachTransaction(tenantId);
    try {
      return await work(tx);
    } catch (error) {
      for (const undo of tx.undo.reverse()) undo();
      throw error;
    } finally {
      release();
    }
  }

  /**
   * A multi-step write: joins the caller's transaction, or (standalone) runs in its own serialised transaction that is
   * rolled back when the work throws, so a half-applied operation is never committed.
   */
  owned<T>(tx: unknown, work: (t: InMemoryOutreachTransaction) => Promise<T>): Promise<T> {
    const joined = transactionOf(tx);
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
