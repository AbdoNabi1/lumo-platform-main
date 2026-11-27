import { runInTenantTransaction } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import {
  PrismaPaymentSealedCredentialStore,
  EnvelopePaymentCredentialVault,
} from "@platform/payments";
import { EnvelopeCipher, KeyAliasRegistry } from "@platform/secrets";
import { NodeCrypto } from "@platform/security";
import { logger } from "@platform/utils";
import { describe, expect, it } from "vitest";
import { PostgresAdvisoryResealLock, runCredentialReseal } from "./credential-reseal";

/**
 * D55 against a real PostgreSQL: the single-replica advisory lock and the compare-and-set row update.
 * Needs a migrated test database; skipped otherwise (the unit suite covers the same rules with
 * in-memory stores):
 *
 *   DATABASE_URL_TEST=postgresql://user:password@localhost:5432/lumo_test pnpm --filter @platform/runtime test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

const ALIAS = "payments-credentials";
const KEK_A = "kek-test-aaaa".padEnd(40, "a");
const KEK_B = "kek-test-bbbb".padEnd(40, "b");

function vaultWith(...refsOldestFirst: string[]): EnvelopePaymentCredentialVault {
  const aliases = new KeyAliasRegistry();
  for (const ref of refsOldestFirst) aliases.set(ALIAS, ref);
  return new EnvelopePaymentCredentialVault(new EnvelopeCipher(new NodeCrypto(), aliases), ALIAS);
}

describe.runIf(Boolean(databaseUrl))("credential reseal (integration)", () => {
  it("holds the advisory lock for the whole run: a second runner is refused while the first works", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    try {
      const lock = new PostgresAdvisoryResealLock(prisma);
      let release: () => void = () => undefined;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = lock.runExclusive(() => hold);
      // Give the first transaction time to take the lock, then try to enter.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const second = await lock.runExclusive(() => Promise.resolve("never"));
      expect(second).toEqual({ acquired: false });
      release();
      expect(await first).toEqual({ acquired: true, value: undefined });
      // Released at commit: the next runner gets it.
      expect(await lock.runExclusive(() => Promise.resolve("again"))).toEqual({
        acquired: true,
        value: "again",
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("re-seals a real merchant_payment_settings row under the current key and skips it the second time", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const tenantId = `tenant-itest-reseal-${crypto.randomUUID()}`;
    try {
      const old = await vaultWith(KEK_A).seal(tenantId, "paymob", { secretKey: "sk-test-1111" });
      await runInTenantTransaction(prisma, tenantId, (tx) =>
        tx.merchantPaymentSettings.create({
          data: {
            tenantId,
            enabledMethods: ["paymob"],
            providerSettings: { paymob: { config: { region: "egy" }, sealedCredentials: old } },
          },
        }),
      );

      const vault = vaultWith(KEK_A, KEK_B);
      const plan = {
        targets: [
          {
            name: "payments",
            store: new PrismaPaymentSealedCredentialStore(prisma),
            rewrap: (sealed: string) => vault.reseal(sealed),
          },
        ],
      };
      const lock = new PostgresAdvisoryResealLock(prisma);
      const first = await runCredentialReseal({ plan, lock, logger });
      expect(first.ran).toBe(true);

      const row = await runInTenantTransaction(prisma, tenantId, (tx) =>
        tx.merchantPaymentSettings.findUnique({ where: { tenantId } }),
      );
      const stored = (row?.providerSettings as { paymob: { sealedCredentials: string } }).paymob
        .sealedCredentials;
      expect(stored).not.toBe(old);
      expect(await vaultWith(KEK_B).open(tenantId, "paymob", stored)).toEqual({
        secretKey: "sk-test-1111",
      });

      // The tenant's own row is the only one we assert on (a shared test DB may hold others).
      const second = await runCredentialReseal({ plan, lock, logger });
      expect(second.ran).toBe(true);
      const again = await runInTenantTransaction(prisma, tenantId, (tx) =>
        tx.merchantPaymentSettings.findUnique({ where: { tenantId } }),
      );
      expect((again?.providerSettings as { paymob: { sealedCredentials: string } }).paymob).toEqual(
        { config: { region: "egy" }, sealedCredentials: stored },
      );
    } finally {
      await runInTenantTransaction(prisma, tenantId, (tx) =>
        tx.merchantPaymentSettings.deleteMany({ where: { tenantId } }),
      );
      await prisma.$disconnect();
    }
  });
});
