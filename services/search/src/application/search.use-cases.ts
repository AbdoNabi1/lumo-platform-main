import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ConcurrencyError, ConflictError, NotFoundError } from "@platform/utils";
import { SearchIndex } from "../domain/search-index";
import type { SearchIndexRepository } from "../domain/search-index-repository";
import { SearchDocument } from "../domain/value-objects/search-document";
import type { IndexStatusValue } from "../domain/value-objects/index-status";
import type { IndexProviderPort } from "./ports";

export interface CreateIndexInput {
  readonly name: string;
  readonly tenantId: string;
}

export interface IndexStatusOutput {
  readonly indexId: string;
  readonly status: string;
  readonly documentCount: number;
}

export interface IndexIdInput {
  readonly indexId: string;
  readonly tenantId: string;
}

export interface SearchDeps {
  readonly indexes: SearchIndexRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface SearchProviderDeps extends SearchDeps {
  readonly provider: IndexProviderPort;
}

function toOutput(index: SearchIndex): IndexStatusOutput {
  return {
    indexId: index.id.toString(),
    status: index.status.value,
    documentCount: index.documentCount,
  };
}

/**
 * Bounded retry on optimistic-lock conflicts only (Phase A.15, reusing the shape Licensing's
 * `withConcurrencyRetry` established for `CollectInvoice`, itself reusing Payments'
 * Phase A.4/A.8 convention) — `PrismaSearchIndexRepository.save` throws `ConcurrencyError` when a
 * concurrent writer already advanced the row's `version`; that is expected/recoverable (two
 * concurrent upserts/deletes against the same index row), so the read-mutate-write attempt is
 * retried from scratch against the now-current row. Any other error propagates immediately.
 */
async function withConcurrencyRetry<T>(maxAttempts: number, attempt: () => Promise<T>): Promise<T> {
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof ConcurrencyError) || i === maxAttempts) {
        throw error;
      }
    }
  }
  throw new Error("unreachable");
}

/** Creates a search index — one per `name`. */
export class CreateIndex implements UseCase<CreateIndexInput, IndexStatusOutput, DomainError> {
  private readonly deps: SearchDeps;

  constructor(deps: SearchDeps) {
    this.deps = deps;
  }

  async execute(input: CreateIndexInput): Promise<Result<IndexStatusOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<IndexStatusOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.indexes.findByName(input.name, input.tenantId, tx);
      if (existing !== null) {
        return err(new ConflictError(`Search index "${input.name}" already exists`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const index = SearchIndex.create(id, input.name);
      await this.deps.indexes.save(index, tx);
      return ok(toOutput(index));
    });
  }
}

export interface AdvanceIndexInput extends IndexIdInput {
  readonly toStatus: IndexStatusValue;
}

/** Generic validated transition — used for rebuild/activate/disable. */
export class AdvanceIndex implements UseCase<AdvanceIndexInput, IndexStatusOutput, DomainError> {
  private readonly deps: SearchDeps;

  constructor(deps: SearchDeps) {
    this.deps = deps;
  }

