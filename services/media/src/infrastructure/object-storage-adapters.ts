import type { StorageService } from "@platform/storage";
import type { ObjectStoragePort } from "../application/object-storage.port";

/**
 * Offline in-memory stub — always reports objects as existing and keeps nothing. Production swaps
 * this for `StorageServiceObjectStorage`. It is `persistent: false`, so image uploads are refused
 * rather than silently dropped.
 */
export class InMemoryObjectStorage implements ObjectStoragePort {
  readonly persistent = false;

  async exists(): Promise<boolean> {
    return true;
  }

  async getDownloadUrl(storageKey: string): Promise<string> {
    return `https://storage.local/${storageKey}`;
  }

  put(): Promise<void> {
    return Promise.reject(new Error("InMemoryObjectStorage does not store bytes"));
  }
}

/**
 * Production adapter onto `@platform/storage` (M2-2) — reuses the already-complete S3-compatible
 * `StorageService` (scoped to the `media` bucket by whoever constructs it), never duplicates the
 * client itself. Delegates straight through: `exists` to a real `HeadObject` check,
 * `getDownloadUrl` to a real time-bounded signed `GetObject` URL, `put` to a real `PutObject`.
 */
export class StorageServiceObjectStorage implements ObjectStoragePort {
  readonly persistent = true;
  private readonly storageService: StorageService;

  constructor(storageService: StorageService) {
    this.storageService = storageService;
  }

  exists(storageKey: string): Promise<boolean> {
    return this.storageService.objectExists(storageKey);
  }

  getDownloadUrl(storageKey: string): Promise<string> {
    return this.storageService.getSignedDownloadUrl(storageKey);
  }

  put(
    storageKey: string,
    bytes: Uint8Array,
    contentType: string,
    cacheControl: string,
  ): Promise<void> {
    return this.storageService.putObject(storageKey, bytes, { contentType, cacheControl });
  }
}
