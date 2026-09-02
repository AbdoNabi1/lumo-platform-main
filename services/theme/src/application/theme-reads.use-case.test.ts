import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { GetTheme } from "./get-theme.use-case";
import { ListThemes } from "./list-themes.use-case";
import { CreateTheme } from "./theme.use-cases";
import { InMemoryDesignPresetProvider } from "../infrastructure/design-preset-provider";
import { InMemoryThemeRepository } from "../infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { ThemeEventTranslator } from "../infrastructure/theme-event-translator";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };

function harness() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new ThemeEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "theme",
  });
  const context = rootEventContext(sequentialIds());
  const themes = new InMemoryThemeRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  const presets = new InMemoryDesignPresetProvider();
  return { themes, unitOfWork, idGenerator, clock, presets };
}

describe("Theme read use-cases (Phase 4 T4.8)", () => {
  it("ListThemes paginates", async () => {
    const h = harness();
    const create = new CreateTheme(h);
    for (let i = 0; i < 3; i += 1) {
      await create.execute({ name: `Theme ${i}`, presetKey: "default" });
    }

    const page = await new ListThemes(h).execute({ first: 2 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(2);
    expect(page.value.pageInfo.hasNextPage).toBe(true);

    const rest = await new ListThemes(h).execute({
      first: 10,
      after: page.value.pageInfo.endCursor ?? undefined,
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.value.items).toHaveLength(1);
    expect(rest.value.pageInfo.hasNextPage).toBe(false);
  });

  it("GetTheme returns the theme, or NotFoundError when absent", async () => {
    const h = harness();
    const created = await new CreateTheme(h).execute({ name: "Default", presetKey: "default" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await new GetTheme(h).execute({ themeId: created.value.themeId });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.id.toString()).toBe(created.value.themeId);

    const missing = await new GetTheme(h).execute({ themeId: "nope" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});
