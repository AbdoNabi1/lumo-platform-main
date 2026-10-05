import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Tenant } from "../domain/tenant";
import { TenantSlug } from "../domain/value-objects/tenant-slug";
import type { DnsVerifier } from "../domain/dns-verifier";
import {
  InMemoryShopDomainRepository,
  InMemoryTenantRepository,
} from "../infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { TenancyEventTranslator } from "../infrastructure/tenancy-event-translator";
import {
  AddCustomDomain,
  ListShopDomains,
  ResolveHost,
  SetPrimaryDomain,
  VerifyDomain,
  type ShopDomainsDeps,
} from "./shop-domains.use-cases";

const clock: Clock = { now: () => new Date("2026-10-05T00:00:00.000Z") };

async function setup(dns?: DnsVerifier) {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new TenancyEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "tenancy",
  });
  const context = rootEventContext(idGenerator, "platform");
  const tenants = new InMemoryTenantRepository({ outbox, context });
  const slug = TenantSlug.create("acme");
  if (!slug.ok) throw new Error("fixture");
  await tenants.save(
    Tenant.create(UniqueEntityId.from("shop-1"), slug.value, "Acme", "pooled", "e-1", clock.now()),
  );
  const deps: ShopDomainsDeps = {
    tenants,
    domains: new InMemoryShopDomainRepository(),
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator,
    clock,
    platformStoreDomain: "morbeh.store",
    ...(dns === undefined ? {} : { dnsVerifier: dns }),
  };
  return deps;
}

const pointsHere: DnsVerifier = { pointsToPlatform: async () => true };
const pointsElsewhere: DnsVerifier = { pointsToPlatform: async () => false };

describe("shop domain use cases", () => {
  it("adds a custom domain as pending, normalised", async () => {
    const deps = await setup();
    const added = await new AddCustomDomain(deps).execute({
      shopId: "shop-1",
      hostname: "Shop.Acme.COM",
    });
    expect(added.ok).toBe(true);
    const list = await new ListShopDomains(deps).execute({ shopId: "shop-1" });
    if (!list.ok) throw new Error("list failed");
    expect(list.value.items).toEqual([
      expect.objectContaining({ hostname: "shop.acme.com", status: "pending", isPrimary: false }),
    ]);
  });

  it("refuses an unknown shop, a taken hostname, and the platform's own zone", async () => {
    const deps = await setup();
    const unknown = await new AddCustomDomain(deps).execute({ shopId: "nope", hostname: "x.com" });
    expect(unknown.ok || unknown.error.code).toBe("NOT_FOUND");
    await new AddCustomDomain(deps).execute({ shopId: "shop-1", hostname: "acme.com" });
    const taken = await new AddCustomDomain(deps).execute({
      shopId: "shop-1",
      hostname: "ACME.com",
    });
    expect(taken.ok || taken.error.code).toBe("CONFLICT");
    const reserved = await new AddCustomDomain(deps).execute({
      shopId: "shop-1",
      hostname: "evil.morbeh.store",
    });
    expect(reserved.ok || reserved.error.code).toBe("VALIDATION");
  });

  it("verifies only when DNS points at the platform, and only when a verifier is configured", async () => {
    const noDns = await setup();
    const a = await new AddCustomDomain(noDns).execute({ shopId: "shop-1", hostname: "a.com" });
    if (!a.ok) throw new Error("add failed");
    const unconfigured = await new VerifyDomain(noDns).execute({ domainId: a.value.id });
    expect(unconfigured.ok || unconfigured.error.code).toBe("BUSINESS_RULE");

    const elsewhere = await setup(pointsElsewhere);
    const b = await new AddCustomDomain(elsewhere).execute({ shopId: "shop-1", hostname: "b.com" });
    if (!b.ok) throw new Error("add failed");
    const notYet = await new VerifyDomain(elsewhere).execute({ domainId: b.value.id });
    expect(notYet.ok || notYet.error.code).toBe("BUSINESS_RULE");

    const here = await setup(pointsHere);
    const c = await new AddCustomDomain(here).execute({ shopId: "shop-1", hostname: "c.com" });
    if (!c.ok) throw new Error("add failed");
    const verified = await new VerifyDomain(here).execute({ domainId: c.value.id });
    expect(verified.ok && verified.value.status).toBe("verified");
  });

  it("setting a primary demotes the previous primary of the same shop", async () => {
    const deps = await setup(pointsHere);
    const first = await new AddCustomDomain(deps).execute({
      shopId: "shop-1",
      hostname: "one.com",
    });
    const second = await new AddCustomDomain(deps).execute({
      shopId: "shop-1",
      hostname: "two.com",
    });
    if (!first.ok || !second.ok) throw new Error("add failed");
    await new VerifyDomain(deps).execute({ domainId: first.value.id });
    await new VerifyDomain(deps).execute({ domainId: second.value.id });
    await new SetPrimaryDomain(deps).execute({ domainId: first.value.id });
    await new SetPrimaryDomain(deps).execute({ domainId: second.value.id });
    const list = await new ListShopDomains(deps).execute({ shopId: "shop-1" });
    if (!list.ok) throw new Error("list failed");
    const primaries = list.value.items.filter((d) => d.isPrimary).map((d) => d.hostname);
    expect(primaries).toEqual(["two.com"]);
  });

  it("resolves a verified hostname to its shop and primary hostname; pending and unknown are NOT_FOUND", async () => {
    const deps = await setup(pointsHere);
    const added = await new AddCustomDomain(deps).execute({
      shopId: "shop-1",
      hostname: "acme.com",
    });
    if (!added.ok) throw new Error("add failed");

    const pending = await new ResolveHost(deps).execute({ hostname: "acme.com" });
    expect(pending.ok || pending.error.code).toBe("NOT_FOUND");

    await new VerifyDomain(deps).execute({ domainId: added.value.id });
    await new SetPrimaryDomain(deps).execute({ domainId: added.value.id });
    const resolved = await new ResolveHost(deps).execute({ hostname: "ACME.com." });
    expect(resolved.ok && resolved.value).toEqual({
      shopId: "shop-1",
      hostname: "acme.com",
      primaryHostname: "acme.com",
      shopStatus: "active",
    });

    const unknown = await new ResolveHost(deps).execute({ hostname: "nobody.com" });
    expect(unknown.ok || unknown.error.code).toBe("NOT_FOUND");
    const garbage = await new ResolveHost(deps).execute({ hostname: "not a host" });
    expect(garbage.ok || garbage.error.code).toBe("NOT_FOUND");
  });
});
