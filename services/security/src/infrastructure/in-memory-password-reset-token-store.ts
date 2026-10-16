import type {
  PasswordResetTokenRecord,
  PasswordResetTokenStore,
} from "../application/password-reset";

/** Plan 1C: reference store for tests and local dev. */
export class InMemoryPasswordResetTokenStore implements PasswordResetTokenStore {
  private readonly rows = new Map<string, PasswordResetTokenRecord>();

  save(record: Omit<PasswordResetTokenRecord, "usedAt">): Promise<void> {
    this.rows.set(`${record.tenantId}\u0000${record.tokenHash}`, { ...record, usedAt: null });
    return Promise.resolve();
  }

  consume(
    tenantId: string,
    tokenHash: string,
    now: Date,
  ): Promise<PasswordResetTokenRecord | null> {
    const key = `${tenantId}\u0000${tokenHash}`;
    const row = this.rows.get(key);
    if (row === undefined || row.usedAt !== null || row.expiresAt.getTime() <= now.getTime()) {
      return Promise.resolve(null);
    }
    const used = { ...row, usedAt: now };
    this.rows.set(key, used);
    return Promise.resolve(used);
  }

  /** Test inspection: what is stored (hashes only). */
  snapshot(): readonly PasswordResetTokenRecord[] {
    return [...this.rows.values()];
  }
}
