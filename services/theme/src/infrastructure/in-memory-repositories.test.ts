import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Theme } from "../domain/theme";
import { ThemeVariables } from "../domain/value-objects/theme-variables";
import { ThemeEventTranslator } from "./theme-event-translator";
import { InMemoryThemeRepository } from "./in-memory-repositories";

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new ThemeEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-07-05T00:00:00.000Z") },
    producer: "theme",
  });
  const context = rootEventContext({ generate: nextId });
  const repository = new InMemoryThemeRepository({ outbox, context });
  return { repository, nextId };
}

describe("InMemoryThemeRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's theme by id, name, or list, through a single repository instance", async () => {
    const { repository, nextId } = wire();
    const theme = Theme.create(
      UniqueEntityId.from(nextId()),
      "default",
      ThemeVariables.create({}, {}, {}),
    );
    await repository.save(theme, "tenant-a");

    expect(await repository.findById(theme.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repository.findById(theme.id.toString(), "tenant-b")).toBeNull();

    expect(await repository.findByName("default", "tenant-a")).not.toBeNull();
    expect(await repository.findByName("default", "tenant-b")).toBeNull();

    const pageA = await repository.list({}, "tenant-a");
    const pageB = await repository.list({}, "tenant-b");
    expect(pageA.items.map((t) => t.id.toString())).toContain(theme.id.toString());
    expect(pageB.items.map((t) => t.id.toString())).not.toContain(theme.id.toString());
  });
});
