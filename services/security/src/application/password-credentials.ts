/** Plan 1B-1: one-way password hashing. Implementations never return or log the password. */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** False — never a throw — for a wrong password or a malformed stored value. */
  verify(password: string, stored: string): Promise<boolean>;
  /** True when `stored` was made with parameters other than this hasher's current ones. */
  needsRehash(stored: string): boolean;
}

/** Plan 1B-1: one stored password credential. Keyed by (tenantId, normalised identifier). */
export interface PasswordCredentialRecord {
  readonly tenantId: string;
  readonly identifier: string;
  readonly principalExternalId: string;
  readonly passwordHash: string;
  readonly failedAttempts: number;
  readonly lockedUntil: Date | null;
}

/** A credential's owner without any secret material — what listings may see. */
export interface PasswordCredentialOwner {
  readonly identifier: string;
  readonly principalExternalId: string;
}

export interface PasswordCredentialStore {
  find(tenantId: string, identifier: string): Promise<PasswordCredentialRecord | null>;
  /**
   * Wave 1d: the credentials of a tenant whose identifier starts with `prefix` (e.g. `"staff:"`),
   * ordered by identifier. Never returns hashes, failure counters or locks.
   */
  listByPrefix(tenantId: string, prefix: string): Promise<readonly PasswordCredentialOwner[]>;
  /** Plan 1C: the credential owned by this principal (change-password has the principal, not the email). */
  findByPrincipal(
    tenantId: string,
    principalExternalId: string,
  ): Promise<PasswordCredentialRecord | null>;
  /**
   * Insert or replace the hash and owner; resets failures and any lock. With `tx` (a unit-of-work
   * transaction handle) the Prisma store writes through that client instead of opening its own
   * transaction, so the credential commits atomically with the caller's other writes; the in-memory
   * store ignores it.
   */
  save(
    input: {
      readonly tenantId: string;
      readonly identifier: string;
      readonly principalExternalId: string;
      readonly passwordHash: string;
    },
    tx?: unknown,
  ): Promise<void>;
  /** Atomically adds one failure and returns the new count. */
  incrementFailures(tenantId: string, identifier: string): Promise<number>;
  lockUntil(tenantId: string, identifier: string, until: Date): Promise<void>;
  /** Resets failures and lock; replaces the hash when `rehash` is given. */
  recordSuccess(tenantId: string, identifier: string, rehash?: string): Promise<void>;
}

/** Plan 1B-1: sets a principal's password. The only write path for password credentials. */
export interface PasswordRegistrar {
  setPassword(input: {
    readonly tenantId: string;
    readonly identifier: string;
    readonly password: string;
    readonly principalExternalId: string;
  }): Promise<void>;
  /** Plan 1B-2: whether a credential exists for this identifier in this tenant (owner bootstrap idempotency). */
  hasCredential(tenantId: string, identifier: string): Promise<boolean>;
}

/** Login identifiers are emails: trimmed and lower-cased so "A@x.com " and "a@x.com" are one account. */
export function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}
