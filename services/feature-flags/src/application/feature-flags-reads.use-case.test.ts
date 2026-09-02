import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { CreateFeatureFlag } from "./feature-flag.use-cases";
import { GetFeatureFlag } from "./get-feature-flag.use-case";
import { ListFeatureFlags } from "./list-feature-flags.use-case";
import { FeatureFlagsEventTranslator } from "../infrastructure/feature-flags-event-translator";
import { InMemoryFeatureFlagRepository } from "../infrastructure/in-memory-feature-flag-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };

function harness() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new FeatureFlagsEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "feature_flags",
  });
  const context = rootEventContext(sequentialIds());
  const flags = new InMemoryFeatureFlagRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  return { flags, unitOfWork, idGenerator, clock };
}

describe("Feature Flags read use-cases (Phase 4 T4.16)", () => {
  it("ListFeatureFlags paginates", async () => {
    const h = harness();
    const create = new CreateFeatureFlag(h);
    for (let i = 0; i < 3; i += 1) {
      await create.execute({ key: `flag-${i}`, name: `Flag ${i}` });
    }

    const page = await new ListFeatureFlags(h).execute({ first: 2 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(2);
    expect(page.value.pageInfo.hasNextPage).toBe(true);

    const rest = await new ListFeatureFlags(h).execute({
      first: 10,
      after: page.value.pageInfo.endCursor ?? undefined,
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.value.items).toHaveLength(1);
    expect(rest.value.pageInfo.hasNextPage).toBe(false);
  });

  it("GetFeatureFlag returns the flag, or NotFoundError when absent", async () => {
    const h = harness();
    const created = await new CreateFeatureFlag(h).execute({
      key: "new-checkout",
      name: "New Checkout",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await new GetFeatureFlag(h).execute({ flagId: created.value.flagId });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.key).toBe("new-checkout");

    const missing = await new GetFeatureFlag(h).execute({ flagId: "nope" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});