  async execute(input: AdvanceIndexInput): Promise<Result<IndexStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IndexStatusOutput, DomainError>>(async (tx) => {
      const index = await this.deps.indexes.findById(input.indexId, input.tenantId, tx);
      if (index === null) return err(new NotFoundError("Search index not found"));

      try {
        index.transition(input.toStatus, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.indexes.save(index, tx);
      return ok(toOutput(index));
    });
  }
}

export interface UpsertDocumentInput extends IndexIdInput {
  readonly productRef: string;
  readonly title: string;
  readonly categoryRefs: readonly string[];
  readonly attributes?: Readonly<Record<string, string>>;
}

/**
 * Indexes a product **snapshot** via `IndexProviderPort` — idempotent upsert, async indexing.
 *
 * Phase A.15: `provider.upsert()` is an external network call to the index backend
 * (OpenSearch/pgvector, ADR-0020) that previously ran INSIDE the `unitOfWork.run()` transaction
 * that read+saved the `SearchIndex` aggregate — same defect class as Payments/Returns/Licensing
 * fixed elsewhere in this phase (a DB connection held open for the full network round-trip). Fixed
 * via a simple precheck -> external-call -> settle split — no reserve/settle two-phase machinery
 * like `CapturePaymentLifecycle`/`CollectInvoice`, because there is nothing here that needs a
 * durable pre-call reservation:
 *
 *  1. `precheck` — a read-only transaction confirming the index exists (`NotFoundError` preserved,
 *     same as the pre-fix version's `findById` check).
 *  2. `provider.upsert(document)` — runs with NO transaction open.
 *  3. `settle` — a fresh transaction that re-reads the index, applies `recordDocumentUpserted`
 *     (which itself re-validates `status === "active"`, exactly as before — unchanged domain rule,
 *     just evaluated slightly later), and saves; retried on `ConcurrencyError` for concurrent
 *     upserts racing on the same index row's `version`.
 *
 * No intermediate "upserting" status was added to `SearchIndex`/`IndexStatusValue`: `documentCount`
 * is already documented as an *approximate* count ("the provider owns the true document set"), and
 * `IndexProviderPort.upsert` is an inherently idempotent operation (re-upserting the same document
 * is a safe no-op at any real search backend — see `ports.ts`), so there is no "double write"/
 * "double charge" risk analogous to a PSP capture that would justify one. See PHASE_A15 report for
 * the full idempotency/concurrency analysis.
 *
 * FAILURE RECOVERY: if `provider.upsert()` throws, `execute()` rethrows immediately and NO domain
 * mutation happens — `recordDocumentUpserted`/`indexes.save` are never reached, so `documentCount`
 * and the raised event correctly reflect that indexing did not happen. This matches the pre-fix
 * single-transaction version's behavior exactly (a provider throw there aborted the transaction
 * before `recordDocumentUpserted` ran, so nothing was persisted either).
 */
export class UpsertDocument implements UseCase<
  UpsertDocumentInput,
  IndexStatusOutput,
  DomainError
> {
  private static readonly MAX_CONCURRENCY_RETRIES = 5;

  private readonly deps: SearchProviderDeps;

  constructor(deps: SearchProviderDeps) {
    this.deps = deps;
  }

  async execute(input: UpsertDocumentInput): Promise<Result<IndexStatusOutput, DomainError>> {
    const precheck = await this.precheck(input.indexId, input.tenantId);
    if (!precheck.ok) return err(precheck.error);

    const document = SearchDocument.create(
      input.productRef,
      input.title,
      input.categoryRefs,
      input.attributes,
    );
    await this.deps.provider.upsert(document);

    return this.settle(input.indexId, input.productRef, input.tenantId);
  }

  private async precheck(indexId: string, tenantId: string): Promise<Result<void, DomainError>> {
    return this.deps.unitOfWork.run<Result<void, DomainError>>(async (tx) => {
      const index = await this.deps.indexes.findById(indexId, tenantId, tx);
      if (index === null) return err(new NotFoundError("Search index not found"));
      return ok(undefined);
    });
  }

  private async settle(
    indexId: string,
    productRef: string,
    tenantId: string,
  ): Promise<Result<IndexStatusOutput, DomainError>> {
    return withConcurrencyRetry(UpsertDocument.MAX_CONCURRENCY_RETRIES, () =>
      this.deps.unitOfWork.run<Result<IndexStatusOutput, DomainError>>(async (tx) => {
        const index = await this.deps.indexes.findById(indexId, tenantId, tx);
        if (index === null) return err(new NotFoundError("Search index not found"));

        try {
          index.recordDocumentUpserted(
            productRef,
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
          );
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        await this.deps.indexes.save(index, tx);
        return ok(toOutput(index));
      }),
    );
  }
}

export interface DeleteDocumentInput extends IndexIdInput {
  readonly productRef: string;
}

/**
 * Removes a product snapshot via `IndexProviderPort`.
 *
 * Phase A.15: same defect and same fix shape as `UpsertDocument` above (see its doc comment for
 * the full reasoning) — `provider.delete()` previously ran INSIDE the `unitOfWork.run()`
 * transaction; now split into precheck -> external-call -> settle, with NO transaction open during
 * the network call. `IndexProviderPort.delete` deleting an already-absent document is documented as
 * a safe idempotent no-op at any real search backend, so — as with `UpsertDocument` — no
 * intermediate persisted status was needed to make this safe.
 *
 * FAILURE RECOVERY: if `provider.delete()` throws, `execute()` rethrows and NO domain mutation
 * happens (`recordDocumentDeleted`/`indexes.save` are never reached) — identical to the pre-fix
 * single-transaction version's behavior.
 */
export class DeleteDocument implements UseCase<
  DeleteDocumentInput,
  IndexStatusOutput,
  DomainError
> {
  private static readonly MAX_CONCURRENCY_RETRIES = 5;

  private readonly deps: SearchProviderDeps;

  constructor(deps: SearchProviderDeps) {
    this.deps = deps;
  }

  async execute(input: DeleteDocumentInput): Promise<Result<IndexStatusOutput, DomainError>> {
    const precheck = await this.precheck(input.indexId, input.tenantId);
    if (!precheck.ok) return err(precheck.error);

    await this.deps.provider.delete(input.productRef);

    return this.settle(input.indexId, input.productRef, input.tenantId);
  }

  private async precheck(indexId: string, tenantId: string): Promise<Result<void, DomainError>> {
    return this.deps.unitOfWork.run<Result<void, DomainError>>(async (tx) => {
      const index = await this.deps.indexes.findById(indexId, tenantId, tx);
      if (index === null) return err(new NotFoundError("Search index not found"));
      return ok(undefined);
    });
  }

  private async settle(
    indexId: string,
    productRef: string,
    tenantId: string,
  ): Promise<Result<IndexStatusOutput, DomainError>> {
    return withConcurrencyRetry(DeleteDocument.MAX_CONCURRENCY_RETRIES, () =>
      this.deps.unitOfWork.run<Result<IndexStatusOutput, DomainError>>(async (tx) => {
        const index = await this.deps.indexes.findById(indexId, tenantId, tx);
        if (index === null) return err(new NotFoundError("Search index not found"));

        try {
          index.recordDocumentDeleted(
            productRef,
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
          );
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        await this.deps.indexes.save(index, tx);
        return ok(toOutput(index));
      }),
    );
  }
}

export interface SynonymInput extends IndexIdInput {
  readonly term: string;
  readonly synonyms?: readonly string[];
}

/** Adds (or replaces) a merchant synonym entry. */
export class AddSynonym implements UseCase<SynonymInput, IndexStatusOutput, DomainError> {
  private readonly deps: SearchDeps;

  constructor(deps: SearchDeps) {
    this.deps = deps;
  }

  async execute(input: SynonymInput): Promise<Result<IndexStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IndexStatusOutput, DomainError>>(async (tx) => {
      const index = await this.deps.indexes.findById(input.indexId, input.tenantId, tx);
      if (index === null) return err(new NotFoundError("Search index not found"));

      index.addSynonym(
        input.term,
        input.synonyms ?? [],
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.indexes.save(index, tx);
      return ok(toOutput(index));
    });
  }
}

/** Removes a merchant synonym entry. */
export class RemoveSynonym implements UseCase<SynonymInput, IndexStatusOutput, DomainError> {
  private readonly deps: SearchDeps;

  constructor(deps: SearchDeps) {
    this.deps = deps;
  }

  async execute(input: SynonymInput): Promise<Result<IndexStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IndexStatusOutput, DomainError>>(async (tx) => {
      const index = await this.deps.indexes.findById(input.indexId, input.tenantId, tx);
      if (index === null) return err(new NotFoundError("Search index not found"));

      index.removeSynonym(input.term, this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.indexes.save(index, tx);
      return ok(toOutput(index));
    });
  }
}

export interface SuggestionInput extends IndexIdInput {
  readonly term: string;
}

/** Adds an autocomplete suggestion term. */
export class AddSuggestion implements UseCase<SuggestionInput, IndexStatusOutput, DomainError> {
  private readonly deps: SearchDeps;

  constructor(deps: SearchDeps) {
    this.deps = deps;
  }

  async execute(input: SuggestionInput): Promise<Result<IndexStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IndexStatusOutput, DomainError>>(async (tx) => {
      const index = await this.deps.indexes.findById(input.indexId, input.tenantId, tx);
      if (index === null) return err(new NotFoundError("Search index not found"));

      index.addSuggestion(input.term, this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.indexes.save(index, tx);
      return ok(toOutput(index));
    });
  }
}

export interface LogQueryInput extends IndexIdInput {
  readonly term: string;
}

/** Logs a search query for analytics (`search.query.logged`) — pure logging, no state mutation. */
export class LogQuery implements UseCase<LogQueryInput, IndexStatusOutput, DomainError> {
  private readonly deps: SearchDeps;

  constructor(deps: SearchDeps) {
    this.deps = deps;
  }

  async execute(input: LogQueryInput): Promise<Result<IndexStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IndexStatusOutput, DomainError>>(async (tx) => {
      const index = await this.deps.indexes.findById(input.indexId, input.tenantId, tx);
      if (index === null) return err(new NotFoundError("Search index not found"));

      index.logQuery(input.term, this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.indexes.save(index, tx);
      return ok(toOutput(index));
    });
  }
}
