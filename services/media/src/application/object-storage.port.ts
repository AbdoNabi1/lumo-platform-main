/** Outbound seam onto `@platform/storage` — Media Library verifies existence + issues download URLs, never stores files itself. */
export interface ObjectStoragePort {
  exists(storageKey: string): Promise<boolean>;
  getDownloadUrl(storageKey: string): Promise<string>;
}
