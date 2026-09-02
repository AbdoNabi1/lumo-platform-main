import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ConcurrencyError } from "@platform/utils";
import {
  CreateIndex,
  UpsertDocument,
  type SearchProviderDeps,
} from "./application/search.use-cases";
import type { IndexProviderPort } from "./application/ports";
import type { SearchDocument } from "./domain/value-objects/search-document";
import type { SearchIndex } from "./domain/search-index";
import type { SearchIndexRepository } from "./domain/search-index-repository";
import { SearchIndexMapper, type SearchIndexRow } from "./infrastructure/search-index.mapper";

/**
 * Phase A.15 — same fake shapes as `services/payments/src/create-intent-transaction-boundary.test.ts`
 * (Phase A.13): a Postgres-like repository reproducing `PrismaSearchIndexRepository`'s
 * optimistic-lock (`version`) contract, and a `TrackingUnitOfWork` that counts currently-open
 * `run()` calls so an `IndexProviderPort` fake can prove whether it was invoked while a
 * transaction was open.
 */
class PostgresLikeSearchIndexRepository implements SearchIndexRepository {
  private readonly rows = new Map<string, SearchIndexRow>();
  private readonly tenantId = "tenant-local";

  async save(index: SearchIndex): Promise<void> {
    const id = index.id.toString();
    const existing = this.rows.get(id);
    const row = SearchIndexMapper.toRow(index, this.tenantId);
    if (existing === undefined) {
      this.rows.set(id, { ...row, version: 1 });
      return;
    }
    if (existing.version !== index.version) {
      throw new ConcurrencyError(
        `Search index ${id} was modified concurrently (expected version ${index.version})`,
      );
    }
    this.rows.set(id, { ...row, version: existing.version + 1 });
  }

  async findById(id: string): Promise<SearchIndex | null> {
    const row = this.rows.get(id);
    if (row === undefined) return null;
    return SearchIndexMapper.toDomain(row);
  }

  async findByName(name: string): Promise<SearchIndex | null> {
    for (const row of this.rows.values()) {
      if (row.name === name) return SearchIndexMapper.toDomain(row);
    }
    return null;
  }

  async list(): Promise<{
    readonly items: readonly SearchIndex[];
    readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
  }> {
    const items = [...this.rows.values()].map((row) => SearchIndexMapper.toDomain(row));
    return { items, pageInfo: { hasNextPage: false, endCursor: null } };
  }

  size(): number {
    return this.rows.size;
  }
}

/** Tracks how many `run()` calls are currently open — a stand-in for "a live DB transaction is held". */
class TrackingUnitOfWork implements TransactionalUnitOfWork<unknown> {
  openCount = 0;
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    this.openCount += 1;
    try {
      return await work(undefined);
    } finally {
      this.openCount -= 1;
    }
  }
}

class RecordingIndexProvider implements IndexProviderPort {
  readonly calls: Array<{ productRef: string; openCountAtCall: number }> = [];

  constructor(
    private readonly uow?: TrackingUnitOfWork,
    private readonly failAlways = false,
  ) {}

  async upsert(document: SearchDocument): Promise<void> {
    this.calls.push({
      productRef: document.productRef,
      openCountAtCall: this.uow?.openCount ?? -1,
    });
    if (this.failAlways) {
      throw new Error("simulated index provider upsert failure");
    }
  }

  async delete(): Promise<void> {
    throw new Error("not used by this test");
  }
}

