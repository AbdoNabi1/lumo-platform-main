/** Outbound seam onto `@platform/storage` — Media Library verifies existence + issues download URLs, and (Plan 2C-3) writes product images. */
export interface ObjectStoragePort {
  /**
   * Whether bytes written here are really kept. `false` for the in-memory stub: it must never
   * pretend to store, so uploads are refused (503) while it is the resolved adapter.
   */
  readonly persistent: boolean;
  exists(storageKey: string): Promise<boolean>;
  getDownloadUrl(storageKey: string): Promise<string>;
  /** Writes `bytes` at `storageKey` with the given content type and `Cache-Control` header. */
  put(
    storageKey: string,
    bytes: Uint8Array,
    contentType: string,
    cacheControl: string,
  ): Promise<void>;
}
