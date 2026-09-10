import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { Theme } from "../domain/theme";
import { ThemeVariables } from "../domain/value-objects/theme-variables";
import { ThemeEventTranslator } from "./theme-event-translator";
import { PrismaThemeRepository } from "./prisma-repositories";

/**
 * Phase 4 T4.8 — real PostgreSQL coverage for the new `list` read, following the same reference
 * pattern as `services/reviews/src/infrastructure/prisma-review-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/theme test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("PrismaThemeRepository (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new ThemeEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "theme",
    });
    const context = rootEventContext(ids, tenantId);
    const repository = new PrismaThemeRepository({ prisma, tenantId, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(prisma);
    return {
      prisma,
      repository,
      save: (theme: Theme) => unitOfWork.run((tx) => repository.save(theme, tx)),
    };
  }

  function newTheme(name: string): Theme {
    return Theme.create(
      UniqueEntityId.from(ids.generate()),
      name,
      ThemeVariables.create({}, {}, {}),
    );
  }

  it("list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-theme-${crypto.randomUUID()}`;
    const other = `tenant-itest-theme-other-${crypto.randomUUID()}`;
    const { prisma, repository, save } = wire(tenantId);
    const { repository: otherRepository, save: saveOther } = wire(other);

    for (let i = 0; i < 3; i += 1) {
      await save(newTheme(`theme-${i}`));
    }
    await saveOther(newTheme("theme-x"));

    const page = await repository.list({ first: 2 }, tenantId);
    expect(page.items).toHaveLength(2);
    expect(page.pageInfo.hasNextPage).toBe(true);

    const rest = await repository.list(
      { first: 10, after: page.pageInfo.endCursor ?? undefined },
      tenantId,
    );
    expect(rest.items).toHaveLength(1);
    expect(rest.pageInfo.hasNextPage).toBe(false);

    const otherPage = await otherRepository.list({ first: 10 }, other);
    expect(otherPage.items).toHaveLength(1);
    await prisma.$disconnect();
  });
});
