import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Redirect } from "../domain/redirect";
import { RobotsPolicy } from "../domain/robots-policy";
import { SeoProfile } from "../domain/seo-profile";
import { Sitemap } from "../domain/sitemap";
import { SeoMetadata } from "../domain/value-objects/seo";
import { SeoEventTranslator } from "./seo-event-translator";
import {
  InMemoryRedirectRepository,
  InMemoryRobotsPolicyRepository,
  InMemorySeoProfileRepository,
  InMemorySitemapRepository,
} from "./in-memory-repositories";

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new SeoEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-07-05T00:00:00.000Z") },
    producer: "seo",
  });
  const context = rootEventContext({ generate: nextId });
  return {
    profiles: new InMemorySeoProfileRepository({ outbox, context }),
    redirects: new InMemoryRedirectRepository({ outbox, context }),
    sitemaps: new InMemorySitemapRepository({ outbox, context }),
    robotsPolicies: new InMemoryRobotsPolicyRepository({ outbox, context }),
    nextId,
  };
}

describe("SEO in-memory repositories tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's SEO profile by id, pageRef, or list, through a single repository instance", async () => {
    const { profiles, nextId } = wire();
    const profile = SeoProfile.create(
      UniqueEntityId.from(nextId()),
      "home",
      SeoMetadata.create({}),
      nextId(),
      new Date(0),
    );
    await profiles.save(profile, "tenant-a");

    expect(await profiles.findById(profile.id.toString(), "tenant-a")).not.toBeNull();
    expect(await profiles.findById(profile.id.toString(), "tenant-b")).toBeNull();
    expect(await profiles.findByPageRef("home", "tenant-a")).not.toBeNull();
    expect(await profiles.findByPageRef("home", "tenant-b")).toBeNull();
    expect((await profiles.list({}, "tenant-a")).items).toHaveLength(1);
    expect((await profiles.list({}, "tenant-b")).items).toHaveLength(0);
  });

  it("does not let tenant A read tenant B's redirect, through a single repository instance", async () => {
    const { redirects, nextId } = wire();
    const redirect = Redirect.create(
      UniqueEntityId.from(nextId()),
      "/old",
      "/new",
      301,
      nextId(),
      new Date(0),
    );
    await redirects.save(redirect, "tenant-a");

    expect(await redirects.findById(redirect.id.toString(), "tenant-a")).not.toBeNull();
    expect(await redirects.findById(redirect.id.toString(), "tenant-b")).toBeNull();
    expect(await redirects.findByFromPath("/old", "tenant-a")).not.toBeNull();
    expect(await redirects.findByFromPath("/old", "tenant-b")).toBeNull();
  });

  it("does not let tenant A read tenant B's sitemap, through a single repository instance", async () => {
    const { sitemaps, nextId } = wire();
    const sitemap = Sitemap.create(UniqueEntityId.from(nextId()), "main", nextId(), new Date(0));
    await sitemaps.save(sitemap, "tenant-a");

    expect(await sitemaps.findById(sitemap.id.toString(), "tenant-a")).not.toBeNull();
    expect(await sitemaps.findById(sitemap.id.toString(), "tenant-b")).toBeNull();
    expect(await sitemaps.findByName("main", "tenant-a")).not.toBeNull();
    expect(await sitemaps.findByName("main", "tenant-b")).toBeNull();
  });

  it("does not let tenant A read tenant B's robots policy, through a single repository instance", async () => {
    const { robotsPolicies, nextId } = wire();
    const policy = RobotsPolicy.create(UniqueEntityId.from(nextId()), "*", nextId(), new Date(0));
    await robotsPolicies.save(policy, "tenant-a");

    expect(await robotsPolicies.findById(policy.id.toString(), "tenant-a")).not.toBeNull();
    expect(await robotsPolicies.findById(policy.id.toString(), "tenant-b")).toBeNull();
    expect(await robotsPolicies.findByUserAgent("*", "tenant-a")).not.toBeNull();
    expect(await robotsPolicies.findByUserAgent("*", "tenant-b")).toBeNull();
  });
});
