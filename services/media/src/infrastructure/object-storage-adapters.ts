import type { StorageService } from "@platform/storage";
import type { ObjectStoragePort } from "../application/object-storage.port";

/** Offline in-memory stub — always reports objects as existing. Production swaps this for `StorageServiceObjectStorage`. */
export class InMemoryObjectStorage implements ObjectStoragePort {
  async exists(): Promise<boolean> {
    return true;
  }

  async getDownloadUrl(storageKey: string): Promise<string> {
    return `https://storage.local/${storageKey}`;
  }
}

/**
 * Production adapter onto `@platform/storage` (M2-2) — reuses the already-complete S3-compatible
 * `StorageService` (scoped to the `media` bucket by whoever constructs it), never duplicates the
 * client itself. Delegates both `ObjectStoragePort` methods straight through: `exists` to a real
 * `HeadObject` check, `getDownloadUrl` to a real time-bounded signed `GetObject` URL.
 */
export class StorageServiceObjectStorage implements ObjectStoragePort {
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
}
