import { describe, expect, it } from "vitest";
import type { TransactionClient } from "@platform/db";
import { createFakePrisma } from "@platform/db/testing";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import { ConcurrencyError } from "@platform/utils";
import { StorefrontTheme } from "../domain/storefront-theme";
import {
  PrismaAccessRepository,
  PrismaPreferencesRepository,
  PrismaPreviewTokenRepository,
  PrismaThemeReleaseRepository,
  PrismaThemeRepository,
} from "./prisma-repositories";

const now = new Date("2026-10-27T10:00:00.000Z");

function setup() {
  const fake = createFakePrisma();
  const tx = fake.database as unknown as TransactionClient;
  const deps = { prisma: fake.database };
  return {
    fake,
    tx,
    preferences: new PrismaPreferencesRepository(deps),
    access: new PrismaAccessRepository(deps),
    themes: new PrismaThemeRepository(deps),
    releases: new PrismaThemeReleaseRepository(deps),
    tokens: new PrismaPreviewTokenRepository(deps),
  };
}

/** A transaction client whose `create` rejects, to drive the unique-violation branch without a DB. */
function failingCreate(error: unknown): TransactionClient {
  const model = { create: () => Promise.reject(error) };
  return {
    onlineStorePreferences: model,
    onlineStoreAccess: model,
    onlineStoreTheme: model,
    onlineStoreThemeRelease: model,
  } as unknown as TransactionClient;
}
const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

describe("Prisma online-store repositories (fake client)", () => {
  it("an absent row reads as the defaults; the first save inserts version 1", async () => {
    const { preferences, tx, fake } = setup();
    const prefs = await preferences.get("t-1");
    expect(prefs.snapshot()).toMatchObject({ defaultLocale: "ar", version: 0, persisted: false });
    prefs.update(
      {
        homeTitle: { ar: "متجر" },
        homeMetaDescription: {},
        shareImageRef: null,
        defaultLocale: "en",
      },
      now,
    );
    await preferences.save(prefs, "t-1", tx);
    expect(fake.rowsOf("onlineStorePreferences")).toEqual([
      expect.objectContaining({ tenantId: "t-1", defaultLocale: "en", version: 1 }),
    ]);
    expect((await preferences.get("t-1")).snapshot()).toMatchObject({
      version: 1,
      persisted: true,
    });
  });

  it("a save from a stale version throws ConcurrencyError and writes nothing", async () => {
    const { access, tx, fake } = setup();
    const first = await access.get("t-1");
    first.apply({ locked: false, newPasswordHash: "h", message: {}, now });
    await access.save(first, "t-1", tx);
    const a = await access.get("t-1");
    const b = await access.get("t-1");
    a.apply({ locked: true, newPasswordHash: null, message: {}, now });
    await access.save(a, "t-1", tx);
    b.apply({ locked: false, newPasswordHash: "other", message: {}, now });
    await expect(access.save(b, "t-1", tx)).rejects.toBeInstanceOf(ConcurrencyError);
    expect(fake.rowsOf("onlineStoreAccess")[0]).toMatchObject({
      locked: true,
      passwordHash: "h",
      version: 2,
    });
  });

  it("round-trips the theme documents through JSON and the tolerant reader", async () => {
    const { themes, tx } = setup();
    const theme = StorefrontTheme.initial();
    theme.saveDraft(
      { ...DEFAULT_THEME_DOCUMENT, header: { ...DEFAULT_THEME_DOCUMENT.header, sticky: true } },
      now,
    );
    theme.publish({ expectedDraftRevision: 1, by: "s-1", releaseId: "r", now });
    await themes.save(theme, "t-1", tx);
    const read = (await themes.get("t-1")).snapshot();
    expect(read.draft.header.sticky).toBe(true);
    expect(read.published?.header.sticky).toBe(true);
    expect(read).toMatchObject({
      draftRevision: 1,
      publishedDraftRevision: 1,
      releaseNumber: 1,
      version: 1,
    });
  });

  it("lists releases newest first and prunes beyond the newest N", async () => {
    const { releases, tx } = setup();
    for (let n = 1; n <= 21; n += 1) {
      await releases.append(
        {
          id: `r-${n}`,
          releaseNumber: n,
          document: DEFAULT_THEME_DOCUMENT,
          publishedAt: now,
          publishedBy: "s",
        },
        "t-1",
        tx,
      );
    }
    expect(await releases.pruneBeyond(20, "t-1", tx)).toBe(1);
    const listed = await releases.list("t-1", 20);
    expect(listed.map((r) => r.releaseNumber)).toEqual(
      Array.from({ length: 20 }, (_, i) => 21 - i),
    );
    expect(await releases.get(1, "t-1")).toBeNull();
    expect((await releases.get(2, "t-1"))?.id).toBe("r-2");
  });

  it("finds a token only by hash, in its own shop, before it expires; deletes expired ones", async () => {
    const { tokens, tx, fake } = setup();
    const record = {
      id: "p-1",
      tokenHash: "h1",
      expiresAt: new Date(now.getTime() + 1000),
      createdBy: "s",
      createdAt: now,
    };
    await tokens.insert(record, "t-1", tx);
    await tokens.insert({ ...record, id: "p-2", tokenHash: "old", expiresAt: now }, "t-1", tx);
    expect(await tokens.findActive("h1", "t-1", now)).toEqual(record);
    expect(await tokens.findActive("h1", "t-2", now)).toBeNull();
    expect(await tokens.findActive("old", "t-1", now)).toBeNull();
    expect(await tokens.deleteExpired("t-1", now, tx)).toBe(1);
    expect(fake.rowsOf("onlineStorePreviewToken").map((r) => r["id"])).toEqual(["p-1"]);
  });
});

