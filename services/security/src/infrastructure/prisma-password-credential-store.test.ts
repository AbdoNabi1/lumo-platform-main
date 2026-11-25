import type { Database } from "@platform/db";
import { describe, expect, it } from "vitest";
import { InMemoryPasswordCredentialStore } from "./in-memory-password-credential-store";
import { PrismaPasswordCredentialStore } from "./prisma-password-credential-store";

const input = {
  tenantId: "tenant-a",
  identifier: "staff:sam@example.com",
  principalExternalId: "p-1",
  passwordHash: "scrypt$14$8$1$salt$hash",
};

describe("PasswordCredentialStore.save(input, tx?)", () => {
  it("Prisma: with a tx it upserts through that client and opens no transaction of its own", async () => {
    const upserts: unknown[] = [];
    const tx = {
      securityPasswordCredential: {
        upsert: async (args: unknown) => {
          upserts.push(args);
        },
      },
    };
    const prisma = {
      $transaction: async () => {
        throw new Error("must not open its own transaction");
      },
    } as unknown as Database;
    const store = new PrismaPasswordCredentialStore(prisma);
    await store.save(input, tx);
    expect(upserts).toEqual([
      {
        where: {
          tenantId_identifier: { tenantId: "tenant-a", identifier: "staff:sam@example.com" },
        },
        create: { id: expect.any(String), ...input },
        update: {
          principalExternalId: "p-1",
          passwordHash: input.passwordHash,
          failedAttempts: 0,
          lockedUntil: null,
          version: { increment: 1 },
        },
      },
    ]);
  });

  it("Prisma: without a tx it still runs in its own tenant-scoped transaction (backward compatible)", async () => {
    const steps: string[] = [];
    const client = {
      $executeRaw: async () => {
        steps.push("set_config");
      },
      securityPasswordCredential: {
        upsert: async () => {
          steps.push("upsert");
        },
      },
    };
    const prisma = {
      $transaction: async (fn: (c: unknown) => Promise<unknown>) => {
        steps.push("begin");
        return fn(client);
      },
    } as unknown as Database;
    await new PrismaPasswordCredentialStore(prisma).save(input);
    expect(steps).toEqual(["begin", "set_config", "upsert"]);
  });

  it("in-memory: ignores tx and stores the credential", async () => {
    const store = new InMemoryPasswordCredentialStore();
    await store.save(input, { anything: true });
    expect((await store.find("tenant-a", "staff:sam@example.com"))?.passwordHash).toBe(
      input.passwordHash,
    );
  });
});
