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
import { Redirect } from "../domain/redirect";
import { RobotsPolicy } from "../domain/robots-policy";
import { SeoProfile } from "../domain/seo-profile";
import { Sitemap } from "../domain/sitemap";
import { SeoMetadata } from "../domain/value-objects/seo";
import {
  PrismaRedirectRepository,
  PrismaRobotsPolicyRepository,
  PrismaSeoProfileRepository,
  PrismaSitemapRepository,
} from "./prisma-repositories";

/**
 * The SEO Prisma repositories over `createFakePrisma`, which applies every `where` literally (no
 * RLS): what passes here passes because the repository scoped its own query. The real-Postgres
 * suite (`prisma-repositories.integration.test.ts`) only runs where `DATABASE_URL_TEST` is set.
 */
const context = rootEventContext({ generate: () => "evt-x" });
const at = new Date("2026-10-18T00:00:00.000Z");
const id = (value: string) => UniqueEntityId.from(value);

function wire() {
  const fake = createFakePrisma();
  const outbox = new CapturingOutboxWriter();
  const deps = { prisma: fake.database, outbox: outbox as never, context };
  return {
    fake,
    outbox,
    tx: fake.database as unknown,
    profiles: new PrismaSeoProfileRepository(deps),
    redirects: new PrismaRedirectRepository(deps),
    sitemaps: new PrismaSitemapRepository(deps),
    robots: new PrismaRobotsPolicyRepository(deps),
  };
}

describe("PrismaSeoProfileRepository", () => {
  it("round-trips metadata, mapping absent fields to null and back", async () => {
    const { fake, outbox, profiles, tx } = wire();
    const profile = SeoProfile.create(
      id("seo-1"),
      "page-1",
      SeoMetadata.create({ title: "Home", canonicalUrl: "https://shop.test/" }),
      "evt-1",
      at,
    );
    await profiles.save(profile, "tenant-a", tx);

    expect(fake.rowsOf("seoProfile")).toEqual([
      {
        id: "seo-1",
        tenantId: "tenant-a",
        pageRef: "page-1",
        title: "Home",
        description: null,
        canonicalUrl: "https://shop.test/",
        ogImageRef: null,
        version: 1,
      },
    ]);
    const read = await profiles.findByPageRef("page-1", "tenant-a");
    expect(read?.metadata.title).toBe("Home");
    expect(read?.metadata.description).toBeUndefined();
    expect((await profiles.findById("seo-1", "tenant-a", tx))?.pageRef).toBe("page-1");
    expect(outbox.writes[0]?.context.tenantId).toBe("tenant-a");
    expect(outbox.writes[0]?.events[0]).toMatchObject({
      data: { ref: "page-1", entityType: "profile", action: "created" },
    });
  });

  it("updates metadata under optimistic locking", async () => {
    const { fake, profiles, tx } = wire();
    await profiles.save(
      SeoProfile.create(id("seo-1"), "page-1", SeoMetadata.create({ title: "Old" }), "evt-1", at),
      "tenant-a",
      tx,
    );
    const first = await profiles.findById("seo-1", "tenant-a", tx);
    const second = await profiles.findById("seo-1", "tenant-a", tx);
    if (first === null || second === null) throw new Error("expected the profile");

    first.update(SeoMetadata.create({ title: "New", ogImageRef: "img-1" }), "evt-2", at);
    await profiles.save(first, "tenant-a", tx);
    expect(fake.rowsOf("seoProfile")[0]).toMatchObject({
      title: "New",
      ogImageRef: "img-1",
      version: 2,
    });

    second.update(SeoMetadata.create({ title: "Lost" }), "evt-3", at);
    await expect(profiles.save(second, "tenant-a", tx)).rejects.toBeInstanceOf(ConcurrencyError);
    expect(fake.rowsOf("seoProfile")[0]).toMatchObject({ title: "New" });
  });

  it("lists a tenant's profiles a page at a time and refuses to save outside a transaction", async () => {
    const { profiles, tx } = wire();
    for (const n of [1, 2, 3]) {
      await profiles.save(
        SeoProfile.create(id(`seo-${n}`), `page-${n}`, SeoMetadata.create({}), "evt", at),
        "tenant-a",
        tx,
      );
    }
    const first = await profiles.list({ first: 2 }, "tenant-a");
    expect(first.items.map((p) => p.pageRef)).toEqual(["page-1", "page-2"]);
    const rest = await profiles.list(
      { first: 2, after: first.pageInfo.endCursor ?? undefined },
      "tenant-a",
      tx,
    );
    expect(rest.items.map((p) => p.pageRef)).toEqual(["page-3"]);
    expect(rest.pageInfo.hasNextPage).toBe(false);

    const unsaved = SeoProfile.create(id("seo-9"), "page-9", SeoMetadata.create({}), "evt", at);
    await expect(profiles.save(unsaved, "tenant-a")).rejects.toThrow(/transaction client/);
  });
});

