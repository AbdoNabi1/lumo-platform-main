import type { AdPlatform, Connection } from "./connection";

/** Persistence port for ad platform connections. One row per (tenant, platform). */
export interface ConnectionRepository {
  list(tenantId: string): Promise<readonly Connection[]>;
  get(tenantId: string, platform: AdPlatform): Promise<Connection | null>;
  /** Insert when absent (expectedVersion null) or optimistic update (stored version === expectedVersion); false on conflict. */
  save(tenantId: string, connection: Connection, expectedVersion: number | null): Promise<boolean>;
}
