import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireLocalization } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire() {
  return wireLocalization({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

describe("localization (end to end)", () => {
  it("runs the full lifecycle: create locale -> create set -> set/publish translation", async () => {
    const app = wire();
    const locale = await app.localization.createLocale({
      code: "en-US",
      name: "English (US)",
      isDefault: true,
      tenantId: "tenant-local",
    });
    expect(locale.status).toBe(201);
    const localeId = (locale.body as { localeId: string }).localeId;

    const set = await app.localization.createTranslationSet({
      localeRef: localeId,
      namespace: "storefront",
      tenantId: "tenant-local",
    });
    expect(set.status).toBe(201);
    const translationSetId = (set.body as { translationSetId: string }).translationSetId;

    await app.localization.setTranslation({
      translationSetId,
      key: "welcome",
      value: "Welcome!",
      tenantId: "tenant-local",
    });
    const published = await app.localization.publishTranslation({
      translationSetId,
      key: "welcome",
      tenantId: "tenant-local",
    });
    expect(published.status).toBe(200);

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("localization.translation.published");
  });

  it("rejects creating a duplicate locale code (409)", async () => {
    const app = wire();
    await app.localization.createLocale({
      code: "en-US",
      name: "English (US)",
      isDefault: true,
      tenantId: "tenant-local",
    });
    const response = await app.localization.createLocale({
      code: "en-US",
      name: "English",
      isDefault: false,
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(409);
  });
});
