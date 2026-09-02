import { describe, expect, it } from "vitest";
import type { SignedUrlOptions, StorageService } from "@platform/storage";
import type { ObjectStoragePort } from "../application/object-storage.port";
import { InMemoryObjectStorage, StorageServiceObjectStorage } from "./object-storage-adapters";

/**
 * M2-2: `StorageServiceObjectStorage` previously threw "not wired in this environment yet" from
 * both methods unconditionally — the only implementation of `ObjectStoragePort` that could ever
 * back real usage was `InMemoryObjectStorage`, whose `exists()` always returns `true` and whose
 * `getDownloadUrl()` returns a URL template that has never pointed at real storage. Proves the
 * adapter now delegates both methods to a real `StorageService` instead.
 */

class FakeStorageService implements StorageService {
  readonly bucket = "media";
  existsCalls: string[] = [];
  downloadUrlCalls: string[] = [];
  private readonly present: Set<string>;

  constructor(present: readonly string[]) {
    this.present = new Set(present);
  }

  async getSignedUploadUrl(): Promise<string> {
    throw new Error("not exercised by this adapter");
  }

  async getSignedDownloadUrl(key: string, _options?: SignedUrlOptions): Promise<string> {
    this.downloadUrlCalls.push(key);
    return `https://minio.local/media/${key}?X-Amz-Signature=fake`;
  }

  async objectExists(key: string): Promise<boolean> {
    this.existsCalls.push(key);
    return this.present.has(key);
  }

  async ensureBucket(): Promise<void> {
    // not exercised by this adapter
  }
}

describe("StorageServiceObjectStorage (M2-2)", () => {
  it("delegates exists() to StorageService.objectExists() — a real HEAD check, not always-true", async () => {
    const storageService = new FakeStorageService(["hero.png"]);
    const adapter = new StorageServiceObjectStorage(storageService);

    expect(await adapter.exists("hero.png")).toBe(true);
    expect(await adapter.exists("missing.png")).toBe(false);
    expect(storageService.existsCalls).toEqual(["hero.png", "missing.png"]);
  });

  it("delegates getDownloadUrl() to StorageService.getSignedDownloadUrl() — a real signed URL, not a template", async () => {
    const storageService = new FakeStorageService(["hero.png"]);
    const adapter = new StorageServiceObjectStorage(storageService);

    const url = await adapter.getDownloadUrl("hero.png");
    expect(url).toBe("https://minio.local/media/hero.png?X-Amz-Signature=fake");
    expect(storageService.downloadUrlCalls).toEqual(["hero.png"]);
  });

  it("InMemoryObjectStorage still reports every object as existing — unchanged fallback behavior", async () => {
    const fallback: ObjectStoragePort = new InMemoryObjectStorage();
    expect(await fallback.exists("anything")).toBe(true);
    expect(await fallback.getDownloadUrl("anything")).toBe("https://storage.local/anything");
  });
});
