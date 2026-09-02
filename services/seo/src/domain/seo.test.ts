import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { Redirect } from "./redirect";
import { RobotsPolicy } from "./robots-policy";
import { SeoProfile } from "./seo-profile";
import { Sitemap } from "./sitemap";
import { SeoMetadata } from "./value-objects/seo";

describe("SeoProfile", () => {
  it("creates and updates metadata", () => {
    const profile = SeoProfile.create(
      UniqueEntityId.from("profile-1"),
      "page-1",
      SeoMetadata.create({ title: "Home" }),
      "evt-1",
      new Date(0),
    );
    expect(profile.pullDomainEvents()).toHaveLength(1);
    profile.update(SeoMetadata.create({ title: "Homepage" }), "evt-2", new Date(0));
    expect(profile.metadata.title).toBe("Homepage");
  });
});

describe("Redirect", () => {
  it("creates and deactivates", () => {
    const redirect = Redirect.create(
      UniqueEntityId.from("redirect-1"),
      "/old",
      "/new",
      301,
      "evt-1",
      new Date(0),
    );
    expect(redirect.active).toBe(true);
    redirect.deactivate("evt-2", new Date(0));
    expect(redirect.active).toBe(false);
  });
});

describe("Sitemap", () => {
  it("regenerates its URL list", () => {
    const sitemap = Sitemap.create(UniqueEntityId.from("sitemap-1"), "main", "evt-1", new Date(0));
    sitemap.regenerate(["/", "/about"], "evt-2", new Date(1000));
    expect(sitemap.urls).toHaveLength(2);
    expect(sitemap.lastGeneratedAt).toEqual(new Date(1000));
  });
});

describe("RobotsPolicy", () => {
  it("sets rules", () => {
    const policy = RobotsPolicy.create(UniqueEntityId.from("policy-1"), "*", "evt-1", new Date(0));
    policy.setRules([{ type: "disallow", path: "/admin" }], "evt-2", new Date(0));
    expect(policy.rules).toHaveLength(1);
  });
});
