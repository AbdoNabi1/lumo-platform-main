import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireMediaLibrary } from "./media-library.composition";
import type { ObjectStoragePort } from "./application/object-storage.port";

/**
 * G-68 (T10.5 case 4, gap F-22) — "a storage key written by A is unreachable from B". CLOSED.
 *
 * The bucket is ONE namespace shared by every tenant (tenants are key PREFIXES, never buckets), so
 * isolation must come from the application refusing a key outside the caller's prefix. Before the fix
 * it did not: `RegisterMediaAsset` only checked that the key exists, and `GetDownloadUrl` signed
 * whatever the asset row held. Both doors now check the key against the caller's tenant
 * (`storageKeyBelongsToTenant`, `@platform/storage`, the exact inverse of `StorageKeyFactory`). The
 * two attack cases below were `it.fails()` while the gap was open and are plain `it()` now.
 */
const clock: Clock = { now: () => new Date("2026-09-20T00:00:00.000Z") };
const ids = (): IdGenerator => {
  let n = 0;
  return { generate: () => `id-${(n += 1)}` };
};
const B_KEY = "tenants/tenant-b/product-images/2026/09/secret.png";

/** A real bucket's behaviour: it knows nothing about tenants — it answers for any key that exists. */
const bucket: ObjectStoragePort = {
  exists: async (key) => key === B_KEY || key.startsWith("tenants/tenant-a/"),
  getDownloadUrl: async (key) => `https://signed.example/${key}?sig=1`,
};

function wire() {
  return wireMediaLibrary({
    serializer: new InMemoryEventSerializer(),
    idGenerator: ids(),
    clock,
    objectStorage: bucket,
  });
}

describe("media storage keys vs tenant isolation (G-68, closed)", () => {
  it("control: A registers a key under its own prefix and gets a URL", async () => {
    const app = wire();
    const registered = await app.mediaLibrary.registerMediaAsset({
      name: "mine.png",
      storageKey: "tenants/tenant-a/product-images/2026/09/mine.png",
      tenantId: "tenant-a",
    });
    expect(registered.status).toBe(201);
    const id = (registered.body as { mediaAssetId: string }).mediaAssetId;
    const url = await app.mediaLibrary.getDownloadUrl({ mediaAssetId: id, tenantId: "tenant-a" });
    expect((url.body as { url?: string }).url).toContain("tenants/tenant-a/");
  });

  it("A cannot register B's object key as its own asset", async () => {
    const app = wire();
    const forged = await app.mediaLibrary.registerMediaAsset({
      name: "stolen.png",
      storageKey: B_KEY,
      tenantId: "tenant-a",
    });
    expect(forged.status).toBeGreaterThanOrEqual(400);
  });

  it("A cannot mint a signed download URL for B's object via a registered asset", async () => {
    const app = wire();
    const forged = await app.mediaLibrary.registerMediaAsset({
      name: "stolen.png",
      storageKey: B_KEY,
      tenantId: "tenant-a",
    });
    // A refusal at registration would satisfy the property; today it is 201, so we go on to sign.
    if (forged.status >= 400) return;
    const id = (forged.body as { mediaAssetId: string }).mediaAssetId;
    const url = await app.mediaLibrary.getDownloadUrl({ mediaAssetId: id, tenantId: "tenant-a" });
    expect((url.body as { url?: string }).url ?? "").not.toContain(B_KEY);
  });
});
