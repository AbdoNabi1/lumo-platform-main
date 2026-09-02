import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireSeo } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire() {
  return wireSeo({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

describe("seo (end to end)", () => {
  it("sets a profile, creates a redirect/sitemap/robots policy, publishing canonical events", async () => {
    const app = wire();
    const profile = await app.seo.setSeoProfile({ pageRef: "page-1", title: "Home" });
    expect(profile.status).toBe(200);

    const redirect = await app.seo.createRedirect({
      fromPath: "/old",
      toPath: "/new",
      statusCode: 301,
    });
    expect(redirect.status).toBe(201);

    const sitemap = await app.seo.createSitemap({ name: "main" });
    expect(sitemap.status).toBe(201);
    const sitemapId = (sitemap.body as { id: string }).id;
    await app.seo.regenerateSitemap({ sitemapId, urls: ["/", "/about"] });

    const robots = await app.seo.setRobotsPolicy({
      userAgent: "*",
      rules: [{ type: "disallow", path: "/admin" }],
    });
    expect(robots.status).toBe(200);

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("seo.profile.created");
    expect(app.deliveredEventTypes).toContain("seo.redirect.created");
  });

  it("rejects creating a duplicate redirect fromPath (409)", async () => {
    const app = wire();
    await app.seo.createRedirect({ fromPath: "/old", toPath: "/new", statusCode: 301 });
    const response = await app.seo.createRedirect({
      fromPath: "/old",
      toPath: "/other",
      statusCode: 302,
    });
    expect(response.status).toBe(409);
  });
});
