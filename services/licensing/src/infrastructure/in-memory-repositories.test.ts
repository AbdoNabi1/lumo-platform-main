import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { Credit } from "../domain/credit";
import { Invoice } from "../domain/invoice";
import { MerchantCapabilities } from "../domain/merchant-capabilities";
import { MerchantFeatureOverride } from "../domain/merchant-feature-override";
import { Plan } from "../domain/plan";
import { Subscription } from "../domain/subscription";
import { UsageCounter } from "../domain/usage-counter";
import {
  InMemoryCreditRepository,
  InMemoryInvoiceRepository,
  InMemoryMerchantCapabilitiesRepository,
  InMemoryMerchantFeatureOverrideRepository,
  InMemoryPlanRepository,
  InMemorySubscriptionRepository,
  InMemoryUsageCounterRepository,
} from "./in-memory-repositories";
import { LicensingEventTranslator } from "./licensing-event-translator";

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

const clock = { now: () => new Date("2026-08-14T00:00:00.000Z") };

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new LicensingEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "licensing",
  });
  const context = rootEventContext({ generate: nextId });
  return { outbox, context, nextId };
}

describe("Licensing in-memory repositories tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("InMemoryPlanRepository: a single instance cannot leak a plan across tenants", async () => {
    const { outbox, context, nextId } = wire();
    const repo = new InMemoryPlanRepository({ outbox, context });
    const plan = Plan.create(
      UniqueEntityId.from(nextId()),
      "growth",
      "Growth",
      "growth",
      nextId(),
      clock.now(),
    );
    await repo.save(plan, "tenant-a");

    expect(await repo.findById(plan.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repo.findById(plan.id.toString(), "tenant-b")).toBeNull();
    expect(await repo.findByKey("growth", "tenant-a")).not.toBeNull();
    expect(await repo.findByKey("growth", "tenant-b")).toBeNull();
  });

  it("InMemorySubscriptionRepository: a single instance cannot leak a subscription across tenants", async () => {
    const { outbox, context, nextId } = wire();
    const repo = new InMemorySubscriptionRepository({ outbox, context });
    const subscription = Subscription.startTrial(
      UniqueEntityId.from(nextId()),
      "merchant-1",
      "plan-version-1",
      nextId(),
      clock.now(),
    );
    await repo.save(subscription, "tenant-a");

    expect(await repo.findById(subscription.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repo.findById(subscription.id.toString(), "tenant-b")).toBeNull();
    expect(await repo.findByTenantRef("merchant-1", "tenant-a")).not.toBeNull();
    expect(await repo.findByTenantRef("merchant-1", "tenant-b")).toBeNull();
  });

  it("InMemoryMerchantFeatureOverrideRepository: a single instance cannot leak an override across tenants", async () => {
    const { outbox, context, nextId } = wire();
    const repo = new InMemoryMerchantFeatureOverrideRepository({ outbox, context });
    const override = MerchantFeatureOverride.create(
      UniqueEntityId.from(nextId()),
      "merchant-1",
      "beta-feature",
      "enabled",
      nextId(),
      clock.now(),
    );
    await repo.save(override, "tenant-a");

    expect(await repo.findById(override.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repo.findById(override.id.toString(), "tenant-b")).toBeNull();
    expect(
      await repo.findByTenantRefAndFeatureKey("merchant-1", "beta-feature", "tenant-a"),
    ).not.toBeNull();
    expect(
      await repo.findByTenantRefAndFeatureKey("merchant-1", "beta-feature", "tenant-b"),
    ).toBeNull();
  });

  it("InMemoryMerchantCapabilitiesRepository: a single instance cannot leak capabilities across tenants", async () => {
    const { outbox, context, nextId } = wire();
    const repo = new InMemoryMerchantCapabilitiesRepository({ outbox, context });
    const capabilities = MerchantCapabilities.create(
      UniqueEntityId.from(nextId()),
      "merchant-1",
      nextId(),
      clock.now(),
    );
    await repo.save(capabilities, "tenant-a");

    expect(await repo.findById(capabilities.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repo.findById(capabilities.id.toString(), "tenant-b")).toBeNull();
    expect(await repo.findByTenantRef("merchant-1", "tenant-a")).not.toBeNull();
    expect(await repo.findByTenantRef("merchant-1", "tenant-b")).toBeNull();
  });

  it("InMemoryUsageCounterRepository: a single instance cannot leak a counter across tenants", async () => {
    const { outbox, context, nextId } = wire();
    const repo = new InMemoryUsageCounterRepository({ outbox, context });
    const counter = UsageCounter.create(
      UniqueEntityId.from(nextId()),
      "merchant-1",
      "AI_TOKEN",
      nextId(),
      clock.now(),
    );
    await repo.save(counter, "tenant-a");

    expect(await repo.findById(counter.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repo.findById(counter.id.toString(), "tenant-b")).toBeNull();
    expect(
      await repo.findByTenantRefAndResource("merchant-1", "AI_TOKEN", "tenant-a"),
    ).not.toBeNull();
    expect(await repo.findByTenantRefAndResource("merchant-1", "AI_TOKEN", "tenant-b")).toBeNull();
  });

  it("InMemoryCreditRepository: a single instance cannot leak a credit across tenants", async () => {
    const { outbox, context, nextId } = wire();
    const repo = new InMemoryCreditRepository({ outbox, context });
    const credit = Credit.grant(
      UniqueEntityId.from(nextId()),
      "merchant-1",
      1000,
      "signup bonus",
      nextId(),
      clock.now(),
    );
    await repo.save(credit, "tenant-a");

    expect(await repo.findById(credit.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repo.findById(credit.id.toString(), "tenant-b")).toBeNull();
  });

  it("InMemoryInvoiceRepository: a single instance cannot leak an invoice across tenants", async () => {
    const { outbox, context, nextId } = wire();
    const repo = new InMemoryInvoiceRepository({ outbox, context });
    const invoice = Invoice.createDraft(
      UniqueEntityId.from(nextId()),
      "merchant-1",
      "sub-1",
      "USD",
      [{ description: "seat", amount: 2900 }],
      nextId(),
      clock.now(),
    );
    await repo.save(invoice, "tenant-a");

    expect(await repo.findById(invoice.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repo.findById(invoice.id.toString(), "tenant-b")).toBeNull();
  });
});

describe("InMemoryPlanRepository write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("carries each call's tenantId into the outbox envelope, not the singleton context's", async () => {
    await assertWriteTimeTenant("licensing", async (outbox, tenantId) => {
      const nextId = monotonicIds();
      const repository = new InMemoryPlanRepository({
        outbox,
        context: rootEventContext({ generate: nextId }),
      });
      const agg = Plan.create(
        UniqueEntityId.from(nextId()),
        "growth",
        "Growth",
        "growth",
        nextId(),
        clock.now(),
      );
      await repository.save(agg, tenantId);
    });
  });
});
