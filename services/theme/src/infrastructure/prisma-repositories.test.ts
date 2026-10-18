import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { rootEventContext } from "@platform/messaging";
import {
  assertWriteTimeTenant,
  CapturingOutboxWriter,
  tenantRowIsolationCases,
  type TenantRowStore,
} from "@platform/messaging/testing";
import { ConcurrencyError } from "@platform/utils";
import { Theme } from "../domain/theme";
import { ThemeVariables } from "../domain/value-objects/theme-variables";
import { PrismaThemeRepository } from "./prisma-repositories";

/**
 * `PrismaThemeRepository` over `createFakePrisma`, which applies every `where` literally (no RLS):
 * what passes here passes because the repository scoped its own query. The real-Postgres suite
 * (`prisma-repositories.integration.test.ts`) only runs where `DATABASE_URL_TEST` is set.
 */
const context = rootEventContext({ generate: () => "evt-x" });
const at = new Date("2026-10-18T00:00:00.000Z");

function variables(primary: string): ThemeVariables {
  return ThemeVariables.create({ primary }, { body: "Inter" }, { md: "16px" });
}

function wire() {
  const fake = createFakePrisma();
  const outbox = new CapturingOutboxWriter();
  const themes = new PrismaThemeRepository({
    prisma: fake.database,
    outbox: outbox as never,
    context,
  });
  return { fake, outbox, themes, tx: fake.database as unknown };
}

