/** Outbound port for signup-token generation (G-72, D3). */
export interface TokenPort {
  /** ≥32 CSPRNG bytes, hex-encoded — the value emailed to the user, never persisted. */
  generateRaw(): string;
  /** SHA-256 hex digest — the only form ever persisted (D3). */
  hash(raw: string): string;
}
