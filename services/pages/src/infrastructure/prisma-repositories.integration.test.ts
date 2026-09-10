import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { Page } from "../domain/page";
import { Template } from "../domain/template";
import { RoutePath } from "../domain/value-objects/route-path";
import { PagesEventTranslator } from "./pages-event-translator";
import { PrismaPageRepository, PrismaTemplateRepository } from "./prisma-repositories";

/**
 * Phase 4 T4.6 — real PostgreSQL coverage for the new `list` reads (both Page and Template),
 * following the same reference pattern as
 * `services/reviews/src/infrastructure/prisma-review-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/pages test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("Prisma Pages repositories (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new PagesEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "pages",
    });
    const context = rootEventContext(ids, tenantId);
    const pages = new PrismaPageRepository({ prisma, tenantId, outbox, context });
    const templates = new PrismaTemplateRepository({ prisma, tenantId, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(prisma);
    return {
      prisma,
      pages,
      templates,
      savePage: (page: Page) => unitOfWork.run((tx) => pages.save(page, tx)),
      saveTemplate: (template: Template) => unitOfWork.run((tx) => templates.save(template, tx)),
    };
  }

  function newPage(routePath: string): Page {
    const route = RoutePath.create(routePath);
    if (!route.ok) throw new Error("test setup: invalid route path");
    return Page.create(UniqueEntityId.from(ids.generate()), "A page", route.value);
  }

  it("PrismaPageRepository.list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-pages-${crypto.randomUUID()}`;
    const other = `tenant-itest-pages-other-${crypto.randomUUID()}`;
    const { prisma, pages, savePage } = wire(tenantId);
    const { pages: otherPages, savePage: saveOtherPage } = wire(other);

    for (let i = 0; i < 3; i += 1) {
      await savePage(newPage(`/page-${i}`));
    }
    await saveOtherPage(newPage("/page-x"));

    const page = await pages.list({ first: 2 }, tenantId);
    expect(page.items).toHaveLength(2);
    expect(page.pageInfo.hasNextPage).toBe(true);

    const rest = await pages.list(
      { first: 10, after: page.pageInfo.endCursor ?? undefined },
      tenantId,
    );
    expect(rest.items).toHaveLength(1);
    expect(rest.pageInfo.hasNextPage).toBe(false);

    const otherPage = await otherPages.list({ first: 10 }, other);
    expect(otherPage.items).toHaveLength(1);
    await prisma.$disconnect();
  });

  it("PrismaTemplateRepository.list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-templates-${crypto.randomUUID()}`;
    const other = `tenant-itest-templates-other-${crypto.randomUUID()}`;
    const { prisma, templates, saveTemplate } = wire(tenantId);
    const { templates: otherTemplates, saveTemplate: saveOtherTemplate } = wire(other);

    for (let i = 0; i < 3; i += 1) {
      await saveTemplate(
        Template.create(UniqueEntityId.from(ids.generate()), `template-${i}`, "experience-1"),
      );
    }
    await saveOtherTemplate(
      Template.create(UniqueEntityId.from(ids.generate()), "template-x", "experience-1"),
    );

    const page = await templates.list({ first: 2 }, tenantId);
    expect(page.items).toHaveLength(2);
    expect(page.pageInfo.hasNextPage).toBe(true);

    const otherPage = await otherTemplates.list({ first: 10 }, other);
    expect(otherPage.items).toHaveLength(1);
    await prisma.$disconnect();
  });
});