describe("PrismaRedirectRepository", () => {
  it("creates an active redirect, then updates and deactivates it", async () => {
    const { fake, redirects, tx } = wire();
    await redirects.save(
      Redirect.create(id("r-1"), "/old", "/new", 301, "evt-1", at),
      "tenant-a",
      tx,
    );
    expect(fake.rowsOf("redirect")[0]).toMatchObject({
      fromPath: "/old",
      toPath: "/new",
      statusCode: 301,
      active: true,
      version: 1,
    });

    const loaded = await redirects.findByFromPath("/old", "tenant-a");
    if (loaded === null) throw new Error("expected the redirect");
    loaded.update("/newer", 302, "evt-2", at);
    loaded.deactivate("evt-3", at);
    await redirects.save(loaded, "tenant-a", tx);

    const reread = await redirects.findById("r-1", "tenant-a", tx);
    expect(reread?.toPath).toBe("/newer");
    expect(reread?.statusCode).toBe(302);
    expect(reread?.active).toBe(false);
    expect(reread?.version).toBe(2);
  });

  it("rejects a stale version, lists a page at a time, and refuses to save outside a transaction", async () => {
    const { redirects, tx } = wire();
    for (const n of [1, 2]) {
      await redirects.save(
        Redirect.create(id(`r-${n}`), `/old-${n}`, "/new", 301, "evt", at),
        "tenant-a",
        tx,
      );
    }
    const stale = Redirect.reconstitute(id("r-1"), "/old-1", "/x", 301, true, 5);
    stale.update("/y", 302, "evt", at);
    await expect(redirects.save(stale, "tenant-a", tx)).rejects.toBeInstanceOf(ConcurrencyError);
    await expect(redirects.save(stale, "tenant-a")).rejects.toThrow(/transaction client/);

    const first = await redirects.list({ first: 1 }, "tenant-a", tx);
    expect(first.items.map((r) => r.fromPath)).toEqual(["/old-1"]);
    const rest = await redirects.list(
      { first: 1, after: first.pageInfo.endCursor ?? undefined },
      "tenant-a",
    );
    expect(rest.items.map((r) => r.fromPath)).toEqual(["/old-2"]);
  });
});

