import type { TransactionalUnitOfWork } from "@platform/repository";
import type {
  ConsentEventRecord,
  ContactRecord,
  InboundRecord,
  OutboundRecord,
  StatusEventRecord,
  TemplateRecord,
  UnmatchedStatusRecord,
  WhatsAppConnectionRecord,
} from "../domain/repositories";

/**
 * The in-memory unit of work's transaction context. Writes made with it push an undo step, so a thrown error restores
 * exactly what THIS transaction changed (concurrent transactions are not clobbered).
 */
export class InMemoryOutreachTransaction {
  readonly undo: Array<() => void> = [];
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
    this.rows.set(key, clone(value));
    tx?.undo.push(() => {
      if (previous === undefined) this.rows.delete(key);
      else this.rows.set(key, previous);
    });
  }

  delete(key: string, tx: InMemoryOutreachTransaction | undefined): void {
    const previous = this.rows.get(key);
    if (previous === undefined) return;
    this.rows.delete(key);
    tx?.undo.push(() => {
      this.rows.set(key, previous);
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
}

/** In-memory unit of work with real rollback: an error undoes every write made through the transaction it passed. */
export class InMemoryOutreachUnitOfWork implements TransactionalUnitOfWork<unknown> {
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    const tx = new InMemoryOutreachTransaction();
    try {
      return await work(tx);
    } catch (error) {
      for (const undo of tx.undo.reverse()) undo();
      throw error;
    }
  }
}
