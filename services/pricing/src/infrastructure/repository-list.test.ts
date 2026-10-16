import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { Money, ProductRef, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { Price } from "../domain/price";
import { PricingRule } from "../domain/pricing-rule";
import { TaxClass } from "../domain/tax-class";
import {
  InMemoryPricingRuleRepository,
  InMemoryTaxClassRepository,
} from "./in-memory-pricing-registry-repositories";
import { InMemoryPriceRepository } from "./in-memory-price-repository";
import { PricingEventTranslator } from "./pricing-event-translator";

const TENANT = "tenant-a";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function outboxWriter() {
  return new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new PricingEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date(0) },
    producer: "pricing",
  });
}

describe("PriceRepository.findPublishedByProduct (Phase 3 Task 9, H-1)", () => {
  function repo() {
    return new InMemoryPriceRepository({
      outbox: outboxWriter(),
      context: rootEventContext(sequentialIds()),
    });
  }

  it("returns only the published, matching-currency row for the product", async () => {
    const prices = repo();
    const draft = Price.create(
      UniqueEntityId.from("price-draft"),
      "list-1",
      must(ProductRef.create("product-1")),
      must(Money.create(1000, "USD")),
    );
    await prices.save(draft, TENANT);
    const published = Price.create(
      UniqueEntityId.from("price-published"),
      "list-1",
      must(ProductRef.create("product-1")),
      must(Money.create(1500, "USD")),
    );
    published.publish("evt-1", new Date(0));
    await prices.save(published, TENANT);
    const otherCurrency = Price.create(
      UniqueEntityId.from("price-eur"),
      "list-1",
      must(ProductRef.create("product-1")),
      must(Money.create(1500, "EUR")),
    );
    otherCurrency.publish("evt-2", new Date(0));
    await prices.save(otherCurrency, TENANT);

    const matches = await prices.findPublishedByProduct("product-1", "USD", TENANT);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.id.toString()).toBe("price-published");
  });

  it("returns every match when more than one price is concurrently published (caller decides ambiguity)", async () => {
    const prices = repo();
    for (const id of ["price-a", "price-b"]) {
      const price = Price.create(
        UniqueEntityId.from(id),
        "list-1",
        must(ProductRef.create("product-ambiguous")),
        must(Money.create(500, "USD")),
      );
      price.publish(`evt-${id}`, new Date(0));
      await prices.save(price, TENANT);
    }

    const matches = await prices.findPublishedByProduct("product-ambiguous", "USD", TENANT);

    expect(matches).toHaveLength(2);
  });

  it("returns an empty array when nothing published matches", async () => {
    const matches = await repo().findPublishedByProduct("product-nonexistent", "USD", TENANT);
    expect(matches).toEqual([]);
  });

  it("excludes a soft-deleted price even if it was published", async () => {
    const prices = repo();
    const price = Price.create(
      UniqueEntityId.from("price-deleted"),
      "list-1",
      must(ProductRef.create("product-1")),
      must(Money.create(1000, "USD")),
    );
    price.publish("evt-1", new Date(0));
    price.delete();
    await prices.save(price, TENANT);

    const matches = await prices.findPublishedByProduct("product-1", "USD", TENANT);

    expect(matches).toEqual([]);
  });
});

describe("PriceRepository.list (cursor pagination contract, Sprint 7.0, first real consumer)", () => {
  it("pages through prices and reports hasNextPage/endCursor", async () => {
    const repo = new InMemoryPriceRepository({
      outbox: outboxWriter(),
      context: rootEventContext(sequentialIds()),
    });

    for (let i = 0; i < 5; i += 1) {
      const price = Price.create(
        UniqueEntityId.from(`price-${i}`),
        "list-1",
        must(ProductRef.create(`product-${i}`)),
        must(Money.create(1000, "USD")),
      );
      await repo.save(price, TENANT);
    }

    const firstPage = await repo.list({ first: 2 }, TENANT);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.pageInfo.hasNextPage).toBe(true);

    const secondPage = await repo.list(
      { first: 2, after: firstPage.pageInfo.endCursor ?? undefined },
      TENANT,
    );
    expect(secondPage.items).toHaveLength(2);

    const thirdPage = await repo.list(
      { first: 2, after: secondPage.pageInfo.endCursor ?? undefined },
      TENANT,
    );
    expect(thirdPage.items).toHaveLength(1);
    expect(thirdPage.pageInfo.hasNextPage).toBe(false);
  });
});

