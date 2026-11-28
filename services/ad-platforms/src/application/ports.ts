import type { AdPlatform } from "../domain/connection";

/** Seals/opens a merchant's platform secret. `stub` is NOT encryption (in-memory/dev only). */
export interface CredentialVaultPort {
  readonly backing: "real" | "stub";
  seal(tenantId: string, platform: AdPlatform, secret: string): Promise<string>;
  open(tenantId: string, platform: AdPlatform, sealed: string): Promise<string>;
}

/** Re-syncs the shop's delivery destinations after a connection changes (Task 4 provides it; absent → no-op). */
export interface DeliverySyncPort {
  sync(tenantId: string): Promise<void>;
}

/** `require_real_vault` refuses to store a secret through a stub vault. */
export type CredentialPolicy = "require_real_vault" | "allow_stub";
