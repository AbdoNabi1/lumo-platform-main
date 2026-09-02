import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { Tenant } from "./tenant";
import { TenantSlug } from "./value-objects/tenant-slug";
import { Workspace } from "./workspace";

function slug(value = "acme"): TenantSlug {
  const result = TenantSlug.create(value);
  if (!result.ok) throw new Error("invalid slug in test fixture");
  return result.value;
}

describe("Tenant", () => {
  it("creates active, then suspends/reactivates/cancels", () => {
    const tenant = Tenant.create(
      UniqueEntityId.from("tenant-1"),
      slug(),
      "Acme Inc",
      "pooled",
      "evt-1",
      new Date(0),
    );
    expect(tenant.status).toBe("active");
    tenant.suspend("evt-2", new Date(0));
    expect(tenant.status).toBe("suspended");
    tenant.activate("evt-3", new Date(0));
    expect(tenant.status).toBe("active");
    tenant.cancel("evt-4", new Date(0));
    expect(tenant.status).toBe("cancelled");
  });

  it("rejects transitions out of cancelled", () => {
    const tenant = Tenant.create(
      UniqueEntityId.from("tenant-2"),
      slug("beta"),
      "Beta Inc",
      "pooled",
      "evt-1",
      new Date(0),
    );
    tenant.cancel("evt-2", new Date(0));
    expect(() => tenant.activate("evt-3", new Date(0))).toThrow();
  });

  it("rebrands and pins a subscription ref", () => {
    const tenant = Tenant.create(
      UniqueEntityId.from("tenant-3"),
      slug("gamma"),
      "Gamma Inc",
      "dedicated_schema",
      "evt-1",
      new Date(0),
    );
    tenant.rebrand({ logo: "logo-1" }, "evt-2", new Date(0));
    expect(tenant.branding.logo).toBe("logo-1");
    tenant.pinSubscription("sub-1");
    expect(tenant.subscriptionRef).toBe("sub-1");
  });

  it("rejects an invalid slug", () => {
    const result = TenantSlug.create("Not Valid!");
    expect(result.ok).toBe(false);
  });
});

describe("Workspace", () => {
  it("creates active and archives", () => {
    const workspace = Workspace.create(
      UniqueEntityId.from("ws-1"),
      "tenant-1",
      "production",
      "Main",
      "evt-1",
      new Date(0),
    );
    expect(workspace.status).toBe("active");
    workspace.archive("evt-2", new Date(0));
    expect(workspace.status).toBe("archived");
    expect(() => workspace.archive("evt-3", new Date(0))).toThrow();
  });

  it("patch-configures white-label settings", () => {
    const workspace = Workspace.create(
      UniqueEntityId.from("ws-2"),
      "tenant-1",
      "staging",
      "Staging",
      "evt-1",
      new Date(0),
    );
    workspace.configure({ themeRef: "theme-1", locale: "en-US" }, "evt-2", new Date(0));
    expect(workspace.config.themeRef).toBe("theme-1");
    expect(workspace.config.locale).toBe("en-US");
    workspace.configure({ currency: "USD" }, "evt-3", new Date(0));
    expect(workspace.config.themeRef).toBe("theme-1");
    expect(workspace.config.currency).toBe("USD");
  });
});
