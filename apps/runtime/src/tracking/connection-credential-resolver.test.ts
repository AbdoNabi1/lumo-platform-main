import { connectionsForDelivery, wireAdPlatforms } from "@platform/ad-platforms";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectionCredentialResolver } from "./connection-credential-resolver";

beforeEach(() => {
  expect.hasAssertions();
});

const SECRET = "EAAB1234567890abcdRESOLVERTOKEN";

function realConnections() {
  // The in-memory branch of the real ad platforms context (stub vault, allowed here): the same use cases the
  // runtime composes over Prisma, so what the resolver opens is what a saved connection really stores.
  const wired = wireAdPlatforms({
    clock: { now: () => new Date("2026-11-24T10:00:00.000Z") },
    idGenerator: { generate: () => "01930000-0000-7000-8000-000000000001" },
  });
  return { wired, connections: connectionsForDelivery(wired.internal) };
}

async function save(
  wired: ReturnType<typeof realConnections>["wired"],
  tenantId: string,
  enabled: boolean,
  expectedVersion: number,
) {
  const response = await wired.controller.save({
    tenantId,
    platform: "meta",
    enabled,
    publicConfig: { platform: "meta", pixelId: "123456789012345" },
    secret: SECRET,
    expectedVersion,
  });
  expect(response.status).toBe(200);
}

const fallback = () => ({
  resolve: vi.fn((_ref: string) => Promise.resolve("from-vault" as string | null)),
});

describe("ConnectionCredentialResolver", () => {
  it("opens conn://<tenant>/<platform> from the sealed connection", async () => {
    const { wired, connections } = realConnections();
    await save(wired, "t-1", true, 0);
    const base = fallback();
    const resolver = new ConnectionCredentialResolver({ connections, fallback: base });

    await expect(resolver.resolve("conn://t-1/meta")).resolves.toBe(SECRET);
    expect(base.resolve).not.toHaveBeenCalled();
  });

  it("returns null for a disabled connection, a missing one and another tenant's", async () => {
    const { wired, connections } = realConnections();
    await save(wired, "t-1", true, 0);
    const resolver = new ConnectionCredentialResolver({ connections, fallback: fallback() });

    await expect(resolver.resolve("conn://t-2/meta")).resolves.toBeNull();
    await expect(resolver.resolve("conn://t-1/tiktok")).resolves.toBeNull();

    await save(wired, "t-1", false, 1);
    await expect(resolver.resolve("conn://t-1/meta")).resolves.toBeNull();
  });

  it("delegates every other reference to the existing resolver", async () => {
    const base = fallback();
    const openSecret = vi.fn();
    const resolver = new ConnectionCredentialResolver({
      connections: { openSecret },
      fallback: base,
    });

    await expect(resolver.resolve("vault://tracking/meta/access_token")).resolves.toBe(
      "from-vault",
    );
    expect(base.resolve).toHaveBeenCalledWith("vault://tracking/meta/access_token");
    expect(openSecret).not.toHaveBeenCalled();
  });

  it.each([
    "conn://t-1/google_ads",
    "conn://t-1/meta/extra",
    "conn:///meta",
    "conn://t-1/",
    "xconn://t-1/meta",
  ])("does not treat %s as a connection reference", async (ref) => {
    const base = fallback();
    const openSecret = vi.fn();
    const resolver = new ConnectionCredentialResolver({
      connections: { openSecret },
      fallback: base,
    });

    await resolver.resolve(ref);

    expect(openSecret).not.toHaveBeenCalled();
    expect(base.resolve).toHaveBeenCalledWith(ref);
  });

  it("maps a failing connection read to an unresolved credential without echoing anything", async () => {
    const resolver = new ConnectionCredentialResolver({
      connections: { openSecret: () => Promise.reject(new Error(`vault says ${SECRET}`)) },
      fallback: fallback(),
    });

    await expect(resolver.resolve("conn://t-1/meta")).resolves.toBeNull();
  });

  it("treats an empty secret as unresolved", async () => {
    const resolver = new ConnectionCredentialResolver({
      connections: { openSecret: () => Promise.resolve("") },
      fallback: fallback(),
    });
    await expect(resolver.resolve("conn://t-1/meta")).resolves.toBeNull();
  });
});
