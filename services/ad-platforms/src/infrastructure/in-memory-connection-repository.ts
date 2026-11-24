import type { AdPlatform, Connection } from "../domain/connection";
import type { ConnectionRepository } from "../domain/connection-repository";

/** In-memory `ConnectionRepository`, keyed by `(tenantId, platform)` so a cross-tenant leak is visible to isolation tests. */
export class InMemoryConnectionRepository implements ConnectionRepository {
  private readonly store = new Map<string, Connection>();

  private static key(tenantId: string, platform: AdPlatform): string {
    return `${tenantId}\u0000${platform}`;
  }

  list(tenantId: string): Promise<readonly Connection[]> {
    const rows: Connection[] = [];
    for (const [key, connection] of this.store) {
      if (key.startsWith(`${tenantId}\u0000`)) rows.push(connection);
    }
    return Promise.resolve(rows);
  }

  get(tenantId: string, platform: AdPlatform): Promise<Connection | null> {
    return Promise.resolve(
      this.store.get(InMemoryConnectionRepository.key(tenantId, platform)) ?? null,
    );
  }

  save(tenantId: string, connection: Connection, expectedVersion: number | null): Promise<boolean> {
    const key = InMemoryConnectionRepository.key(tenantId, connection.props.platform);
    const stored = this.store.get(key);
    if (expectedVersion === null) {
      if (stored !== undefined) return Promise.resolve(false);
    } else if (stored === undefined || stored.props.version !== expectedVersion) {
      return Promise.resolve(false);
    }
    this.store.set(key, connection);
    return Promise.resolve(true);
  }
}
