import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { MediaAsset } from "../domain/media-asset";
import { InMemoryMediaAssetRepository } from "../infrastructure/in-memory-library-repositories";
import { InMemoryFolderRepository } from "../infrastructure/in-memory-library-repositories";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { MediaLibraryEventTranslator } from "../infrastructure/media-library-event-translator";
import { TenantPrefixedKeyPolicy } from "../infrastructure/tenant-prefixed-key-policy";
import { GetDownloadUrl, RegisterMediaAsset } from "./media-library.use-cases";
import type { ObjectStoragePort } from "./object-storage.port";
import type { LegacyStorageKeys } from "./storage-key-ownership";

/**
 * G-68 / F-22 — the two doors, tested where the wiring cannot hide a missing check: straight against
 * the use cases, with a bucket that answers for ANY key (as a real shared bucket does).
 */
const clock: Clock = { now: () => new Date("2026-09-20T00:00:00.000Z") };
const ids = (): IdGenerator => {
  let n = 0;
  return { generate: () => `id-${(n += 1)}` };
};

const B_KEY = "tenants/tenant-b/product-images/2026/09/secret.png";
const A_KEY = "tenants/tenant-a/product-images/2026/09/mine.png";

function harness() {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new MediaLibraryEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "media",
  });
  const context = rootEventContext(ids());
  const mediaAssets = new InMemoryMediaAssetRepository({ outbox, context });
  const folders = new InMemoryFolderRepository({ outbox, context });
  const probed: string[] = [];
  const objectStorage: ObjectStoragePort = {
    exists: async (key) => (probed.push(key), true),
    getDownloadUrl: async (key) => `https://signed.example/${key}`,
  };
  const deps = {
    folders,
    mediaAssets,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator: ids(),
    clock,
    objectStorage,
    keyPolicy: new TenantPrefixedKeyPolicy(),
  };
  /** A row written by any route other than registration (a pre-fix registration, a direct write). */
  const seedRow = async (tenantId: string, key: string, id = "row-1") => {
    await mediaAssets.save(
      MediaAsset.create(UniqueEntityId.from(id), "seed.png", key, "evt-1", clock.now()),
      tenantId,
    );
    return id;
  };
  return { deps, probed, seedRow };
}

describe("registration door (G-68)", () => {
  it.each([
    ["another tenant's key", B_KEY],
    [
      "a traversal into another tenant",
      "tenants/tenant-a/../tenant-b/product-images/2026/09/x.png",
    ],
    ["an unprefixed legacy key", "media/hero.png"],
    [
      "a key with a foreign prefix that only looks close",
      "tenants/tenant-ab/product-images/2026/09/x.png",
    ],
  ])("refuses %s, and never probes the shared bucket with it", async (_label, key) => {
    const h = harness();
    const result = await new RegisterMediaAsset(h.deps).execute({
      name: "x.png",
      storageKey: key,
      tenantId: "tenant-a",
    });
    expect(result.ok).toBe(false);
    expect(h.probed).toEqual([]);
  });

  it("answers a foreign key and a malformed key identically (no ownership oracle)", async () => {
    const h = harness();
    const run = async (key: string) => {
      const r = await new RegisterMediaAsset(h.deps).execute({
        name: "x.png",
        storageKey: key,
        tenantId: "tenant-a",
      });
      return r.ok ? null : { name: r.error.constructor.name, message: r.error.message };
    };
    expect(await run(B_KEY)).toEqual(await run("garbage"));
  });

  it("accepts a key under the caller's own prefix", async () => {
    const h = harness();
    const result = await new RegisterMediaAsset(h.deps).execute({
      name: "mine.png",
      storageKey: A_KEY,
      tenantId: "tenant-a",
    });
    expect(result.ok).toBe(true);
    expect(h.probed).toEqual([A_KEY]);
  });
});

describe("signing door (G-68) — a row is not a laundering step", () => {
  const sign = async (
    h: ReturnType<typeof harness>,
    tenantId: string,
    id: string,
    legacy?: LegacyStorageKeys,
  ) =>
    new GetDownloadUrl({
      ...h.deps,
      ...(legacy === undefined ? {} : { legacyStorageKeys: legacy }),
    }).execute({
      mediaAssetId: id,
      tenantId,
    });

  it.each<LegacyStorageKeys | undefined>([undefined, "refuse", "allow"])(
    "never signs a row holding another tenant's key (legacy policy: %s)",
    async (legacy) => {
      const h = harness();
      const id = await h.seedRow("tenant-a", B_KEY);
      const result = await sign(h, "tenant-a", id, legacy);
      expect(result.ok).toBe(false);
    },
  );

  it("never lets the legacy allowance cover the tenant-prefixed namespace", async () => {
    const h = harness();
    const id = await h.seedRow(
      "tenant-a",
      "tenants/tenant-a/../tenant-b/product-images/2026/09/x.png",
    );
    expect((await sign(h, "tenant-a", id, "allow")).ok).toBe(false);
  });

  it("signs a row holding the caller's own key", async () => {
    const h = harness();
    const id = await h.seedRow("tenant-a", A_KEY);
    expect((await sign(h, "tenant-a", id)).ok).toBe(true);
  });

  it("refuses an unprefixed legacy row by default — fail closed", async () => {
    const h = harness();
    const id = await h.seedRow("tenant-a", "media/hero.png");
    expect((await sign(h, "tenant-a", id)).ok).toBe(false);
    expect((await sign(h, "tenant-a", id, "refuse")).ok).toBe(false);
  });

  it("signs an unprefixed legacy row only under the explicit allowance", async () => {
    const h = harness();
    const id = await h.seedRow("tenant-a", "media/hero.png");
    const result = await sign(h, "tenant-a", id, "allow");
    expect(result.ok).toBe(true);
  });
});
