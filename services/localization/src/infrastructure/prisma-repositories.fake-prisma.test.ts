import { describe, expect, it } from "vitest";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createFakePrisma } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import { Locale } from "../domain/locale";
import { TranslationSet } from "../domain/translation-set";
import { LocaleCode } from "../domain/value-objects/locale-code";
import { LocalizationEventTranslator } from "./localization-event-translator";
import { LocaleMapper } from "./mappers";
import { PrismaLocaleRepository, PrismaTranslationSetRepository } from "./prisma-repositories";

/**
 * The localization Prisma repositories over `@platform/db/testing`'s fake client: row mapping, the
 * create/CAS-update branches, same-transaction outbox writes and tenant scoping, on every
 * `pnpm test`. Real SQL stays with the `DATABASE_URL_TEST`-gated integration suite.
 */
const T0 = new Date("2026-07-05T00:00:00.000Z");

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const fake = createFakePrisma();
  const prisma = fake.database;
  const outbox = new OutboxWriter({
    store: new PrismaOutboxStore(prisma),
    translator: new LocalizationEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => T0 },
    producer: "localization",
  });
  const deps = { prisma, outbox, context: rootEventContext({ generate: nextId }) };
  const locales = new PrismaLocaleRepository(deps);
  const sets = new PrismaTranslationSetRepository(deps);
  const unitOfWork = new PrismaUnitOfWork(prisma);
  return {
    fake,
    locales,
    sets,
    nextId,
    saveLocale: (locale: Locale, tenantId: string) =>
      unitOfWork.run((tx) => locales.save(locale, tenantId, tx)),
    saveSet: (set: TranslationSet, tenantId: string) =>
      unitOfWork.run((tx) => sets.save(set, tenantId, tx)),
  };
}

function locale(id: string, code: string, isDefault = false, fallbackLocaleRef?: string): Locale {
  const parsed = LocaleCode.create(code);
  if (!parsed.ok) throw new Error("test setup: invalid locale code");
  return Locale.create(UniqueEntityId.from(id), parsed.value, code, isDefault, fallbackLocaleRef);
}

