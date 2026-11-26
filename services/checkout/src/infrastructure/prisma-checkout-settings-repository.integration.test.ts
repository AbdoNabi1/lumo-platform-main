import { describe, expect, it } from "vitest";
import { runInTenantTransaction } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { ConcurrencyError } from "@platform/utils";
import { UpdateCheckoutSettings } from "../application/checkout-settings.use-cases";
import {
  DEFAULT_CHECKOUT_SETTINGS,
  type CheckoutSettingsValues,
} from "../domain/checkout-settings";
import { PrismaCheckoutSettingsRepository } from "./prisma-checkout-settings-repository";

/**
 * Wave 2a - real-PostgreSQL coverage for `checkout.checkout_settings`: the save/read round trip, the
 * version check, and two FIRST saves racing (the unique violation must come out as a CONFLICT, not a
 * failed commit). Gated on `DATABASE_URL_TEST` with the migration applied:
 *
 *   DATABASE_URL_TEST=postgresql://lumo:***@localhost:5432/lumo_test pnpm --filter @platform/checkout test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

const values: CheckoutSettingsValues = {
  ...DEFAULT_CHECKOUT_SETTINGS,
  phoneMode: "optional",
  line2Mode: "required",
  marketingEmailPrompt: "show",
  cartLineLimit: 6,
};

describe.runIf(Boolean(databaseUrl))("PrismaCheckoutSettingsRepository (integration)", () => {
  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const settings = new PrismaCheckoutSettingsRepository(prisma);
    // The tenant-scoped unit of work production uses: app.tenant_id is set for the transaction.
    const unitOfWork = {
      run: <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        runInTenantTransaction(prisma, tenantId, (tx) => work(tx)),
    };
    return {
      prisma,
      settings,
      unitOfWork,
      update: new UpdateCheckoutSettings({ settings, unitOfWork }),
    };
  }
  const newTenant = () => `tenant-w2a-settings-${crypto.randomUUID().slice(0, 8)}`;

  it("a shop with no row reads null, then a save reads back exactly at version 1", async () => {
    const tenantId = newTenant();
    const { prisma, settings, update } = wire(tenantId);
    expect(await settings.find(tenantId)).toBeNull();

    const saved = await update.execute({ tenantId, expectedVersion: null, values });

    expect(saved.ok && saved.value.version).toBe(1);
    expect(await settings.find(tenantId)).toEqual({ values, version: 1 });
    await prisma.$disconnect();
  });

  it("updates at the version that was read, bumps it, and refuses a stale one", async () => {
    const tenantId = newTenant();
    const { prisma, settings, update } = wire(tenantId);
    await update.execute({ tenantId, expectedVersion: null, values });

    const second = await update.execute({
      tenantId,
      expectedVersion: 1,
      values: DEFAULT_CHECKOUT_SETTINGS,
    });
    const stale = await update.execute({ tenantId, expectedVersion: 1, values });

    expect(second.ok && second.value.version).toBe(2);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("CONFLICT");
    expect(await settings.find(tenantId)).toEqual({
      values: DEFAULT_CHECKOUT_SETTINGS,
      version: 2,
    });
    await prisma.$disconnect();
  });

  it("the repository alone maps the unique violation of a second first save to ConcurrencyError", async () => {
    const tenantId = newTenant();
    const { prisma, settings, unitOfWork } = wire(tenantId);
    await unitOfWork.run((tx) => settings.save(tenantId, values, null, tx));

    await expect(
      unitOfWork.run((tx) => settings.save(tenantId, DEFAULT_CHECKOUT_SETTINGS, null, tx)),
    ).rejects.toBeInstanceOf(ConcurrencyError);
    await prisma.$disconnect();
  });

  it("two concurrent FIRST saves: exactly one wins, the other is 409 CONFLICT (never a thrown 500)", async () => {
    const tenantId = newTenant();
    const { prisma, settings, update } = wire(tenantId);

    const results = await Promise.all([
      update.execute({ tenantId, expectedVersion: null, values }),
      update.execute({ tenantId, expectedVersion: null, values: DEFAULT_CHECKOUT_SETTINGS }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const lost = results.find((result) => !result.ok);
    expect(lost && !lost.ok && lost.error.code).toBe("CONFLICT");
    expect(lost && !lost.ok && lost.error.message).toBe(
      "These settings were changed by someone else",
    );
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
