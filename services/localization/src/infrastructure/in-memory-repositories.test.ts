import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Locale } from "../domain/locale";
import { TranslationSet } from "../domain/translation-set";
import { LocaleCode } from "../domain/value-objects/locale-code";
import {
  InMemoryLocaleRepository,
  InMemoryTranslationSetRepository,
} from "./in-memory-repositories";
import { LocalizationEventTranslator } from "./localization-event-translator";

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new LocalizationEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-08-30T00:00:00.000Z") },
    producer: "localization",
  });
  const context = rootEventContext({ generate: nextId });
  return {
    locales: new InMemoryLocaleRepository({ outbox, context }),
    translationSets: new InMemoryTranslationSetRepository({ outbox, context }),
    nextId,
  };
}

describe("InMemoryLocaleRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's locale by id, code, or list, through a single repository instance", async () => {
    const { locales, nextId } = wire();
    const code = LocaleCode.create("en");
    if (!code.ok) throw new Error("test setup: invalid locale code");
    const locale = Locale.create(UniqueEntityId.from(nextId()), code.value, "English", false);
    await locales.save(locale, "tenant-a");

    expect(await locales.findById(locale.id.toString(), "tenant-a")).not.toBeNull();
    expect(await locales.findById(locale.id.toString(), "tenant-b")).toBeNull();

    expect(await locales.findByCode("en", "tenant-a")).not.toBeNull();
    expect(await locales.findByCode("en", "tenant-b")).toBeNull();

    const pageA = await locales.list({}, "tenant-a");
    const pageB = await locales.list({}, "tenant-b");
    expect(pageA.items.map((l) => l.id.toString())).toContain(locale.id.toString());
    expect(pageB.items.map((l) => l.id.toString())).not.toContain(locale.id.toString());
  });
});

describe("InMemoryTranslationSetRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's translation set by id, locale+namespace, or list, through a single repository instance", async () => {
    const { translationSets, nextId } = wire();
    const set = TranslationSet.create(UniqueEntityId.from(nextId()), "en", "common");
    await translationSets.save(set, "tenant-a");

    expect(await translationSets.findById(set.id.toString(), "tenant-a")).not.toBeNull();
    expect(await translationSets.findById(set.id.toString(), "tenant-b")).toBeNull();

    expect(
      await translationSets.findByLocaleAndNamespace("en", "common", "tenant-a"),
    ).not.toBeNull();
    expect(await translationSets.findByLocaleAndNamespace("en", "common", "tenant-b")).toBeNull();

    const pageA = await translationSets.list({}, "tenant-a");
    const pageB = await translationSets.list({}, "tenant-b");
    expect(pageA.items.map((s) => s.id.toString())).toContain(set.id.toString());
    expect(pageB.items.map((s) => s.id.toString())).not.toContain(set.id.toString());
  });
});
