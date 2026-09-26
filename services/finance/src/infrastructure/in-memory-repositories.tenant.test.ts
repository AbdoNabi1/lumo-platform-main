import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import { Money, UniqueEntityId } from "@platform/domain";
import { rootEventContext } from "@platform/messaging";
import {
  assertWriteTimeTenant,
  tenantRowIsolationCases,
  type TenantRowIsolationFixture,
  type TenantRowStore,
} from "@platform/messaging/testing";
import { Account } from "../domain/account";
import { Expense } from "../domain/expense";
import { FiscalPeriod } from "../domain/fiscal-period";
import type { ReadModelStore } from "../domain/read-model-store";
import type { AccountRepository } from "../domain/repositories";
import { AccountType } from "../domain/value-objects/account-type";
import { ClickHouseReadModelStore } from "./clickhouse-read-model-store";
import { InMemoryReadModelStore } from "./in-memory-read-model-store";
import { PrismaAccountRepository } from "./prisma-finance-repositories";
import {
  InMemoryAccountRepository,
  InMemoryExpenseRepository,
  InMemoryFiscalPeriodRepository,
} from "./in-memory-repositories";

let n = 0;
const nextId = () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;

function usd(minor: number): Money {
  const money = Money.create(minor, "USD");
  if (!money.ok) throw new Error("test setup: invalid money");
  return money.value;
}

describe("finance in-memory repositories write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("ExpenseRepository: the envelope carries the per-call tenantId", async () => {
    await assertWriteTimeTenant("finance/expense", async (outbox, tenantId) => {
      const repository = new InMemoryExpenseRepository({
        outbox,
        context: rootEventContext({ generate: nextId }),
      });
      const expense = Expense.record(
        UniqueEntityId.from(nextId()),
        "cc-1",
        "cat-1",
        usd(1000),
        "Rent",
        new Date(0),
        nextId(),
        new Date(0),
      );
      await repository.save(expense, tenantId);
    });
  });

  it("FiscalPeriodRepository: the envelope carries the per-call tenantId when the period raises events", async () => {
    await assertWriteTimeTenant("finance/fiscal-period", async (outbox, tenantId) => {
      const repository = new InMemoryFiscalPeriodRepository({
        outbox,
        context: rootEventContext({ generate: nextId }),
      });
      const period = FiscalPeriod.open(
        UniqueEntityId.from(nextId()),
        new Date(0),
        new Date(86_400_000),
      );
      period.close(nextId(), new Date(0));
      await repository.save(period, tenantId);
    });
  });
});

// ── T10.5 row isolation (shared harness) ─────────────────────────────────────────────────────────
// One call per store: `@platform/messaging/testing`'s `tenantRowIsolationCases`. These run the
// production Prisma / ClickHouse adapters over fakes that apply their filters literally, so a
// missing `tenantId` in a `where` / SQL predicate is a real leak here — RLS is not in the loop.

const accountType = AccountType.from("asset");

function accountStore(repo: AccountRepository): TenantRowStore {
  const account = (key: string, marker: string, version: number) =>
    Account.reconstitute(UniqueEntityId.from(key), key, marker, accountType, true, version);
  return {
    insert: (tenantId, key, marker) => repo.save(account(key, marker, 0), tenantId),
    find: async (tenantId, key) => (await repo.findById(key, tenantId))?.name ?? null,
    list: async (tenantId) => (await repo.list(tenantId)).map((a) => a.name),
    // Forged aggregate: same id as the victim's row, submitted under the attacker's tenant.
    update: (tenantId, key, marker) => repo.save(account(key, marker, 1), tenantId),
  };
}

describe("finance account tenant isolation (T10.5)", () => {
  const inMemory: TenantRowIsolationFixture = {
    context: "finance/account",
    layer: "in-memory adapter",
    make: () => accountStore(new InMemoryAccountRepository()),
  };
  const prisma: TenantRowIsolationFixture = {
    context: "finance/account",
    layer: "prisma repository over fake-prisma (app-layer where, no RLS)",
    make: () => accountStore(new PrismaAccountRepository({ prisma: createFakePrisma().database })),
  };
  for (const fixture of [inMemory, prisma])
    for (const c of tenantRowIsolationCases(fixture)) it(c.name, c.run);
});