describe("Prisma online-store repositories: lost insert races and other failures", () => {
  const release = {
    id: "r-1",
    releaseNumber: 1,
    document: DEFAULT_THEME_DOCUMENT,
    publishedAt: now,
    publishedBy: "s",
  };

  it("a unique violation on the first save is a ConcurrencyError (preferences, access, theme)", async () => {
    const { preferences, access, themes } = setup();
    const tx = failingCreate(p2002);
    await expect(preferences.save(await preferences.get("t-1"), "t-1", tx)).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
    await expect(access.save(await access.get("t-1"), "t-1", tx)).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
    await expect(themes.save(await themes.get("t-1"), "t-1", tx)).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
  });

  it("appending a release whose number is taken is the same ConcurrencyError as in memory", async () => {
    const { releases } = setup();
    await expect(releases.append(release, "t-1", failingCreate(p2002))).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
  });

  it("any other failure on insert is rethrown untouched", async () => {
    const { preferences, releases } = setup();
    const boom = new Error("connection reset");
    await expect(
      preferences.save(await preferences.get("t-1"), "t-1", failingCreate(boom)),
    ).rejects.toBe(boom);
    await expect(releases.append(release, "t-1", failingCreate(boom))).rejects.toBe(boom);
  });

  it("writes need the unit of work's transaction client", async () => {
    const { preferences } = setup();
    await expect(preferences.save(await preferences.get("t-1"), "t-1", undefined)).rejects.toThrow(
      /transaction client/,
    );
  });

  it("stores the injected clock's updatedAt, as the in-memory repositories do", async () => {
    const { preferences, access, tx, fake } = setup();
    const prefs = await preferences.get("t-1");
    prefs.update(
      { homeTitle: {}, homeMetaDescription: {}, shareImageRef: null, defaultLocale: "ar" },
      now,
    );
    await preferences.save(prefs, "t-1", tx);
    const lock = await access.get("t-1");
    lock.apply({ locked: false, newPasswordHash: "h", message: {}, now });
    await access.save(lock, "t-1", tx);
    expect(fake.rowsOf("onlineStorePreferences")[0]?.["updatedAt"]).toEqual(now);
    expect(fake.rowsOf("onlineStoreAccess")[0]?.["updatedAt"]).toEqual(now);

    const later = new Date(now.getTime() + 5000);
    const again = await access.get("t-1");
    again.apply({ locked: true, newPasswordHash: null, message: {}, now: later });
    await access.save(again, "t-1", tx);
    expect(fake.rowsOf("onlineStoreAccess")[0]?.["updatedAt"]).toEqual(later);
    expect((await access.get("t-1")).snapshot().updatedAt).toEqual(later);
  });
});
