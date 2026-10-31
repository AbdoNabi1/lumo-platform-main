import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import { ConcurrencyError } from "@platform/utils";
import {
  InMemoryAccessRepository,
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
});
