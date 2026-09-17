import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Page } from "../domain/page";
import { Template } from "../domain/template";
import { RoutePath } from "../domain/value-objects/route-path";
import { InMemoryPageRepository, InMemoryTemplateRepository } from "./in-memory-repositories";
import { PagesEventTranslator } from "./pages-event-translator";

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new PagesEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-08-30T00:00:00.000Z") },
    producer: "pages",
  });
  const context = rootEventContext({ generate: nextId });
  return {
    pages: new InMemoryPageRepository({ outbox, context }),
    templates: new InMemoryTemplateRepository({ outbox, context }),
    nextId,
  };
}

describe("InMemoryPageRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's page by id, route path, or list, through a single repository instance", async () => {
    const { pages, nextId } = wire();
    const route = RoutePath.create("/homepage");
    if (!route.ok) throw new Error("test setup: invalid route path");
    const page = Page.create(UniqueEntityId.from(nextId()), "Homepage", route.value);
    await pages.save(page, "tenant-a");

    expect(await pages.findById(page.id.toString(), "tenant-a")).not.toBeNull();
    expect(await pages.findById(page.id.toString(), "tenant-b")).toBeNull();

    expect(await pages.findByRoutePath("/homepage", "tenant-a")).not.toBeNull();
    expect(await pages.findByRoutePath("/homepage", "tenant-b")).toBeNull();

    const pageA = await pages.list({}, "tenant-a");
    const pageB = await pages.list({}, "tenant-b");
    expect(pageA.items.map((p) => p.id.toString())).toContain(page.id.toString());
    expect(pageB.items.map((p) => p.id.toString())).not.toContain(page.id.toString());
  });
});

describe("InMemoryTemplateRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's template by id, name, or list, through a single repository instance", async () => {
    const { templates, nextId } = wire();
    const template = Template.create(UniqueEntityId.from(nextId()), "landing", "experience-1");
    await templates.save(template, "tenant-a");

    expect(await templates.findById(template.id.toString(), "tenant-a")).not.toBeNull();
    expect(await templates.findById(template.id.toString(), "tenant-b")).toBeNull();

    expect(await templates.findByName("landing", "tenant-a")).not.toBeNull();
    expect(await templates.findByName("landing", "tenant-b")).toBeNull();

    const pageA = await templates.list({}, "tenant-a");
    const pageB = await templates.list({}, "tenant-b");
    expect(pageA.items.map((t) => t.id.toString())).toContain(template.id.toString());
    expect(pageB.items.map((t) => t.id.toString())).not.toContain(template.id.toString());
  });
});
