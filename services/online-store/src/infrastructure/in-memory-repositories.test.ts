import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import { ConcurrencyError } from "@platform/utils";
import { Menu } from "../domain/menu";
import {
  InMemoryAccessRepository,
  InMemoryMenuRepository,
  InMemoryPolicyRepository,
  InMemoryPreferencesRepository,
  InMemoryThemeReleaseRepository,
  InMemoryThemeRepository,
} from "./in-memory-repositories";

const now = new Date("2026-10-27T10:00:00.000Z");

describe("in-memory online-store repositories keep the Prisma contract", () => {
  it("a second first-save for the same shop is a ConcurrencyError (the P2002 equivalent)", async () => {
    const repo = new InMemoryPreferencesRepository();
    const a = await repo.get("t-1");
    const b = await repo.get("t-1");
    await repo.save(a, "t-1");
    await expect(repo.save(b, "t-1")).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it("the first save stores version 1 and a stale save afterwards loses", async () => {
    const repo = new InMemoryAccessRepository();
    await repo.save(await repo.get("t-1"), "t-1");
    const a = await repo.get("t-1");
    const b = await repo.get("t-1");
    expect(a.snapshot()).toMatchObject({ version: 1, persisted: true });
    await repo.save(a, "t-1");
    await expect(repo.save(b, "t-1")).rejects.toBeInstanceOf(ConcurrencyError);
    expect((await repo.get("t-1")).snapshot().version).toBe(2);
  });

  it("a persisted aggregate saved under a shop with no row loses", async () => {
    const repo = new InMemoryThemeRepository();
    await repo.save(await repo.get("t-1"), "t-1");
    const persisted = await repo.get("t-1");
    await expect(repo.save(persisted, "t-2")).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it("the same release number twice in a shop is a ConcurrencyError; another shop is fine", async () => {
    const repo = new InMemoryThemeReleaseRepository();
    const release = {
      id: "r-1",
      releaseNumber: 1,
      document: DEFAULT_THEME_DOCUMENT,
      publishedAt: now,
      publishedBy: "s",
    };
    await repo.append(release, "t-1");
    await expect(repo.append({ ...release, id: "r-2" }, "t-1")).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
    await expect(repo.append({ ...release, id: "r-3" }, "t-2")).resolves.toBeUndefined();
  });

  describe("menus and policies", () => {
    const items = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        label: { en: "Home" },
        link: { type: "home" as const },
        children: [],
      },
    ];
    const fresh = (handle: string) => Menu.create({ id: "m-1", handle, title: "T", items, now });

    it("a duplicate first insert of a handle is a ConcurrencyError; another shop is fine", async () => {
      const repo = new InMemoryMenuRepository();
      await repo.save(fresh("footer"), "t-1");
      await expect(repo.save(fresh("footer"), "t-1")).rejects.toBeInstanceOf(ConcurrencyError);
      await expect(repo.save(fresh("footer"), "t-2")).resolves.toBeUndefined();
    });

    it("guards on the version, lists by handle, removes, and stores copies of the aggregate", async () => {
      const repo = new InMemoryMenuRepository();
      await repo.save(fresh("zeta"), "t-1");
      await repo.save(fresh("alpha"), "t-1");
      expect((await repo.list("t-1")).map((m) => m.snapshot().handle)).toEqual(["alpha", "zeta"]);
      const a = (await repo.get("zeta", "t-1"))!;
      const b = (await repo.get("zeta", "t-1"))!;
      a.update("changed", [], now);
      expect((await repo.get("zeta", "t-1"))!.snapshot().title).toBe("T");
      await repo.save(a, "t-1");
      b.update("lost", [], now);
      await expect(repo.save(b, "t-1")).rejects.toBeInstanceOf(ConcurrencyError);
      expect(await repo.remove("zeta", "t-1")).toBe(true);
      expect(await repo.remove("zeta", "t-1")).toBe(false);
      expect(await repo.get("zeta", "t-1")).toBeNull();
    });

    it("policies: five in order, empty when absent, a stale save loses", async () => {
      const repo = new InMemoryPolicyRepository();
      const refund = await repo.get("refund", "t-1");
      const twin = await repo.get("refund", "t-1");
      refund.update({ en: "a" }, "s-1", now);
      await repo.save(refund, "t-1");
      twin.update({ en: "b" }, "s-2", now);
      await expect(repo.save(twin, "t-1")).rejects.toBeInstanceOf(ConcurrencyError);
      const list = await repo.list("t-1");
      expect(list.map((p) => [p.snapshot().type, p.isSet])).toEqual([
        ["refund", true],
        ["shipping", false],
        ["privacy", false],
        ["terms", false],
        ["contact", false],
      ]);
      const stale = await repo.get("refund", "t-1");
      stale.update({ en: "c" }, "s-1", now);
      await repo.save(stale, "t-1");
      expect((await repo.get("refund", "t-1")).snapshot()).toMatchObject({ version: 2 });
    });
  });

  describe("menu identity", () => {
    it("a stale tab cannot overwrite a menu deleted and re-created under its handle", async () => {
      const repo = new InMemoryMenuRepository();
      const mk = (id: string, title: string) =>
        Menu.create({ id, handle: "sale", title, items: [], now });
      await repo.save(mk("00000000-0000-4000-8000-000000000001", "old"), "t-1");
      const stale = (await repo.get("sale", "t-1"))!;
      await repo.remove("sale", "t-1");
      await repo.save(mk("00000000-0000-4000-8000-000000000002", "new"), "t-1");
      stale.update("overwrite", [], now);
      await expect(repo.save(stale, "t-1")).rejects.toBeInstanceOf(ConcurrencyError);
      expect((await repo.get("sale", "t-1"))!.snapshot().title).toBe("new");
    });

    it("saving an id-less menu is a typed domain error", async () => {
      const virtual = Menu.reconstitute({
        id: null,
        handle: "footer",
        title: "F",
        items: [],
        version: 0,
        updatedAt: null,
        persisted: false,
      });
      await expect(new InMemoryMenuRepository().save(virtual, "t-1")).rejects.toMatchObject({
        name: "BusinessRuleError",
        message: expect.stringMatching(/^MENU_ID_REQUIRED:/),
      });
    });
  });
});
