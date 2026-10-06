import type {
  PasswordCredentialRecord,
  PasswordCredentialStore,
} from "../application/password-credentials";

/** Plan 1B-1: reference store for tests and local dev. Survives nothing — the Prisma store does. */
export class InMemoryPasswordCredentialStore implements PasswordCredentialStore {
  private readonly rows = new Map<string, PasswordCredentialRecord>();

  private static key(tenantId: string, identifier: string): string {
    return `${tenantId}\u0000${identifier}`;
  }

  async find(tenantId: string, identifier: string): Promise<PasswordCredentialRecord | null> {
    return this.rows.get(InMemoryPasswordCredentialStore.key(tenantId, identifier)) ?? null;
  }

  async upsert(input: {
    readonly tenantId: string;
    readonly identifier: string;
    readonly principalExternalId: string;
    readonly passwordHash: string;
  }): Promise<void> {
    this.rows.set(InMemoryPasswordCredentialStore.key(input.tenantId, input.identifier), {
      ...input,
      failedAttempts: 0,
      lockedUntil: null,
    });
  }

  async incrementFailures(tenantId: string, identifier: string): Promise<number> {
    const key = InMemoryPasswordCredentialStore.key(tenantId, identifier);
    const row = this.rows.get(key);
    if (row === undefined) return 0;
    const next = { ...row, failedAttempts: row.failedAttempts + 1 };
    this.rows.set(key, next);
    return next.failedAttempts;
  }

  async lockUntil(tenantId: string, identifier: string, until: Date): Promise<void> {
    const key = InMemoryPasswordCredentialStore.key(tenantId, identifier);
    const row = this.rows.get(key);
    if (row !== undefined) this.rows.set(key, { ...row, lockedUntil: until });
  }

  async recordSuccess(tenantId: string, identifier: string, rehash?: string): Promise<void> {
    const key = InMemoryPasswordCredentialStore.key(tenantId, identifier);
    const row = this.rows.get(key);
    if (row === undefined) return;
    this.rows.set(key, {
      ...row,
      failedAttempts: 0,
      lockedUntil: null,
      ...(rehash === undefined ? {} : { passwordHash: rehash }),
    });
  }
}