describe("PrismaSitemapRepository", () => {
  it("regenerates a sitemap's urls and keeps lastGeneratedAt across the round trip", async () => {
    const { fake, sitemaps, tx } = wire();
    await sitemaps.save(Sitemap.create(id("sm-1"), "main", "evt-1", at), "tenant-a", tx);
    expect(fake.rowsOf("sitemap")[0]).toMatchObject({
      urls: [],
      lastGeneratedAt: null,
      version: 1,
    });
    expect((await sitemaps.findById("sm-1", "tenant-a"))?.lastGeneratedAt).toBeUndefined();

    const loaded = await sitemaps.findByName("main", "tenant-a", tx);
    if (loaded === null) throw new Error("expected the sitemap");
    loaded.regenerate(["/", "/products"], "evt-2", at);
    await sitemaps.save(loaded, "tenant-a", tx);

    const reread = await sitemaps.findById("sm-1", "tenant-a", tx);
    expect(reread?.urls).toEqual(["/", "/products"]);
    expect(reread?.lastGeneratedAt?.toISOString()).toBe(at.toISOString());
    expect(reread?.version).toBe(2);
  });

  it("rejects a stale version, lists a page at a time, and refuses to save outside a transaction", async () => {
    const { sitemaps, tx } = wire();
    await sitemaps.save(Sitemap.create(id("sm-1"), "main", "evt", at), "tenant-a", tx);
    await sitemaps.save(Sitemap.create(id("sm-2"), "blog", "evt", at), "tenant-a", tx);
    const stale = Sitemap.reconstitute(id("sm-1"), "main", [], 9);
    stale.regenerate(["/"], "evt", at);
    await expect(sitemaps.save(stale, "tenant-a", tx)).rejects.toBeInstanceOf(ConcurrencyError);
    await expect(sitemaps.save(stale, "tenant-a")).rejects.toThrow(/transaction client/);

    const first = await sitemaps.list({ first: 1 }, "tenant-a");
    expect(first.items.map((s) => s.name)).toEqual(["main"]);
    const rest = await sitemaps.list(
      { first: 1, after: first.pageInfo.endCursor ?? undefined },
      "tenant-a",
      tx,
    );
    expect(rest.items.map((s) => s.name)).toEqual(["blog"]);
  });
});

describe("PrismaRobotsPolicyRepository", () => {
  it("stores rules and reads them back by user agent and id", async () => {
    const { fake, robots, tx } = wire();
    await robots.save(RobotsPolicy.create(id("rb-1"), "*", "evt-1", at), "tenant-a", tx);
    const loaded = await robots.findByUserAgent("*", "tenant-a");
    if (loaded === null) throw new Error("expected the policy");
    loaded.setRules([{ type: "disallow", path: "/admin" }], "evt-2", at);
    await robots.save(loaded, "tenant-a", tx);

    expect(fake.rowsOf("robotsPolicy")[0]).toMatchObject({ version: 2 });
    const reread = await robots.findById("rb-1", "tenant-a", tx);
    expect(reread?.rules).toEqual([{ type: "disallow", path: "/admin" }]);
    expect(await robots.findById("rb-1", "tenant-b")).toBeNull();
    expect(await robots.findByUserAgent("*", "tenant-b", tx)).toBeNull();
  });

  it("rejects a stale version, lists a page at a time, and refuses to save outside a transaction", async () => {
    const { robots, tx } = wire();
    await robots.save(RobotsPolicy.create(id("rb-1"), "*", "evt", at), "tenant-a", tx);
    await robots.save(RobotsPolicy.create(id("rb-2"), "Googlebot", "evt", at), "tenant-a", tx);
    const stale = RobotsPolicy.reconstitute(id("rb-1"), "*", [], 4);
    stale.setRules([{ type: "allow", path: "/" }], "evt", at);
    await expect(robots.save(stale, "tenant-a", tx)).rejects.toBeInstanceOf(ConcurrencyError);
    await expect(robots.save(stale, "tenant-a")).rejects.toThrow(/transaction client/);

    const first = await robots.list({ first: 1 }, "tenant-a", tx);
    expect(first.items.map((p) => p.userAgent)).toEqual(["*"]);
    const rest = await robots.list(
      { first: 1, after: first.pageInfo.endCursor ?? undefined },
      "tenant-a",
    );
    expect(rest.items.map((p) => p.userAgent)).toEqual(["Googlebot"]);
  });
});

it("merges the per-call tenantId into the outbox event context at write time (Prisma)", async () => {
  await assertWriteTimeTenant("seo (prisma)", async (outbox, tenantId) => {
    const fake = createFakePrisma();
    const repo = new PrismaRedirectRepository({
      prisma: fake.database,
      outbox: outbox as never,
      context,
    });
    await repo.save(
      Redirect.create(id("r-1"), "/a", "/b", 301, "evt-1", at),
      tenantId,
      fake.database,
    );
  });
});

