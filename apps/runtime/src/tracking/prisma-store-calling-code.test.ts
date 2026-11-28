import type { Database } from "@platform/db";
import { beforeEach, describe, expect, it } from "vitest";

import { prismaStoreCallingCodeOf } from "./prisma-store-calling-code";

beforeEach(() => {
  expect.hasAssertions();
});

interface Call {
  readonly where: unknown;
  readonly select: unknown;
}

function fakeDb(row: { currency: string } | null | Error) {
  const calls: Call[] = [];
  const raw: unknown[] = [];
  const tx = {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      raw.push({ sql: strings.join("?"), values });
      return Promise.resolve(1);
    },
    storeSettings: {
      findFirst: (args: Call) => {
        calls.push(args);
        return row instanceof Error ? Promise.reject(row) : Promise.resolve(row);
      },
    },
  };
  const db = {
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as Database;
  return { db, calls, raw };
}

describe("prismaStoreCallingCodeOf", () => {
  it("maps the store currency to its calling code, scoped to the tenant", async () => {
    const { db, calls, raw } = fakeDb({ currency: "SAR" });
    await expect(prismaStoreCallingCodeOf(db)("t-1")).resolves.toBe("966");
    expect(calls).toEqual([{ where: { tenantId: "t-1" }, select: { currency: true } }]);
    expect(JSON.stringify(raw)).toContain("t-1");
  });

  it("is Egypt for a store with no settings row or an unmapped currency", async () => {
    await expect(prismaStoreCallingCodeOf(fakeDb(null).db)("t-1")).resolves.toBe("20");
    await expect(prismaStoreCallingCodeOf(fakeDb({ currency: "USD" }).db)("t-1")).resolves.toBe(
      "20",
    );
  });

  it("falls back to Egypt and reports (by name only) when the read fails", async () => {
    const errors: unknown[] = [];
    const { db } = fakeDb(new Error("connection refused: postgres://secret"));
    await expect(prismaStoreCallingCodeOf(db, (error) => errors.push(error))("t-1")).resolves.toBe(
      "20",
    );
    expect(errors).toHaveLength(1);
  });
});
