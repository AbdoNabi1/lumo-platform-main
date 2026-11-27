import { describe, expect, it } from "vitest";
import { runInTenantTransaction } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { ConcurrencyError } from "@platform/utils";
import { UpdateNotificationSettings } from "../application/notification-settings.use-cases";
import {
  PrismaEmailConnectionRepository,
  PrismaNotificationSettingsRepository,
  PrismaTemplateOverrideRepository,
} from "./prisma-messaging-repositories";

/**
 * Real-PostgreSQL coverage for the notification tables: `notification_settings` (round trip, version
 * check, two first saves racing) and `notification_template_overrides` (put/get/delete per language,
 * isolation) from `20261129000000_notification_settings`, and `email_connections` (round trip, the
 * version check, a second first save racing, failure notes, delete, isolation) from
 * `20261130000000_store_email_connections`. Gated on `DATABASE_URL_TEST` with both migrations applied:
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
      connections: new PrismaEmailConnectionRepository(prisma),
      unitOfWork,
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

describe.runIf(Boolean(databaseUrl))("email_connections (integration)", () => {
  const row = {
    kind: "resend" as const,
    fromEmail: "shop@brand.example",
    sealedCredentials: JSON.stringify({
      v: 1,
      alias: "email-credentials",
      wrappedDek: "w",
      ciphertext: "c",
    }),
    secretLast4: "1234",
    enabled: true,
    status: "connected" as const,
    lastError: null,
    lastErrorAt: null,
    verifiedAt: new Date("2026-11-26T10:00:00.000Z"),
  };

  it("a shop with no row reads null; the first save is version 1 and reads back exactly", async () => {
    const tenantId = newTenant();
    const prisma = createTestPrismaClient(databaseUrl);
    const repo = new PrismaEmailConnectionRepository(prisma);
    expect(await repo.find(tenantId)).toBeNull();
    expect(await repo.save(tenantId, row, null)).toBe(1);
    expect(await repo.find(tenantId)).toEqual({ ...row, version: 1 });
    await prisma.$disconnect();
  });

  it("updates at the version that was read, bumps it, and refuses a stale one with ConcurrencyError", async () => {
    const tenantId = newTenant();
    const prisma = createTestPrismaClient(databaseUrl);
    const repo = new PrismaEmailConnectionRepository(prisma);
    await repo.save(tenantId, row, null);
    expect(await repo.save(tenantId, { ...row, enabled: false }, 1)).toBe(2);
    await expect(repo.save(tenantId, row, 1)).rejects.toBeInstanceOf(ConcurrencyError);
    await expect(repo.save(tenantId, row, null)).rejects.toBeInstanceOf(ConcurrencyError);
    expect((await repo.find(tenantId))?.enabled).toBe(false);
    await prisma.$disconnect();
  });

  it("two concurrent FIRST saves: exactly one wins, the other is a ConcurrencyError", async () => {
    const tenantId = newTenant();
    const prisma = createTestPrismaClient(databaseUrl);
    const repo = new PrismaEmailConnectionRepository(prisma);
    const results = await Promise.allSettled([
      repo.save(tenantId, row, null),
      repo.save(tenantId, { ...row, fromEmail: "other@brand.example" }, null),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(ConcurrencyError);
    }
    await prisma.$disconnect();
  });

  it("a send failure is noted without touching the version, status or key; delete removes the row", async () => {
    const tenantId = newTenant();
    const prisma = createTestPrismaClient(databaseUrl);
    const repo = new PrismaEmailConnectionRepository(prisma);
    await repo.save(tenantId, row, null);
    const at = new Date("2026-11-26T11:00:00.000Z");
    await repo.recordFailure(tenantId, "The domain is not verified", at);
    expect(await repo.find(tenantId)).toEqual({
      ...row,
      lastError: "The domain is not verified",
      lastErrorAt: at,
      version: 1,
    });
    await repo.remove(tenantId);
    await repo.remove(tenantId);
    expect(await repo.find(tenantId)).toBeNull();
    await prisma.$disconnect();
  });

  it("connections are per shop: another shop sees none and cannot change or delete them", async () => {
    const tenantId = newTenant();
    const other = newTenant();
    const prisma = createTestPrismaClient(databaseUrl);
    const repo = new PrismaEmailConnectionRepository(prisma);
    await repo.save(tenantId, row, null);
    expect(await repo.find(other)).toBeNull();
    await repo.remove(other);
    await repo.recordFailure(other, "x", new Date());
    expect(await repo.find(tenantId)).toEqual({ ...row, version: 1 });
    await prisma.$disconnect();
  });
});
