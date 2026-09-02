import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { GetPage } from "./get-page.use-case";
import { GetTemplate } from "./get-template.use-case";
import { ListPages } from "./list-pages.use-case";
import { ListTemplates } from "./list-templates.use-case";
import { CreatePage, CreateTemplate } from "./pages.use-cases";
import {
  InMemoryPageRepository,
  InMemoryTemplateRepository,
} from "../infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { PagesEventTranslator } from "../infrastructure/pages-event-translator";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };

function harness() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new PagesEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "pages",
  });
  const context = rootEventContext(sequentialIds());
  const pages = new InMemoryPageRepository({ outbox, context });
  const templates = new InMemoryTemplateRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  return { pages, templates, unitOfWork, idGenerator, clock };
}

describe("Pages read use-cases (Phase 4 T4.6)", () => {
  it("ListPages paginates", async () => {
    const h = harness();
    const create = new CreatePage(h);
    for (let i = 0; i < 3; i += 1) {
      await create.execute({ name: `Page ${i}`, routePath: `/page-${i}` });
    }

    const page = await new ListPages(h).execute({ first: 2 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(2);
    expect(page.value.pageInfo.hasNextPage).toBe(true);

    const rest = await new ListPages(h).execute({
      first: 10,
      after: page.value.pageInfo.endCursor ?? undefined,
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.value.items).toHaveLength(1);
    expect(rest.value.pageInfo.hasNextPage).toBe(false);
  });

  it("GetPage returns the page, or NotFoundError when absent", async () => {
    const h = harness();
    const created = await new CreatePage(h).execute({ name: "Home", routePath: "/" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await new GetPage(h).execute({ pageId: created.value.pageId });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.id.toString()).toBe(created.value.pageId);

    const missing = await new GetPage(h).execute({ pageId: "nope" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });

  it("ListTemplates paginates and GetTemplate returns the template, or NotFoundError when absent", async () => {
    const h = harness();
    const create = new CreateTemplate(h);
    for (let i = 0; i < 2; i += 1) {
      await create.execute({ name: `Template ${i}`, experienceRef: `experience-${i}` });
    }

    const page = await new ListTemplates(h).execute({ first: 10 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(2);

    const created = await new CreateTemplate(h).execute({
      name: "Product page",
      experienceRef: "experience-product",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await new GetTemplate(h).execute({ templateId: created.value.templateId });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.name).toBe("Product page");

    const missing = await new GetTemplate(h).execute({ templateId: "nope" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});
