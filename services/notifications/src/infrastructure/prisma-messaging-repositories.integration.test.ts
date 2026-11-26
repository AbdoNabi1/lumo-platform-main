import { describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import { runInTenantTransaction } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { ConcurrencyError } from "@platform/utils";
import {
  GetSenderDomain,
  StartSenderDomain,
  VerifySenderDomain,
} from "../application/sender-domain.use-cases";
import { UpdateNotificationSettings } from "../application/notification-settings.use-cases";
import { loadSenderContext } from "../application/messaging-support";
import type { StoredSenderDomain } from "../domain/messaging/sender-domain";
import {
  PrismaNotificationSettingsRepository,
  PrismaSenderDomainRepository,
  PrismaTemplateOverrideRepository,
} from "./prisma-messaging-repositories";
import { InMemorySenderDomainProvider } from "./in-memory-sender-domain-provider";

/**
 * Wave 2b - real-PostgreSQL coverage for the three notification tables the migration
 * `20261129000000_notification_settings` creates: `notification_settings` (round trip, version check,
 * two first saves racing), `notification_template_overrides` (put/get/delete per language, isolation)
 * and `sender_domains` (round trip, replace, verified lookups, the cross-store check, and the
 * authenticate -> verify -> From flow over the real tables). Gated on `DATABASE_URL_TEST` with the
 * migration applied:
 *
 *   DATABASE_URL_TEST=postgresql://lumo:***@localhost:5432/lumo_test pnpm --filter @platform/notifications test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

const newTenant = () => `tenant-w2b-${crypto.randomUUID().slice(0, 8)}`;

const values = {
  senderEmail: "support@brand.example",
  staffRecipients: ["owner@brand.example", "ops@brand.example"],
  disabledTemplates: ["order_canceled"],
};
const defaults = { senderEmail: null, staffRecipients: [], disabledTemplates: [] };

describe.runIf(Boolean(databaseUrl))("notification_settings (integration)", () => {
  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const settings = new PrismaNotificationSettingsRepository(prisma);
    // The tenant-scoped unit of work production uses: app.tenant_id is set for the transaction.
    const unitOfWork = {
      run: <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        runInTenantTransaction(prisma, tenantId, (tx) => work(tx)),
    };
    const store = {
      get: () => Promise.resolve({ storeName: "Brand", contactEmail: null, defaultLocale: "en" }),
    };
    const update = new UpdateNotificationSettings({
      settings,
      store,
      senderDomains: new PrismaSenderDomainRepository(prisma),
      platformFrom: "Morbeh <onboarding@resend.dev>",
      unitOfWork,
      deliveryConfigured: false,
    });
    return { prisma, settings, unitOfWork, update };
  }

  it("a shop with no row reads null, then a save reads back exactly at version 1", async () => {
    const tenantId = newTenant();
    const { prisma, settings, update } = wire(tenantId);
    expect(await settings.find(tenantId)).toBeNull();

    const saved = await update.execute({ tenantId, expectedVersion: null, values });

    expect(saved.ok && saved.value.version).toBe(1);
    expect(await settings.find(tenantId)).toEqual({ values, version: 1 });
    await prisma.$disconnect();
  });

  it("updates at the version that was read, bumps it, and refuses a stale one with CONFLICT", async () => {
    const tenantId = newTenant();
    const { prisma, settings, update } = wire(tenantId);
    await update.execute({ tenantId, expectedVersion: null, values });

    const second = await update.execute({ tenantId, expectedVersion: 1, values: defaults });
    const stale = await update.execute({ tenantId, expectedVersion: 1, values });

    expect(second.ok && second.value.version).toBe(2);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("CONFLICT");
    expect(await settings.find(tenantId)).toEqual({ values: defaults, version: 2 });
    await prisma.$disconnect();
  });

  it("the repository alone maps a stale update and a second first save to ConcurrencyError", async () => {
    const tenantId = newTenant();
    const { prisma, settings, unitOfWork } = wire(tenantId);
    await unitOfWork.run((tx) => settings.save(tenantId, values, null, tx));

    await expect(
      unitOfWork.run((tx) => settings.save(tenantId, defaults, null, tx)),
    ).rejects.toBeInstanceOf(ConcurrencyError);
    await expect(
      unitOfWork.run((tx) => settings.save(tenantId, defaults, 7, tx)),
    ).rejects.toBeInstanceOf(ConcurrencyError);
    expect((await settings.find(tenantId))?.version).toBe(1);
    await prisma.$disconnect();
  });

  it("two concurrent FIRST saves: exactly one wins, the other is 409 CONFLICT (never a thrown 500)", async () => {
    const tenantId = newTenant();
    const { prisma, settings, update } = wire(tenantId);

    const results = await Promise.all([
      update.execute({ tenantId, expectedVersion: null, values }),
      update.execute({ tenantId, expectedVersion: null, values: defaults }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const lost = results.find((result) => !result.ok);
    expect(lost && !lost.ok && lost.error.code).toBe("CONFLICT");
    expect((await settings.find(tenantId))?.version).toBe(1);
    await prisma.$disconnect();
  });

  it("settings are per shop: another shop's row is invisible", async () => {
    const a = newTenant();
    const b = newTenant();
    const wiredA = wire(a);
    await wiredA.update.execute({ tenantId: a, expectedVersion: null, values });

    expect(await wiredA.settings.find(b)).toBeNull();
    await wiredA.prisma.$disconnect();
  });
});

describe.runIf(Boolean(databaseUrl))("notification_template_overrides (integration)", () => {
  const copy = { subject: "Thanks {{customer_name}}", body: "We got your order." };

  it("put, get, update and delete per language; reverting what is not there is fine", async () => {
    const tenantId = newTenant();
    const prisma = createTestPrismaClient(databaseUrl);
    const overrides = new PrismaTemplateOverrideRepository(prisma);
    expect(await overrides.find(tenantId, "order_confirmation", "en")).toBeNull();

    await overrides.upsert(tenantId, { key: "order_confirmation", locale: "en", ...copy });
    await overrides.upsert(tenantId, {
      key: "order_confirmation",
      locale: "ar",
      subject: "شكرا",
      body: "وصلنا طلبك",
    });
    expect(await overrides.find(tenantId, "order_confirmation", "en")).toEqual({
      key: "order_confirmation",
      locale: "en",
      ...copy,
    });
    expect(await overrides.list(tenantId)).toHaveLength(2);

    // Saving the same template and language again updates it in place.
    await overrides.upsert(tenantId, {
      key: "order_confirmation",
      locale: "en",
      subject: "Updated",
      body: "Updated body",
    });
    expect(await overrides.find(tenantId, "order_confirmation", "en")).toMatchObject({
      subject: "Updated",
    });
    expect(await overrides.list(tenantId)).toHaveLength(2);

    // Delete is per language: the Arabic copy stays.
    await overrides.remove(tenantId, "order_confirmation", "en");
    expect(await overrides.find(tenantId, "order_confirmation", "en")).toBeNull();
    expect(await overrides.find(tenantId, "order_confirmation", "ar")).not.toBeNull();
    await overrides.remove(tenantId, "order_confirmation", "en");
    expect(await overrides.list(tenantId)).toHaveLength(1);
    await prisma.$disconnect();
  });

  it("overrides are per shop: another shop sees none, and cannot delete them", async () => {
    const a = newTenant();
    const b = newTenant();
    const prisma = createTestPrismaClient(databaseUrl);
    const overrides = new PrismaTemplateOverrideRepository(prisma);
    await overrides.upsert(a, { key: "order_canceled", locale: "en", ...copy });

    expect(await overrides.find(b, "order_canceled", "en")).toBeNull();
    expect(await overrides.list(b)).toEqual([]);
    await overrides.remove(b, "order_canceled", "en");
    expect(await overrides.find(a, "order_canceled", "en")).toMatchObject(copy);
    await prisma.$disconnect();
  });
});

describe.runIf(Boolean(databaseUrl))("sender_domains (integration)", () => {
  const records = [
    {
      record: "DKIM",
      name: "resend._domainkey",
      type: "TXT",
      value: "p=abc",
      ttl: "Auto",
      status: "pending",
      priority: null,
    },
    {
      record: "SPF",
      name: "send",
      type: "MX",
      value: "feedback-smtp.example",
      ttl: "Auto",
      status: "pending",
      priority: 10,
    },
  ];
  const row = (
    domain: string,
    status: StoredSenderDomain["status"] = "pending",
  ): StoredSenderDomain => ({
    domain,
    providerDomainId: `dom_${domain}`,
    status,
    records,
    verifiedAt: status === "verified" ? new Date("2026-11-26T10:00:00.000Z") : null,
  });
  const unique = () => `${crypto.randomUUID().slice(0, 8)}.example`;

  it("round trips a row (records and verified_at), updates it in place and lists only verified", async () => {
    const tenantId = newTenant();
    const domain = unique();
    const prisma = createTestPrismaClient(databaseUrl);
    const repo = new PrismaSenderDomainRepository(prisma);
    expect(await repo.find(tenantId)).toBeNull();

    await repo.save(tenantId, row(domain));
    expect(await repo.find(tenantId)).toEqual(row(domain));
    expect(await repo.listVerifiedDomains(tenantId)).toEqual([]);

    await repo.save(tenantId, row(domain, "verified"));
    expect(await repo.find(tenantId)).toEqual(row(domain, "verified"));
    expect(await repo.listVerifiedDomains(tenantId)).toEqual([domain]);

    await repo.save(tenantId, { ...row(domain, "failed"), verifiedAt: null });
    expect(await repo.listVerifiedDomains(tenantId)).toEqual([]);
    expect((await repo.find(tenantId))?.verifiedAt).toBeNull();
    await prisma.$disconnect();
  });

  it("replacing moves the store to the new domain in one write", async () => {
    const tenantId = newTenant();
    const oldDomain = unique();
    const newDomain = unique();
    const prisma = createTestPrismaClient(databaseUrl);
    const repo = new PrismaSenderDomainRepository(prisma);
    await repo.save(tenantId, row(oldDomain));

    await repo.save(tenantId, row(newDomain), { replacing: oldDomain });

    expect(await repo.find(tenantId)).toMatchObject({ domain: newDomain });
    const remaining = await prisma.senderDomain.count({ where: { tenantId } });
    expect(remaining).toBe(1);
    await prisma.$disconnect();
  });

  it("two concurrent first saves of one domain: one wins, the other is a ConcurrencyError", async () => {
    const tenantId = newTenant();
    const domain = unique();
    const prisma = createTestPrismaClient(databaseUrl);
    const repo = new PrismaSenderDomainRepository(prisma);

    const settled = await Promise.allSettled([
      repo.save(tenantId, row(domain)),
      repo.save(tenantId, row(domain)),
    ]);

    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = settled.find((r) => r.status === "rejected");
    expect(lost?.status === "rejected" && lost.reason).toBeInstanceOf(ConcurrencyError);
    await prisma.$disconnect();
  });

  it("another store's rows are invisible to find and the verified list", async () => {
    const a = newTenant();
    const b = newTenant();
    const domain = unique();
    const prisma = createTestPrismaClient(databaseUrl);
    const repo = new PrismaSenderDomainRepository(prisma);
    await repo.save(a, row(domain, "verified"));

    expect(await repo.find(b)).toBeNull();
    expect(await repo.listVerifiedDomains(b)).toEqual([]);
    await prisma.$disconnect();
  });

  it("isVerifiedByAnotherStore: true only for a DIFFERENT store's verified row", async () => {
    const a = newTenant();
    const b = newTenant();
    const verified = unique();
    const pending = unique();
    const prisma = createTestPrismaClient(databaseUrl);
    const repo = new PrismaSenderDomainRepository(prisma);
    await repo.save(a, row(verified, "verified"));
    await repo.save(a, row(pending));

    expect(await repo.isVerifiedByAnotherStore(verified, b)).toBe(true);
    expect(await repo.isVerifiedByAnotherStore(verified, a)).toBe(false);
    expect(await repo.isVerifiedByAnotherStore(pending, b)).toBe(false);
    expect(await repo.isVerifiedByAnotherStore(unique(), b)).toBe(false);
    await prisma.$disconnect();
  });

  it("authenticate -> verify -> From over the real tables, and back to Reply-To on a regression", async () => {
    const a = newTenant();
    const b = newTenant();
    const domain = unique();
    const prisma = createTestPrismaClient(databaseUrl);
    const senderDomains = new PrismaSenderDomainRepository(prisma);
    const settings = new PrismaNotificationSettingsRepository(prisma);
    const store = {
      get: () =>
        Promise.resolve({
          storeName: "Brand",
          contactEmail: `hello@${domain}`,
          defaultLocale: "en",
        }),
    };
    const twin = new InMemorySenderDomainProvider();
    const clock: Clock = { now: () => new Date("2026-11-26T10:00:00.000Z") };
    const deps = { settings, store, senderDomains, provider: twin, clock };
    const resolve = (tenantId: string) =>
      loadSenderContext(
        { settings, store, senderDomains, platformFrom: "Morbeh <onboarding@resend.dev>" },
        tenantId,
      );

    const started = await new StartSenderDomain(deps).execute({ tenantId: a });
    expect(started.ok && started.value.domain?.domain).toBe(domain);
    expect((await resolve(a)).sender.mode).toBe("reply_to");

    twin.setStatus(twin.idOf(domain) ?? "", "verified");
    const verified = await new VerifySenderDomain(deps).execute({ tenantId: a });
    expect(verified.ok && verified.value.domain?.verified).toBe(true);
    expect((await resolve(a)).sender).toMatchObject({
      mode: "own_domain",
      from: `"Brand" <hello@${domain}>`,
    });

    // The same domain on another store is refused.
    const refused = await new StartSenderDomain(deps).execute({ tenantId: b });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toBe("This domain is used by another store");

    twin.setStatus(twin.idOf(domain) ?? "", "failed");
    await new VerifySenderDomain(deps).execute({ tenantId: a });
    expect((await resolve(a)).sender.mode).toBe("reply_to");
    expect(await new GetSenderDomain(deps).execute({ tenantId: a })).toMatchObject({
      ok: true,
      value: { domain: { status: "failed", verifiedAt: null } },
    });
    await prisma.$disconnect();
  });
});
