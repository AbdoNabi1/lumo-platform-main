import type { Database } from "@platform/db";
import { beforeEach, describe, expect, it } from "vitest";

import { PrismaStoreUrlResolver } from "./prisma-store-url-resolver";

beforeEach(() => {
  expect.hasAssertions();
});

const PLATFORM = "platform-tenant";

interface Row {
  readonly hostname: string;
  readonly isPrimary: boolean;
  readonly kind: string;
}

function fakeDb(rows: readonly Row[] | Error) {
  const calls: unknown[] = [];
  const raw: unknown[] = [];
  const tx = {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      raw.push({ sql: strings.join("?"), values });
      return Promise.resolve(1);
    },
    shopDomain: {
      findMany: (args: unknown) => {
        calls.push(args);
        return rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows);
      },
    },
  };
  const db = {
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as Database;
  return { db, calls, raw };
}

function resolver(
  rows: readonly Row[] | Error,
  options: { fallbackUrl?: string; now?: () => Date } = {},
) {
  const { db, calls, raw } = fakeDb(rows);
  return {
    calls,
    raw,
    resolver: new PrismaStoreUrlResolver({
      db,
      platformTenantId: PLATFORM,
      ...(options.fallbackUrl === undefined ? {} : { fallbackUrl: options.fallbackUrl }),
      clock: { now: options.now ?? (() => new Date("2026-11-28T10:00:00.000Z")) },
    }),
  };
}

describe("PrismaStoreUrlResolver", () => {
  it("reads the store's verified domains in the platform scope, filtered by shop ref", async () => {
    const {
      resolver: r,
      calls,
      raw,
    } = resolver([{ hostname: "shop.example", isPrimary: true, kind: "custom" }]);
    await expect(r.storeUrlOf("merchant-1")).resolves.toBe("https://shop.example/");
    expect(calls).toEqual([
      {
        where: { tenantId: PLATFORM, shopRef: "merchant-1", status: "verified" },
        select: { hostname: true, isPrimary: true, kind: true },
        orderBy: { hostname: "asc" },
      },
    ]);
    expect(JSON.stringify(raw)).toContain(PLATFORM);
  });

  it("prefers the primary domain, then a platform domain, then STOREFRONT_PUBLIC_URL's origin", async () => {
    await expect(
      resolver([
        { hostname: "a.platform.test", isPrimary: false, kind: "platform" },
        { hostname: "shop.example", isPrimary: true, kind: "custom" },
      ]).resolver.storeUrlOf("m"),
    ).resolves.toBe("https://shop.example/");
    await expect(
      resolver([
        { hostname: "other.example", isPrimary: false, kind: "custom" },
        { hostname: "a.platform.test", isPrimary: false, kind: "platform" },
      ]).resolver.storeUrlOf("m"),
    ).resolves.toBe("https://a.platform.test/");
    await expect(
      resolver([], { fallbackUrl: "https://store.morbeh.app/some/path" }).resolver.storeUrlOf("m"),
    ).resolves.toBe("https://store.morbeh.app/");
    await expect(resolver([]).resolver.storeUrlOf("m")).resolves.toBeNull();
  });

  it("caches per store for a few minutes and re-reads afterwards; a failed read is not cached", async () => {
    let now = new Date("2026-11-28T10:00:00.000Z");
    const rows: Row[] = [{ hostname: "shop.example", isPrimary: true, kind: "custom" }];
    const { resolver: r, calls } = resolver(rows, { now: () => now });
    await r.storeUrlOf("m");
    await r.storeUrlOf("m");
    expect(calls).toHaveLength(1);
    await r.storeUrlOf("other");
    expect(calls).toHaveLength(2);
    now = new Date("2026-11-28T10:06:00.000Z");
    await r.storeUrlOf("m");
    expect(calls).toHaveLength(3);

    const failing = resolver(new Error("connection refused"));
    await expect(failing.resolver.storeUrlOf("m")).rejects.toThrow("connection refused");
    await expect(failing.resolver.storeUrlOf("m")).rejects.toThrow("connection refused");
    expect(failing.calls).toHaveLength(2);
  });
});