// ── T10.5 row isolation (shared harness) ─────────────────────────────────────────────────────────
// Each store keys its rows by the lookup the context exposes, and carries the marker in a field an
// update rewrites, so a forged cross-tenant write would be observable on the victim's row.
function profileStore(): TenantRowStore {
  const { profiles, tx } = wire();
  const meta = (title: string) => SeoMetadata.create({ title });
  return {
    insert: (tenantId, key, marker) =>
      profiles.save(SeoProfile.create(id(key), key, meta(marker), "evt", at), tenantId, tx),
    find: async (tenantId, key) =>
      (await profiles.findByPageRef(key, tenantId))?.metadata.title ?? null,
    list: async (tenantId) =>
      (await profiles.list({ first: 50 }, tenantId)).items.map((p) => p.metadata.title ?? ""),
    update: (tenantId, key, marker) =>
      profiles.save(SeoProfile.reconstitute(id(key), key, meta(marker), 1), tenantId, tx),
  };
}

function redirectStore(): TenantRowStore {
  const { redirects, tx } = wire();
  return {
    insert: (tenantId, key, marker) =>
      redirects.save(
        Redirect.create(id(key), `/${key}`, `/${marker}`, 301, "evt", at),
        tenantId,
        tx,
      ),
    find: async (tenantId, key) =>
      (await redirects.findByFromPath(`/${key}`, tenantId))?.toPath.slice(1) ?? null,
    list: async (tenantId) =>
      (await redirects.list({ first: 50 }, tenantId)).items.map((r) => r.toPath.slice(1)),
    update: (tenantId, key, marker) =>
      redirects.save(
        Redirect.reconstitute(id(key), `/${key}`, `/${marker}`, 301, true, 1),
        tenantId,
        tx,
      ),
  };
}

function sitemapStore(): TenantRowStore {
  const { sitemaps, tx } = wire();
  return {
    insert: async (tenantId, key, marker) => {
      const sitemap = Sitemap.create(id(key), key, "evt", at);
      sitemap.regenerate([marker], "evt", at);
      await sitemaps.save(sitemap, tenantId, tx);
    },
    find: async (tenantId, key) => (await sitemaps.findByName(key, tenantId))?.urls[0] ?? null,
    list: async (tenantId) =>
      (await sitemaps.list({ first: 50 }, tenantId)).items.map((s) => s.urls[0] ?? ""),
    update: (tenantId, key, marker) =>
      sitemaps.save(Sitemap.reconstitute(id(key), key, [marker], 1), tenantId, tx),
  };
}

function robotsStore(): TenantRowStore {
  const { robots, tx } = wire();
  const rules = (marker: string) => [{ type: "disallow" as const, path: marker }];
  return {
    insert: async (tenantId, key, marker) => {
      const policy = RobotsPolicy.create(id(key), key, "evt", at);
      policy.setRules(rules(marker), "evt", at);
      await robots.save(policy, tenantId, tx);
    },
    find: async (tenantId, key) =>
      (await robots.findByUserAgent(key, tenantId))?.rules[0]?.path ?? null,
    list: async (tenantId) =>
      (await robots.list({ first: 50 }, tenantId)).items.map((p) => p.rules[0]?.path ?? ""),
    update: (tenantId, key, marker) =>
      robots.save(RobotsPolicy.reconstitute(id(key), key, rules(marker), 1), tenantId, tx),
  };
}

describe("seo tenant isolation over fake-prisma (T10.5)", () => {
  const layer = "prisma repository over fake-prisma (app-layer where, no RLS)";
  for (const fixture of [
    { context: "seo/profile", layer, make: profileStore },
    { context: "seo/redirect", layer, make: redirectStore },
    { context: "seo/sitemap", layer, make: sitemapStore },
    { context: "seo/robots-policy", layer, make: robotsStore },
  ])
    for (const c of tenantRowIsolationCases(fixture)) it(c.name, c.run);
});