describe("TaxClassRepository.list (cursor pagination contract, Sprint 7.0)", () => {
  it("pages through tax classes and reports hasNextPage/endCursor", async () => {
    const repo = new InMemoryTaxClassRepository({
      outbox: outboxWriter(),
      context: rootEventContext(sequentialIds()),
    });

    for (let i = 0; i < 3; i += 1) {
      const taxClass = TaxClass.create(
        UniqueEntityId.from(`tc-${i}`),
        `CODE-${i}`,
        `Tax class ${i}`,
        `evt-${i}`,
        new Date(0),
      );
      await repo.save(taxClass, TENANT);
    }

    const firstPage = await repo.list({ first: 2 }, TENANT);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.pageInfo.hasNextPage).toBe(true);

    const secondPage = await repo.list(
      { first: 2, after: firstPage.pageInfo.endCursor ?? undefined },
      TENANT,
    );
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.pageInfo.hasNextPage).toBe(false);
  });
});

describe("PricingRuleRepository.list (cursor pagination contract, Sprint 7.0)", () => {
  it("pages through pricing rules and reports hasNextPage/endCursor", async () => {
    const repo = new InMemoryPricingRuleRepository({
      outbox: outboxWriter(),
      context: rootEventContext(sequentialIds()),
    });

    for (let i = 0; i < 3; i += 1) {
      const rule = must(
        PricingRule.create(
          UniqueEntityId.from(`rule-${i}`),
          "fixed_amount",
          100,
          i,
          `evt-${i}`,
          new Date(0),
        ),
      );
      await repo.save(rule, TENANT);
    }

    const firstPage = await repo.list({ first: 2 }, TENANT);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.pageInfo.hasNextPage).toBe(true);

    const secondPage = await repo.list(
      { first: 2, after: firstPage.pageInfo.endCursor ?? undefined },
      TENANT,
    );
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.pageInfo.hasNextPage).toBe(false);
  });
});

describe("Pricing in-memory repositories tenant isolation (ADR-0014, WP-10 T10.3)", () => {
  function draftPrice(amountMinor: number) {
    return Price.create(
      UniqueEntityId.from("price-shared-id"),
      "list-1",
      must(ProductRef.create("product-1")),
      must(Money.create(amountMinor, "USD")),
    );
  }

  it("keeps the same price id separate per tenant: reads, published lookups and lists never cross", async () => {
    const prices = new InMemoryPriceRepository({
      outbox: outboxWriter(),
      context: rootEventContext(sequentialIds()),
    });
    const inA = draftPrice(1000);
    inA.publish("evt-a", new Date(0));
    await prices.save(inA, "tenant-a");
    await prices.save(draftPrice(2000), "tenant-b");

    expect((await prices.findById("price-shared-id", "tenant-a"))?.amount.amountMinor).toBe(1000);
    expect((await prices.findById("price-shared-id", "tenant-b"))?.amount.amountMinor).toBe(2000);
    expect(await prices.findById("price-shared-id", "tenant-c")).toBeNull();
    expect(await prices.findPublishedByProduct("product-1", "USD", "tenant-a")).toHaveLength(1);
    expect(await prices.findPublishedByProduct("product-1", "USD", "tenant-b")).toHaveLength(0);
    expect((await prices.list({ first: 10 }, "tenant-b")).items).toHaveLength(1);
    expect((await prices.list({ first: 10 }, "tenant-c")).items).toHaveLength(0);
  });

  it("keeps the same tax-class id and code separate per tenant", async () => {
    const taxClasses = new InMemoryTaxClassRepository({
      outbox: outboxWriter(),
      context: rootEventContext(sequentialIds()),
    });
    const make = () =>
      TaxClass.create(UniqueEntityId.from("tc-shared"), "STANDARD", "Standard", "evt", new Date(0));
    await taxClasses.save(make(), "tenant-a");

    expect(await taxClasses.findByCode("STANDARD", "tenant-a")).not.toBeNull();
    expect(await taxClasses.findByCode("STANDARD", "tenant-b")).toBeNull();
    await taxClasses.save(make(), "tenant-b");
    expect((await taxClasses.list({ first: 10 }, "tenant-a")).items).toHaveLength(1);
  });
});

describe("Pricing repositories write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("carries each call's tenantId into the outbox envelope, not the singleton context's", async () => {
    await assertWriteTimeTenant("pricing", async (outbox, tenantId) => {
      const context = rootEventContext(sequentialIds());
      const prices = new InMemoryPriceRepository({ outbox, context });
      const taxClasses = new InMemoryTaxClassRepository({ outbox, context });
      const rules = new InMemoryPricingRuleRepository({ outbox, context });

      const price = Price.create(
        UniqueEntityId.from("price-1"),
        "list-1",
        must(ProductRef.create("product-1")),
        must(Money.create(1000, "USD")),
      );
      price.publish("evt-price", new Date(0));
      await prices.save(price, tenantId);
      await taxClasses.save(
        TaxClass.create(UniqueEntityId.from("tc-1"), "STD", "Standard", "evt-tc", new Date(0)),
        tenantId,
      );
      await rules.save(
        must(
          PricingRule.create(
            UniqueEntityId.from("rule-1"),
            "fixed_amount",
            100,
            1,
            "evt-rule",
            new Date(0),
          ),
        ),
        tenantId,
      );
    });
  });
});