describe("PrismaLocaleRepository over a fake client", () => {
  it("creates a locale and reads it back by id and by code, fallback included", async () => {
    const { locales, saveLocale, nextId } = wire();
    const arEg = locale(nextId(), "ar-EG", false, "ar");

    await saveLocale(arEg, "tenant-a");

    const byId = await locales.findById(arEg.id.toString(), "tenant-a");
    expect(byId?.code.value).toBe("ar-EG");
    expect(byId?.isDefault).toBe(false);
    expect(byId?.status).toBe("active");
    expect(byId?.fallbackLocaleRef).toBe("ar");
    expect(byId?.version).toBe(1);
    expect((await locales.findByCode("ar-EG", "tenant-a"))?.id.toString()).toBe(arEg.id.toString());
  });

  it("stores no fallback as null and reads it back as undefined", async () => {
    const { fake, locales, saveLocale, nextId } = wire();
    const en = locale(nextId(), "en", true);

    await saveLocale(en, "tenant-a");

    expect(fake.rowsOf("locale")[0]?.["fallbackLocaleRef"]).toBeNull();
    expect((await locales.findByCode("en", "tenant-a"))?.fallbackLocaleRef).toBeUndefined();
  });

  it("updates a loaded locale's status with a version check, writing its event to the outbox", async () => {
    const { fake, locales, saveLocale, nextId } = wire();
    const fr = locale(nextId(), "fr");
    await saveLocale(fr, "tenant-a");

    const loaded = (await locales.findById(fr.id.toString(), "tenant-a"))!;
    loaded.deactivate(nextId(), T0);
    await saveLocale(loaded, "tenant-a");

    const reloaded = await locales.findById(fr.id.toString(), "tenant-a");
    expect(reloaded?.status).toBe("inactive");
    expect(reloaded?.version).toBe(2);
    expect(fake.rowsOf("outboxEntry")).toHaveLength(1);
  });

  it("rejects a save from a stale copy with ConcurrencyError", async () => {
    const { locales, saveLocale, nextId } = wire();
    const fr = locale(nextId(), "fr");
    await saveLocale(fr, "tenant-a");
    const first = (await locales.findById(fr.id.toString(), "tenant-a"))!;
    const second = (await locales.findById(fr.id.toString(), "tenant-a"))!;

    first.deactivate(nextId(), T0);
    await saveLocale(first, "tenant-a");
    second.activate(nextId(), T0);

    await expect(saveLocale(second, "tenant-a")).rejects.toBeInstanceOf(ConcurrencyError);
    expect((await locales.findById(fr.id.toString(), "tenant-a"))?.status).toBe("inactive");
  });

  it("refuses to save outside a unit of work (ADR-0003)", async () => {
    const { locales, nextId } = wire();

    await expect(locales.save(locale(nextId(), "fr"), "tenant-a")).rejects.toThrow(
      /transaction client/,
    );
  });

  it("never reads or updates another tenant's locale (ADR-0014)", async () => {
    const { locales, saveLocale, nextId } = wire();
    const fr = locale(nextId(), "fr");
    await saveLocale(fr, "tenant-a");

    expect(await locales.findById(fr.id.toString(), "tenant-b")).toBeNull();
    expect(await locales.findByCode("fr", "tenant-b")).toBeNull();
    expect((await locales.list({}, "tenant-b")).items).toEqual([]);

    const loaded = (await locales.findById(fr.id.toString(), "tenant-a"))!;
    loaded.deactivate(nextId(), T0);
    await expect(saveLocale(loaded, "tenant-b")).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it("lists a tenant's locales a page at a time, and reuses a given transaction client", async () => {
    const { fake, locales, saveLocale, nextId } = wire();
    for (const code of ["de", "en", "fr"]) await saveLocale(locale(nextId(), code), "tenant-a");

    const first = await locales.list({ first: 2 }, "tenant-a");
    expect(first.items.map((l) => l.code.value)).toEqual(["de", "en"]);
    expect(first.pageInfo.hasNextPage).toBe(true);
    const rest = await locales.list({ after: first.pageInfo.endCursor! }, "tenant-a");
    expect(rest.items.map((l) => l.code.value)).toEqual(["fr"]);

    const tx = fake.database;
    expect((await locales.list({}, "tenant-a", tx)).items).toHaveLength(3);
    expect(await locales.findByCode("de", "tenant-a", tx)).not.toBeNull();
    expect(await locales.findById(first.items[0]!.id.toString(), "tenant-a", tx)).not.toBeNull();
  });
});

describe("PrismaTranslationSetRepository over a fake client", () => {
  it("creates a set and reads its translations back by id and by locale + namespace", async () => {
    const { sets, saveSet, nextId } = wire();
    const set = TranslationSet.create(UniqueEntityId.from(nextId()), "ar-EG", "checkout");
    set.setTranslation("cta", "ادفع الآن", nextId(), T0);
    set.publishTranslation("cta", nextId(), T0);

    await saveSet(set, "tenant-a");

    const loaded = await sets.findByLocaleAndNamespace("ar-EG", "checkout", "tenant-a");
    expect(loaded?.id.toString()).toBe(set.id.toString());
    expect(loaded?.version).toBe(1);
    expect(loaded?.resolve("cta")).toBe("ادفع الآن");
    expect((await sets.findById(set.id.toString(), "tenant-a"))?.translations).toHaveLength(1);
  });

  it("writes every translation event to the outbox through the same transaction client", async () => {
    const { fake, saveSet, nextId } = wire();
    const set = TranslationSet.create(UniqueEntityId.from(nextId()), "en", "checkout");
    set.setTranslation("cta", "Pay now", nextId(), T0);
    set.setTranslation("back", "Back", nextId(), T0);

    await saveSet(set, "tenant-a");

    expect(fake.rowsOf("outboxEntry")).toHaveLength(2);
  });

  it("replaces the stored translations on update, with a version check", async () => {
    const { sets, saveSet, nextId } = wire();
    const set = TranslationSet.create(UniqueEntityId.from(nextId()), "en", "checkout");
    set.setTranslation("cta", "Pay now", nextId(), T0);
    set.setTranslation("back", "Back", nextId(), T0);
    await saveSet(set, "tenant-a");

    const loaded = (await sets.findById(set.id.toString(), "tenant-a"))!;
    loaded.removeTranslation("back", nextId(), T0);
    loaded.setTranslation("cta", "Pay", nextId(), T0);
    await saveSet(loaded, "tenant-a");

    const reloaded = (await sets.findById(set.id.toString(), "tenant-a"))!;
    expect(reloaded.version).toBe(2);
    expect(reloaded.translations.map((t) => [t.key, t.value])).toEqual([["cta", "Pay"]]);
  });

  it("rejects a save from a stale copy with ConcurrencyError", async () => {
    const { sets, saveSet, nextId } = wire();
    const set = TranslationSet.create(UniqueEntityId.from(nextId()), "en", "checkout");
    await saveSet(set, "tenant-a");
    const first = (await sets.findById(set.id.toString(), "tenant-a"))!;
    const second = (await sets.findById(set.id.toString(), "tenant-a"))!;

    first.setTranslation("cta", "Pay now", nextId(), T0);
    await saveSet(first, "tenant-a");
    second.setTranslation("cta", "Lost update", nextId(), T0);

    await expect(saveSet(second, "tenant-a")).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it("refuses to save outside a unit of work (ADR-0003)", async () => {
    const { sets, nextId } = wire();
    const set = TranslationSet.create(UniqueEntityId.from(nextId()), "en", "checkout");

    await expect(sets.save(set, "tenant-a")).rejects.toThrow(/transaction client/);
  });

  it("never reads another tenant's sets, and pages through its own (ADR-0014)", async () => {
    const { fake, sets, saveSet, nextId } = wire();
    for (const namespace of ["checkout", "account", "cart"]) {
      await saveSet(
        TranslationSet.create(UniqueEntityId.from(nextId()), "en", namespace),
        "tenant-a",
      );
    }

    expect(await sets.findByLocaleAndNamespace("en", "checkout", "tenant-b")).toBeNull();
    expect((await sets.list({}, "tenant-b")).items).toEqual([]);

    const first = await sets.list({ first: 2 }, "tenant-a");
    expect(first.items.map((s) => s.namespace)).toEqual(["checkout", "account"]);
    const rest = await sets.list({ after: first.pageInfo.endCursor! }, "tenant-a");
    expect(rest.items.map((s) => s.namespace)).toEqual(["cart"]);

    const tx = fake.database;
    expect(await sets.findByLocaleAndNamespace("en", "cart", "tenant-a", tx)).not.toBeNull();
    expect(await sets.findById(first.items[0]!.id.toString(), "tenant-a", tx)).not.toBeNull();
    expect((await sets.list({}, "tenant-a", tx)).items).toHaveLength(3);
  });
});

describe("LocaleMapper", () => {
  it("rejects a row whose code is not a valid locale code", () => {
    expect(() =>
      LocaleMapper.toDomain({
        id: "00000000-0000-7000-8000-000000000001",
        code: "english",
        name: "English",
        isDefault: true,
        fallbackLocaleRef: null,
        status: "active",
        version: 1,
      }),
    ).toThrow(/Corrupt locale row: invalid code/);
  });
});
