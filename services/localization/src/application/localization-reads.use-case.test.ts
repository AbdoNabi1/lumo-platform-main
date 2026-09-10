import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { GetLocale } from "./get-locale.use-case";
import { GetTranslationSet } from "./get-translation-set.use-case";
import { ListLocales } from "./list-locales.use-case";
import { ListTranslationSets } from "./list-translation-sets.use-case";
import { CreateLocale, CreateTranslationSet } from "./localization.use-cases";
import {
  InMemoryLocaleRepository,
  InMemoryTranslationSetRepository,
} from "../infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { LocalizationEventTranslator } from "../infrastructure/localization-event-translator";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };

function harness() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new LocalizationEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "localization",
  });
  const context = rootEventContext(sequentialIds());
  const locales = new InMemoryLocaleRepository({ outbox, context });
  const translationSets = new InMemoryTranslationSetRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  return { locales, translationSets, unitOfWork, idGenerator, clock };
}

describe("Localization read use-cases (Phase 4 T4.11)", () => {
  it("ListLocales paginates and GetLocale returns the locale, or NotFoundError", async () => {
    const h = harness();
    const create = new CreateLocale(h);
    await create.execute({ code: "en", name: "English", isDefault: true, tenantId: "tenant-1" });
    const created = await create.execute({
      code: "fr",
      name: "French",
      isDefault: false,
      tenantId: "tenant-1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const listed = await new ListLocales(h).execute({ first: 10, tenantId: "tenant-1" });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.items).toHaveLength(2);

    const found = await new GetLocale(h).execute({
      localeId: created.value.localeId,
      tenantId: "tenant-1",
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.code.value).toBe("fr");

    const missing = await new GetLocale(h).execute({ localeId: "nope", tenantId: "tenant-1" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });

  it("ListTranslationSets paginates and GetTranslationSet returns the set, or NotFoundError", async () => {
    const h = harness();
    const created = await new CreateTranslationSet(h).execute({
      localeRef: "en",
      namespace: "common",
      tenantId: "tenant-1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const listed = await new ListTranslationSets(h).execute({ first: 10, tenantId: "tenant-1" });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.items).toHaveLength(1);

    const found = await new GetTranslationSet(h).execute({
      translationSetId: created.value.translationSetId,
      tenantId: "tenant-1",
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.namespace).toBe("common");

    const missing = await new GetTranslationSet(h).execute({
      translationSetId: "nope",
      tenantId: "tenant-1",
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});
