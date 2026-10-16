import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { Locale } from "../domain/locale";
import { TranslationSet } from "../domain/translation-set";
import { LocaleCode } from "../domain/value-objects/locale-code";
import { LocalizationEventTranslator } from "./localization-event-translator";
import { PrismaLocaleRepository, PrismaTranslationSetRepository } from "./prisma-repositories";

/**
 * Phase 4 T4.11 — real PostgreSQL coverage for the new `list` reads (both Locale and
 * TranslationSet), following the same reference pattern as
 * `services/reviews/src/infrastructure/prisma-review-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/localization test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("Prisma Localization repositories (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new LocalizationEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "localization",
    });
    const context = rootEventContext(ids, tenantId);
    const locales = new PrismaLocaleRepository({ prisma, outbox, context });
    const translationSets = new PrismaTranslationSetRepository({
      prisma,
      outbox,
      context,
    });
    const unitOfWork = new PrismaUnitOfWork(prisma);
    return {
      prisma,
      locales,
      translationSets,
      saveLocale: (l: Locale) => unitOfWork.run((tx) => locales.save(l, tenantId, tx)),
      saveSet: (s: TranslationSet) => unitOfWork.run((tx) => translationSets.save(s, tenantId, tx)),
    };
  }

  function newLocale(code: string): Locale {
    const localeCode = LocaleCode.create(code);
    if (!localeCode.ok) throw new Error("test setup: invalid locale code");
    return Locale.create(UniqueEntityId.from(ids.generate()), localeCode.value, code, false);
  }

  it("PrismaLocaleRepository.list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-locales-${crypto.randomUUID()}`;
    const { prisma, locales, saveLocale } = wire(tenantId);
    for (const code of ["en", "fr", "de"]) {
      await saveLocale(newLocale(code));
    }
    const page = await locales.list({ first: 2 }, tenantId);
    expect(page.items).toHaveLength(2);
    expect(page.pageInfo.hasNextPage).toBe(true);
    await prisma.$disconnect();
  });

  it("PrismaTranslationSetRepository.list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-translation-sets-${crypto.randomUUID()}`;
    const { prisma, translationSets, saveSet } = wire(tenantId);
    await saveSet(TranslationSet.create(UniqueEntityId.from(ids.generate()), "en", "common"));
    const page = await translationSets.list({ first: 10 }, tenantId);
    expect(page.items).toHaveLength(1);
    await prisma.$disconnect();
  });
});
