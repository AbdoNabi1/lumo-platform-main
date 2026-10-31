import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaUnitOfWork, type Database } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
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

/**
 * Runs only against a throwaway database (never a real one):
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/online-store test
 *
 * One case per table (spec 1.13): preferences, access, themes, releases and preview tokens.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("online-store Prisma repositories (integration)", () => {
  // Built in beforeAll: a skipped describe still runs its body, and the client throws without a URL.
  let prisma!: Database;
  let uow!: PrismaUnitOfWork;
  beforeAll(() => {
    prisma = createTestPrismaClient(databaseUrl);
    uow = new PrismaUnitOfWork(prisma);
  });
  const created: string[] = [];
  const tenantOf = () => {
    const tenantId = `it-${crypto.randomUUID()}`;
    created.push(tenantId);
    return tenantId;
  };
  // Teardown: remove this run's rows (every shop id is a fresh uuid), then close the client.
  afterAll(async () => {
    const where = { tenantId: { in: created } };
    await prisma.onlineStorePreferences.deleteMany({ where });
    await prisma.onlineStoreAccess.deleteMany({ where });
    await prisma.onlineStoreTheme.deleteMany({ where });
    await prisma.onlineStoreThemeRelease.deleteMany({ where });
    await prisma.onlineStorePreviewToken.deleteMany({ where });
    await prisma.$disconnect();
  });
  const now = new Date();

  it("preferences: absent is the defaults, the first save inserts, a stale save loses", async () => {
    const repo = new PrismaPreferencesRepository({ prisma });
    const tenant = tenantOf();
    expect((await repo.get(tenant)).snapshot().persisted).toBe(false);
    await uow.run(async (tx) => {
      const prefs = await repo.get(tenant, tx);
      prefs.update(
        {
          homeTitle: { ar: "متجر" },
          homeMetaDescription: { en: "A shop" },
          shareImageRef: null,
          defaultLocale: "en",
        },
        now,
      );
      await repo.save(prefs, tenant, tx);
    });
    const saved = (await repo.get(tenant)).snapshot();
    expect(saved).toMatchObject({ persisted: true, version: 1, defaultLocale: "en" });
    expect(saved.homeTitle).toEqual({ ar: "متجر" });
    expect((await repo.get(`${tenant}-other`)).snapshot().persisted).toBe(false);

    const stale = await repo.get(tenant);
    await uow.run(async (tx) => {
      const winner = await repo.get(tenant, tx);
      await repo.save(winner, tenant, tx);
    });
    await expect(uow.run((tx) => repo.save(stale, tenant, tx))).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
  });

  it("access: round-trips the lock, the hash and the access version for one shop only", async () => {
    const repo = new PrismaAccessRepository({ prisma });
    const tenant = tenantOf();
    await uow.run(async (tx) => {
      const access = await repo.get(tenant, tx);
      const applied = access.apply({
        locked: true,
        newPasswordHash: "scrypt$test",
        message: { ar: "قريبًا" },
        now,
      });
      if (!applied.ok) throw applied.error;
      await repo.save(access, tenant, tx);
    });
    const saved = (await repo.get(tenant)).snapshot();
    expect(saved).toMatchObject({
      locked: true,
      passwordHash: "scrypt$test",
      accessVersion: 2,
      version: 1,
      persisted: true,
    });
    expect((await repo.get(`${tenant}-other`)).snapshot()).toMatchObject({
      locked: false,
      persisted: false,
    });
  });

  it("themes and releases: save, publish and read a theme for one shop only", async () => {
    const themes = new PrismaThemeRepository({ prisma });
    const releases = new PrismaThemeReleaseRepository({ prisma });
    const tenant = tenantOf();
    await uow.run(async (tx) => {
      const theme = await themes.get(tenant, tx);
      theme.saveDraft({ ...DEFAULT_THEME_DOCUMENT, header: { sticky: true } }, now);
      const release = theme.publish({
        expectedDraftRevision: 1,
        by: "s",
        releaseId: crypto.randomUUID(),
        now,
      });
      if (!release.ok) throw release.error;
      await themes.save(theme, tenant, tx);
      await releases.append(release.value, tenant, tx);
    });
    expect((await themes.get(tenant)).snapshot().published?.header.sticky).toBe(true);
    expect((await themes.get(`${tenant}-other`)).snapshot().persisted).toBe(false);
    expect(await releases.list(tenant, 20)).toHaveLength(1);
    expect(await releases.list(`${tenant}-other`, 20)).toHaveLength(0);
    expect((await releases.get(1, tenant))?.releaseNumber).toBe(1);

    const again = StorefrontTheme.initial();
    await expect(uow.run((tx) => themes.save(again, tenant, tx))).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
  });

  it("releases: prunes beyond the newest N", async () => {
    const releases = new PrismaThemeReleaseRepository({ prisma });
    const tenant = tenantOf();
    await uow.run(async (tx) => {
      for (let n = 1; n <= 3; n += 1) {
        await releases.append(
          {
            id: crypto.randomUUID(),
            releaseNumber: n,
            document: DEFAULT_THEME_DOCUMENT,
            publishedAt: now,
            publishedBy: "s",
          },
          tenant,
          tx,
        );
      }
    });
    expect(await uow.run((tx) => releases.pruneBeyond(2, tenant, tx))).toBe(1);
    expect((await releases.list(tenant, 20)).map((r) => r.releaseNumber)).toEqual([3, 2]);
  });

  it("preview tokens: found by hash in their own shop only, gone once expired", async () => {
    const repo = new PrismaPreviewTokenRepository({ prisma });
    const tenant = tenantOf();
    const tokenHash = `h-${crypto.randomUUID()}`;
    const record = {
      id: crypto.randomUUID(),
      tokenHash,
      expiresAt: new Date(now.getTime() + 60_000),
      createdBy: "s",
      createdAt: now,
    };
    await uow.run((tx) => repo.insert(record, tenant, tx));
    expect(await repo.findActive(tokenHash, tenant, now)).toMatchObject({ id: record.id });
    expect(await repo.findActive(tokenHash, `${tenant}-other`, now)).toBeNull();
    const after = new Date(now.getTime() + 120_000);
    expect(await repo.findActive(tokenHash, tenant, after)).toBeNull();
    expect(await uow.run((tx) => repo.deleteExpired(tenant, after, tx))).toBe(1);
  });
});