let globalIdCounter = 0;
function sequentialIds(prefix: string): IdGenerator {
  return { generate: () => `${prefix}-${(globalIdCounter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-12T00:00:00.000Z") };

function buildDeps(
  repo: SearchIndexRepository,
  provider: IndexProviderPort,
  unitOfWork: TransactionalUnitOfWork<unknown>,
): SearchProviderDeps {
  return {
    indexes: repo,
    unitOfWork,
    idGenerator: sequentialIds("evt"),
    clock,
    provider,
  };
}

async function seedIndex(
  repo: SearchIndexRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
): Promise<string> {
  const createDeps = buildDeps(repo, new RecordingIndexProvider(), unitOfWork);
  const created = await new CreateIndex(createDeps).execute({ name: "products" });
  if (!created.ok) throw new Error("seed failed");
  return created.value.indexId;
}

describe("Task 1 — exploit proof: IndexProviderPort.upsert() call happens while a DB transaction is open", () => {
  it("EXPLOIT (pre-fix shape): would show upsert() invoked with a transaction still open", async () => {
    const repo = new PostgresLikeSearchIndexRepository();
    const uow = new TrackingUnitOfWork();
    const indexId = await seedIndex(repo, uow);

    const provider = new RecordingIndexProvider(uow);
    const lifecycle = new UpsertDocument(buildDeps(repo, provider, uow));

    const result = await lifecycle.execute({
      indexId,
      productRef: "product-1",
      title: "Running shoes",
      categoryRefs: ["footwear"],
    });

    expect(result.ok).toBe(true);
    expect(provider.calls).toHaveLength(1);
    // Fixed behavior: the precheck's transaction is committed BEFORE the provider call — no
    // transaction should be open while the provider network call is in flight.
    expect(provider.calls[0]?.openCountAtCall).toBe(0);
  });
});

describe("Task 2 — provider failure recovery on upsert", () => {
  it("a provider upsert failure leaves the index record unchanged and rethrows the original error", async () => {
    const repo = new PostgresLikeSearchIndexRepository();
    const uow = new TrackingUnitOfWork();
    const indexId = await seedIndex(repo, uow);

    const before = await repo.findById(indexId);
    expect(before?.documentCount).toBe(0);

    const failingProvider = new RecordingIndexProvider(uow, true);
    const lifecycle = new UpsertDocument(buildDeps(repo, failingProvider, uow));

    await expect(
      lifecycle.execute({
        indexId,
        productRef: "product-1",
        title: "Running shoes",
        categoryRefs: [],
      }),
    ).rejects.toThrow(/simulated index provider upsert failure/);

    // No domain mutation happened: recordDocumentUpserted/save were never reached, so the index
    // still correctly reflects that indexing did not happen (matches the pre-fix single-tx
    // version's behavior — a provider throw there aborted the transaction too).
    const after = await repo.findById(indexId);
    expect(after?.documentCount).toBe(0);
    expect(after?.version).toBe(before?.version);
  });

  it("a subsequent upsert after a provider failure succeeds independently", async () => {
    const repo = new PostgresLikeSearchIndexRepository();
    const uow = new TrackingUnitOfWork();
    const indexId = await seedIndex(repo, uow);

    const failingProvider = new RecordingIndexProvider(uow, true);
    const failingLifecycle = new UpsertDocument(buildDeps(repo, failingProvider, uow));
    await expect(
      failingLifecycle.execute({ indexId, productRef: "product-1", title: "t", categoryRefs: [] }),
    ).rejects.toThrow();

    const workingProvider = new RecordingIndexProvider(uow, false);
    const retryLifecycle = new UpsertDocument(buildDeps(repo, workingProvider, uow));
    const retried = await retryLifecycle.execute({
      indexId,
      productRef: "product-1",
      title: "t",
      categoryRefs: [],
    });

    expect(retried.ok).toBe(true);
    if (retried.ok) expect(retried.value.documentCount).toBe(1);
  });
});

describe("Task 3 — concurrent upserts never lose updates or leak ConcurrencyError", () => {
  for (let iteration = 1; iteration <= 3; iteration += 1) {
    it(`run ${iteration}/3: 5 concurrent upserts against the same index all succeed and documentCount reflects all of them`, async () => {
      const repo = new PostgresLikeSearchIndexRepository();
      const uow = new TrackingUnitOfWork();
      const indexId = await seedIndex(repo, uow);
      const provider = new RecordingIndexProvider(uow);

      const productRefs = ["p-1", "p-2", "p-3", "p-4", "p-5"];
      const results = await Promise.all(
        productRefs.map((productRef) =>
          new UpsertDocument(buildDeps(repo, provider, uow)).execute({
            indexId,
            productRef,
            title: `title-${productRef}`,
            categoryRefs: [],
          }),
        ),
      );

      for (const result of results) {
        expect(result.ok).toBe(true);
      }

      const final = await repo.findById(indexId);
      expect(final?.documentCount).toBe(5);
      expect(provider.calls).toHaveLength(5);
    });
  }
});
