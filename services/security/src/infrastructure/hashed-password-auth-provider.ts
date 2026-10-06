import type { Clock } from "@platform/contracts";
import { ValidationError } from "@platform/utils";
import type {
  AuthenticationProviderPort,
  AuthenticationRequest,
  AuthenticationResult,
} from "../application/auth-ports";
import {
  normalizeIdentifier,
  type PasswordCredentialStore,
  type PasswordHasher,
  type PasswordRegistrar,
} from "../application/password-credentials";
import type { AuthMethodKind } from "../domain/value-objects/auth-method";

export interface HashedPasswordAuthProviderDeps {
  readonly store: PasswordCredentialStore;
  readonly hasher: PasswordHasher;
  readonly clock: Clock;
  readonly maxFailures?: number;
  readonly lockoutSeconds?: number;
}

const INVALID: AuthenticationResult = { ok: false, reason: "invalid credentials" };
// A fixed throwaway hash for unknown identifiers, so they cost the same scrypt time as a wrong password.
const DUMMY_PASSWORD = "unknown-identifier-timing-equaliser";

/**
 * Plan 1B-1: the production `"password"` provider — tenant-scoped, scrypt-hashed, lockout after
 * repeated failures. Replaces `InMemoryPasswordAuthProvider` wherever a database exists.
 */
export class HashedPasswordAuthProvider implements AuthenticationProviderPort, PasswordRegistrar {
  readonly method: AuthMethodKind = "password";
  private readonly deps: HashedPasswordAuthProviderDeps;
  private readonly maxFailures: number;
  private readonly lockoutMs: number;
  private dummyHash: Promise<string> | undefined;

  constructor(deps: HashedPasswordAuthProviderDeps) {
    this.deps = deps;
    this.maxFailures = deps.maxFailures ?? 10;
    this.lockoutMs = (deps.lockoutSeconds ?? 900) * 1000;
  }

  async setPassword(input: {
    readonly tenantId: string;
    readonly identifier: string;
    readonly password: string;
    readonly principalExternalId: string;
  }): Promise<void> {
    if (input.password.length < 8) {
      throw new ValidationError("Password must be at least 8 characters", [
        { field: "password", message: "must be 8 to 256 characters" },
      ]);
    }
    if (input.password.length > 256) {
      throw new ValidationError("Password must be at most 256 characters", [
        { field: "password", message: "must be 8 to 256 characters" },
      ]);
    }
    await this.deps.store.save({
      tenantId: input.tenantId,
      identifier: normalizeIdentifier(input.identifier),
      principalExternalId: input.principalExternalId,
      passwordHash: await this.deps.hasher.hash(input.password),
    });
  }

  async hasCredential(tenantId: string, identifier: string): Promise<boolean> {
    return (await this.deps.store.find(tenantId, normalizeIdentifier(identifier))) !== null;
  }

  async authenticate(request: AuthenticationRequest): Promise<AuthenticationResult> {
    const tenantId = request.tenantId;
    if (tenantId === undefined || tenantId === "") {
      return { ok: false, reason: "tenant scope required" };
    }
    const identifier = normalizeIdentifier(request.identifier);
    const password = request.credential ?? "";
    const record = await this.deps.store.find(tenantId, identifier);
    if (record === null) {
      await this.deps.hasher.verify(password, await this.dummy());
      return INVALID;
    }
    if (
      record.lockedUntil !== null &&
      record.lockedUntil.getTime() > this.deps.clock.now().getTime()
    ) {
      return { ok: false, reason: "credential temporarily locked" };
    }
    if (!(await this.deps.hasher.verify(password, record.passwordHash))) {
      const failures = await this.deps.store.incrementFailures(tenantId, identifier);
      if (failures >= this.maxFailures) {
        await this.deps.store.lockUntil(
          tenantId,
          identifier,
          new Date(this.deps.clock.now().getTime() + this.lockoutMs),
        );
      }
      return INVALID;
    }
    const rehash = this.deps.hasher.needsRehash(record.passwordHash)
      ? await this.deps.hasher.hash(password)
      : undefined;
    await this.deps.store.recordSuccess(tenantId, identifier, rehash);
    return { ok: true, principalExternalId: record.principalExternalId };
  }

  private dummy(): Promise<string> {
    this.dummyHash ??= this.deps.hasher.hash(DUMMY_PASSWORD);
    return this.dummyHash;
  }
}