/** A ClickHouse client double that honours a predicate ONLY if the SQL text contains it. */
function fakeClickHouse(): ClickHouseClient {
  interface Stored {
    tenant_id: string;
    model: string;
    key: string;
    value: string;
  }
  const table: Stored[] = [];
  const client = {
    command: async () => undefined,
    insert: async ({ values }: { values: Stored[] }) => {
      for (const v of values) {
        const at = table.findIndex(
          (r) => r.tenant_id === v.tenant_id && r.model === v.model && r.key === v.key,
        );
        if (at >= 0)
          table[at] = v; // ReplacingMergeTree: latest wins per (tenant, model, key)
        else table.push(v);
      }
    },
    query: async ({
      query,
      query_params,
    }: {
      query: string;
      query_params: Record<string, unknown>;
    }) => {
      const has = (predicate: string) => query.replace(/\s+/g, " ").includes(predicate);
      let rows = [...table];
      if (has("tenant_id = {tenantId:String}"))
        rows = rows.filter((r) => r.tenant_id === query_params["tenantId"]);
      if (has("model = {model:String}"))
        rows = rows.filter((r) => r.model === query_params["model"]);
      if (has("key = {key:String}")) rows = rows.filter((r) => r.key === query_params["key"]);
      rows.sort((a, b) => a.key.localeCompare(b.key));
      const total = rows.length;
      const limit = query_params["limit"];
      const limited = typeof limit === "number" ? rows.slice(0, limit) : rows;
      return { json: async () => limited.map((r) => ({ ...r, total: String(total) })) };
    },
  };
  return client as unknown as ClickHouseClient;
}

function readModelStore(store: ReadModelStore): TenantRowStore {
  return {
    insert: (tenantId, key, marker) => store.put("profit", key, { marker }, tenantId),
    find: async (tenantId, key) =>
      ((await store.get("profit", key, tenantId)) as { marker: string } | null)?.marker ?? null,
    list: async (tenantId) =>
      (await store.list("profit", tenantId)).map((v) => (v as { marker: string }).marker),
    // `total` is the count / pagination-total surface: `count() OVER ()` in SQL.
    count: async (tenantId) => (await store.query("profit", {}, tenantId)).total,
    // A read-model `put` is an upsert addressed by (tenant, model, key) — the attacker can only
    // ever address its own tenant's namespace, so this is the strongest write available.
    update: (tenantId, key, marker) => store.put("profit", key, { marker }, tenantId),
  };
}

describe("finance read-model tenant isolation, incl. count (T10.5)", () => {
  const fixtures: TenantRowIsolationFixture[] = [
    {
      context: "finance/read-model",
      layer: "in-memory store, query().total",
      make: () => readModelStore(new InMemoryReadModelStore()),
    },
    {
      context: "finance/read-model",
      layer: "clickhouse store over fake client (predicate honoured only if in the SQL)",
      make: () => readModelStore(new ClickHouseReadModelStore({ client: fakeClickHouse() })),
    },
  ];
  for (const fixture of fixtures)
    for (const c of tenantRowIsolationCases(fixture)) it(c.name, c.run);
});

// ── lookups the shared harness has no operation for ─────────────────────────────────────────────
// `findByCode` is a second address for the same row. Its filter is a separate guard from `findById`'s,
// and removing it from either adapter used to turn nothing red (found by WP-10's mutation pass).
describe("finance account findByCode is tenant-scoped (T10.5 gap closed by the WP-10 DoD pass)", () => {
  const layers: Array<[string, () => AccountRepository]> = [
    ["in-memory adapter", () => new InMemoryAccountRepository()],
    [
      "prisma repository over fake-prisma",
      () => new PrismaAccountRepository({ prisma: createFakePrisma().database }),
    ],
  ];
  for (const [layer, make] of layers) {
    it(`${layer}: tenant B cannot find tenant A's account by its code`, async () => {
      const repo = make();
      const acc = Account.reconstitute(
        UniqueEntityId.from("acc-1"),
        "1000",
        "A's cash",
        accountType,
        true,
        0,
      );
      await repo.save(acc, "tenant-a");
      expect((await repo.findByCode("1000", "tenant-a"))?.name).toBe("A's cash");
      expect(await repo.findByCode("1000", "tenant-b")).toBeNull();
    });

    it(`${layer}: the same code in two tenants resolves to each tenant's own account`, async () => {
      const repo = make();
      await repo.save(
        Account.reconstitute(UniqueEntityId.from("acc-a"), "1000", "A", accountType, true, 0),
        "tenant-a",
      );
      await repo.save(
        Account.reconstitute(UniqueEntityId.from("acc-b"), "1000", "B", accountType, true, 0),
        "tenant-b",
      );
      expect((await repo.findByCode("1000", "tenant-a"))?.name).toBe("A");
      expect((await repo.findByCode("1000", "tenant-b"))?.name).toBe("B");
    });
  }
});
