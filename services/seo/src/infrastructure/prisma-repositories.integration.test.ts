import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { Redirect } from "../domain/redirect";
import { RobotsPolicy } from "../domain/robots-policy";
import { SeoProfile } from "../domain/seo-profile";
import { Sitemap } from "../domain/sitemap";
import { SeoMetadata } from "../domain/value-objects/seo";
import { SeoEventTranslator } from "./seo-event-translator";
import {
  PrismaRedirectRepository,
  PrismaRobotsPolicyRepository,
  PrismaSeoProfileRepository,
  PrismaSitemapRepository,
} from "./prisma-repositories";

/**
 * Phase 4 T4.7 — real PostgreSQL coverage for the new `list` reads (all 4 SEO aggregates),
 * following the same reference pattern as
 * `services/reviews/src/infrastructure/prisma-review-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/seo test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("Prisma SEO repositories (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new SeoEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "seo",
    });
    const context = rootEventContext(ids, tenantId);
    const seoDeps = { prisma, outbox, context };
    const profiles = new PrismaSeoProfileRepository(seoDeps);
    const redirects = new PrismaRedirectRepository(seoDeps);
    const sitemaps = new PrismaSitemapRepository(seoDeps);
    const robotsPolicies = new PrismaRobotsPolicyRepository(seoDeps);
    const unitOfWork = new PrismaUnitOfWork(prisma);
    return {
      prisma,
      profiles,
      redirects,
      sitemaps,
      robotsPolicies,
      saveProfile: (p: SeoProfile) => unitOfWork.run((tx) => profiles.save(p, tenantId, tx)),
      saveRedirect: (r: Redirect) => unitOfWork.run((tx) => redirects.save(r, tenantId, tx)),
      saveSitemap: (s: Sitemap) => unitOfWork.run((tx) => sitemaps.save(s, tenantId, tx)),
      savePolicy: (p: RobotsPolicy) => unitOfWork.run((tx) => robotsPolicies.save(p, tenantId, tx)),
    };
  }

  it("PrismaSeoProfileRepository.list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-seo-profiles-${crypto.randomUUID()}`;
    const { prisma, profiles, saveProfile } = wire(tenantId);
    for (let i = 0; i < 2; i += 1) {
      await saveProfile(
        SeoProfile.create(
          UniqueEntityId.from(ids.generate()),
          `page-${i}`,
          SeoMetadata.create({}),
          ids.generate(),
          clock.now(),
        ),
      );
    }
    const page = await profiles.list({ first: 10 }, tenantId);
    expect(page.items).toHaveLength(2);
    await prisma.$disconnect();
  });

  it("PrismaRedirectRepository.list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-seo-redirects-${crypto.randomUUID()}`;
    const { prisma, redirects, saveRedirect } = wire(tenantId);
    await saveRedirect(
      Redirect.create(
        UniqueEntityId.from(ids.generate()),
        "/old",
        "/new",
        301,
        ids.generate(),
        clock.now(),
      ),
    );
    const page = await redirects.list({ first: 10 }, tenantId);
    expect(page.items).toHaveLength(1);
    await prisma.$disconnect();
  });

  it("PrismaSitemapRepository.list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-seo-sitemaps-${crypto.randomUUID()}`;
    const { prisma, sitemaps, saveSitemap } = wire(tenantId);
    await saveSitemap(
      Sitemap.create(UniqueEntityId.from(ids.generate()), "main", ids.generate(), clock.now()),
    );
    const page = await sitemaps.list({ first: 10 }, tenantId);
    expect(page.items).toHaveLength(1);
    await prisma.$disconnect();
  });

  it("PrismaRobotsPolicyRepository.list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-seo-robots-${crypto.randomUUID()}`;
    const { prisma, robotsPolicies, savePolicy } = wire(tenantId);
    await savePolicy(
      RobotsPolicy.create(UniqueEntityId.from(ids.generate()), "*", ids.generate(), clock.now()),
    );
    const page = await robotsPolicies.list({ first: 10 }, tenantId);
    expect(page.items).toHaveLength(1);
    await prisma.$disconnect();
  });

  it("does not let tenant A read tenant B's SEO profile through a SINGLE shared repository instance (ADR-0014, WP-10 T10.5)", async () => {
    const tenantA = `tenant-itest-seo-a-${crypto.randomUUID()}`;
    const tenantB = `tenant-itest-seo-b-${crypto.randomUUID()}`;
    const { prisma, profiles, saveProfile } = wire(tenantA);

    const profile = SeoProfile.create(
      UniqueEntityId.from(ids.generate()),
      "tenant-a-page",
      SeoMetadata.create({}),
      ids.generate(),
      clock.now(),
    );
    await saveProfile(profile);

    expect(await profiles.findById(profile.id.toString(), tenantA)).not.toBeNull();
    expect(await profiles.findById(profile.id.toString(), tenantB)).toBeNull();

    await prisma.$disconnect();
  });
});
