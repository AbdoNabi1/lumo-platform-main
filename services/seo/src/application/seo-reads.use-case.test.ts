import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { GetRedirect } from "./get-redirect.use-case";
import { GetRobotsPolicy } from "./get-robots-policy.use-case";
import { GetSeoProfile } from "./get-seo-profile.use-case";
import { GetSitemap } from "./get-sitemap.use-case";
import { ListRedirects } from "./list-redirects.use-case";
import { ListRobotsPolicies } from "./list-robots-policies.use-case";
import { ListSeoProfiles } from "./list-seo-profiles.use-case";
import { ListSitemaps } from "./list-sitemaps.use-case";
import {
  CreateRedirect,
  CreateSitemap,
  SetRobotsPolicy,
  SetSeoProfile,
} from "./seo.use-cases";
import {
  InMemoryRedirectRepository,
  InMemoryRobotsPolicyRepository,
  InMemorySeoProfileRepository,
  InMemorySitemapRepository,
} from "../infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { SeoEventTranslator } from "../infrastructure/seo-event-translator";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };

function harness() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new SeoEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "seo",
  });
  const context = rootEventContext(sequentialIds());
  const profiles = new InMemorySeoProfileRepository({ outbox, context });
  const redirects = new InMemoryRedirectRepository({ outbox, context });
  const sitemaps = new InMemorySitemapRepository({ outbox, context });
  const robotsPolicies = new InMemoryRobotsPolicyRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  return { profiles, redirects, sitemaps, robotsPolicies, unitOfWork, idGenerator, clock };
}

describe("SEO read use-cases (Phase 4 T4.7)", () => {
  it("ListSeoProfiles paginates and GetSeoProfile returns the profile, or NotFoundError", async () => {
    const h = harness();
    const set = new SetSeoProfile(h);
    for (let i = 0; i < 2; i += 1) {
      await set.execute({ pageRef: `page-${i}`, title: `Title ${i}` });
    }
    const listed = await new ListSeoProfiles(h).execute({ first: 10 });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.items).toHaveLength(2);

    const created = await set.execute({ pageRef: "page-x", title: "X" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const found = await new GetSeoProfile(h).execute({ profileId: created.value.id });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.pageRef).toBe("page-x");

    const missing = await new GetSeoProfile(h).execute({ profileId: "nope" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });

  it("ListRedirects paginates and GetRedirect returns the redirect, or NotFoundError", async () => {
    const h = harness();
    const create = new CreateRedirect(h);
    const created = await create.execute({ fromPath: "/old", toPath: "/new", statusCode: 301 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const listed = await new ListRedirects(h).execute({ first: 10 });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.items).toHaveLength(1);

    const found = await new GetRedirect(h).execute({ redirectId: created.value.id });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.fromPath).toBe("/old");

    const missing = await new GetRedirect(h).execute({ redirectId: "nope" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });

  it("ListSitemaps paginates and GetSitemap returns the sitemap, or NotFoundError", async () => {
    const h = harness();
    const created = await new CreateSitemap(h).execute({ name: "main" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const listed = await new ListSitemaps(h).execute({ first: 10 });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.items).toHaveLength(1);

    const found = await new GetSitemap(h).execute({ sitemapId: created.value.id });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.name).toBe("main");

    const missing = await new GetSitemap(h).execute({ sitemapId: "nope" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });

  it("ListRobotsPolicies paginates and GetRobotsPolicy returns the policy, or NotFoundError", async () => {
    const h = harness();
    const created = await new SetRobotsPolicy(h).execute({ userAgent: "*", rules: [] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const listed = await new ListRobotsPolicies(h).execute({ first: 10 });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.items).toHaveLength(1);

    const found = await new GetRobotsPolicy(h).execute({ policyId: created.value.id });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.userAgent).toBe("*");

    const missing = await new GetRobotsPolicy(h).execute({ policyId: "nope" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});