describe("PrismaThemeRepository", () => {
  it("creates a draft theme as version 1 and reads its variables back by id and name", async () => {
    const { fake, themes, tx } = wire();
    await themes.save(
      Theme.create(UniqueEntityId.from("theme-1"), "Default", variables("#111")),
      "tenant-a",
      tx,
    );

    expect(fake.rowsOf("theme")).toEqual([
      {
        id: "theme-1",
        tenantId: "tenant-a",
        name: "Default",
        colors: { primary: "#111" },
        typography: { body: "Inter" },
        spacing: { md: "16px" },
        status: "draft",
        versions: [],
        version: 1,
      },
    ]);
    const byId = await themes.findById("theme-1", "tenant-a");
    expect(byId?.variables.colors).toEqual({ primary: "#111" });
    expect(byId?.variables.typography).toEqual({ body: "Inter" });
    expect(byId?.version).toBe(1);
    expect((await themes.findByName("Default", "tenant-a", tx))?.id.toString()).toBe("theme-1");
  });

  it("publishing stores a version snapshot that survives the round trip", async () => {
    const { fake, outbox, themes, tx } = wire();
    await themes.save(
      Theme.create(UniqueEntityId.from("theme-1"), "Default", variables("#111")),
      "tenant-a",
      tx,
    );

    const loaded = await themes.findById("theme-1", "tenant-a", tx);
    if (loaded === null) throw new Error("expected the theme");
    loaded.publish("evt-1", at);
    await themes.save(loaded, "tenant-a", tx);

    expect(fake.rowsOf("theme")[0]).toMatchObject({ status: "active", version: 2 });
    const reread = await themes.findById("theme-1", "tenant-a");
    expect(reread?.versions).toHaveLength(1);
    expect(reread?.versions[0]?.versionNumber).toBe(1);
    expect(reread?.versions[0]?.publishedAt.toISOString()).toBe(at.toISOString());
    expect(reread?.versions[0]?.variables.colors).toEqual({ primary: "#111" });
    const written = outbox.writes.find((w) => w.events.length > 0);
    expect(written?.context.tenantId).toBe("tenant-a");
    expect(written?.events[0]).toMatchObject({ data: { name: "Default", action: "active" } });
  });

  it("persists edited variables on update", async () => {
    const { fake, themes, tx } = wire();
    await themes.save(
      Theme.create(UniqueEntityId.from("theme-1"), "Default", variables("#111")),
      "tenant-a",
      tx,
    );
    const loaded = await themes.findById("theme-1", "tenant-a", tx);
    if (loaded === null) throw new Error("expected the theme");

    loaded.updateVariables(variables("#222"));
    await themes.save(loaded, "tenant-a", tx);

    expect(fake.rowsOf("theme")[0]).toMatchObject({ colors: { primary: "#222" }, version: 2 });
  });

  it("rejects a stale version with a ConcurrencyError and keeps the stored row", async () => {
    const { fake, themes, tx } = wire();
    await themes.save(
      Theme.create(UniqueEntityId.from("theme-1"), "Default", variables("#111")),
      "tenant-a",
      tx,
    );
    const first = await themes.findById("theme-1", "tenant-a", tx);
    const second = await themes.findById("theme-1", "tenant-a", tx);
    if (first === null || second === null) throw new Error("expected the theme");

    first.updateVariables(variables("#222"));
    await themes.save(first, "tenant-a", tx);
    second.updateVariables(variables("#333"));

    await expect(themes.save(second, "tenant-a", tx)).rejects.toBeInstanceOf(ConcurrencyError);
    expect(fake.rowsOf("theme")[0]).toMatchObject({ colors: { primary: "#222" }, version: 2 });
  });

  it("refuses to save outside a unit-of-work transaction", async () => {
    const { themes } = wire();
    const theme = Theme.create(UniqueEntityId.from("theme-1"), "Default", variables("#111"));
    await expect(themes.save(theme, "tenant-a")).rejects.toThrow(/transaction client/);
  });

  it("lists a tenant's themes a page at a time", async () => {
    const { themes, tx } = wire();
    for (const n of [1, 2, 3]) {
      await themes.save(
        Theme.create(UniqueEntityId.from(`theme-${n}`), `T${n}`, variables("#111")),
        "tenant-a",
        tx,
      );
    }
    await themes.save(
      Theme.create(UniqueEntityId.from("theme-9"), "Theirs", variables("#999")),
      "tenant-b",
      tx,
    );

    const first = await themes.list({ first: 2 }, "tenant-a");
    expect(first.items.map((t) => t.name)).toEqual(["T1", "T2"]);
    expect(first.pageInfo.hasNextPage).toBe(true);
    const rest = await themes.list(
      { first: 2, after: first.pageInfo.endCursor ?? undefined },
      "tenant-a",
      tx,
    );
    expect(rest.items.map((t) => t.name)).toEqual(["T3"]);
    expect(rest.pageInfo.hasNextPage).toBe(false);
  });

  it("merges the per-call tenantId into the outbox event context at write time", async () => {
    await assertWriteTimeTenant("theme (prisma)", async (outbox, tenantId) => {
      const fake = createFakePrisma();
      const repo = new PrismaThemeRepository({
        prisma: fake.database,
        outbox: outbox as never,
        context,
      });
      const theme = Theme.create(UniqueEntityId.from("theme-1"), "Default", variables("#111"));
      theme.publish("evt-1", at);
      await repo.save(theme, tenantId, fake.database);
    });
  });
});

// ── T10.5 row isolation (shared harness) ─────────────────────────────────────────────────────────
// The marker rides in `colors.primary`, which an update rewrites, so a forged write is observable.
function themeStore(): TenantRowStore {
  const { themes, tx } = wire();
  return {
    insert: (tenantId, key, marker) =>
      themes.save(Theme.create(UniqueEntityId.from(key), key, variables(marker)), tenantId, tx),
    find: async (tenantId, key) =>
      (await themes.findByName(key, tenantId))?.variables.colors["primary"] ?? null,
    list: async (tenantId) =>
      (await themes.list({ first: 50 }, tenantId)).items.map(
        (t) => t.variables.colors["primary"] ?? "",
      ),
    update: (tenantId, key, marker) =>
      themes.save(
        Theme.reconstitute(UniqueEntityId.from(key), key, variables(marker), "draft", 1),
        tenantId,
        tx,
      ),
  };
}

describe("theme tenant isolation over fake-prisma (T10.5)", () => {
  const fixture = {
    context: "theme/theme",
    layer: "prisma repository over fake-prisma (app-layer where, no RLS)",
    make: themeStore,
  };
  for (const c of tenantRowIsolationCases(fixture)) it(c.name, c.run);
});
