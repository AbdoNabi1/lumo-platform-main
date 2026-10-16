import { createHash, randomBytes } from "node:crypto";
import type { Clock } from "@platform/contracts";
import { ValidationError } from "@platform/utils";
import {
  normalizeIdentifier,
  type PasswordCredentialStore,
  type PasswordRegistrar,
} from "./password-credentials";

export interface PasswordResetTokenRecord {
  readonly tenantId: string;
  readonly tokenHash: string;
  readonly identifier: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
}

export interface PasswordResetTokenStore {
  save(record: Omit<PasswordResetTokenRecord, "usedAt">): Promise<void>;
  /** Atomically marks an unused, unexpired token used; null when there is none. */
  consume(tenantId: string, tokenHash: string, now: Date): Promise<PasswordResetTokenRecord | null>;
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface PasswordResetServiceDeps {
  readonly tokens: PasswordResetTokenStore;
  readonly credentials: PasswordCredentialStore;
  readonly registrar: PasswordRegistrar;
  readonly clock: Clock;
  readonly ttlSeconds?: number;
}

/**
 * Plan 1C: single-use, expiring password-reset tokens. Only SHA-256(token) is stored; the token
 * itself exists once, in the email link. Validation runs BEFORE the token is consumed, so a
 * rejected password does not burn the link.
 */
export class PasswordResetService {
  private readonly deps: PasswordResetServiceDeps;
  private readonly ttlMs: number;

  constructor(deps: PasswordResetServiceDeps) {
    this.deps = deps;
    this.ttlMs = (deps.ttlSeconds ?? 1800) * 1000;
  }

  /** null when no credential exists — the caller must still answer exactly as for a hit. */
  async request(tenantId: string, identifier: string): Promise<{ token: string } | null> {
    const normalised = normalizeIdentifier(identifier);
    const credential = await this.deps.credentials.find(tenantId, normalised);
    if (credential === null) return null;
    const token = randomBytes(32).toString("base64url");
    await this.deps.tokens.save({
      tenantId,
      tokenHash: hashResetToken(token),
      identifier: normalised,
      expiresAt: new Date(this.deps.clock.now().getTime() + this.ttlMs),
    });
    return { token };
  }

  async complete(tenantId: string, token: string, newPassword: string): Promise<boolean> {
    if (newPassword.length < 8 || newPassword.length > 256) {
      throw new ValidationError("Invalid password", [
        { field: "password", message: "must be at least 8 and at most 256 characters" },
      ]);
    }
    const record = await this.deps.tokens.consume(
      tenantId,
      hashResetToken(token),
      this.deps.clock.now(),
    );
    if (record === null) return false;
    const credential = await this.deps.credentials.find(tenantId, record.identifier);
    if (credential === null) return false;
    await this.deps.registrar.setPassword({
      tenantId,
      identifier: record.identifier,
      password: newPassword,
      principalExternalId: credential.principalExternalId,
    });
    return true;
  }
}
