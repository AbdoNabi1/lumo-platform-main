import type { LocalizedText } from "@platform/storefront-content";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { passwordRequired } from "./errors";

export const VISITOR_MESSAGE_MAX = 500;
export const PASSWORD_MIN = 4;
export const PASSWORD_MAX = 100;

export interface AccessSnapshot {
  readonly locked: boolean;
  readonly passwordHash: string | null;
  readonly passwordUpdatedAt: Date | null;
  readonly message: LocalizedText;
  readonly accessVersion: number;
  readonly version: number;
  readonly updatedAt: Date | null;
  readonly persisted: boolean;
}

/** Ruling 10: omitted, null or blank keeps the current password; any script is allowed. */
export function parsePasswordInput(
  raw: string | null | undefined,
):
  | { readonly kind: "keep" }
  | { readonly kind: "set"; readonly password: string }
  | { readonly kind: "invalid" } {
  if (raw === undefined || raw === null) return { kind: "keep" };
  const password = raw.trim();
  if (password.length === 0) return { kind: "keep" };
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return { kind: "invalid" };
  return { kind: "set", password };
}

/** The storefront password lock (spec 1.5). The hash never leaves this aggregate's snapshot. */
export class StorefrontAccess {
  private state: AccessSnapshot;

  private constructor(state: AccessSnapshot) {
    this.state = state;
  }

  static defaults(): StorefrontAccess {
    return new StorefrontAccess({
      locked: false,
      passwordHash: null,
      passwordUpdatedAt: null,
      message: {},
      accessVersion: 1,
      version: 0,
      updatedAt: null,
      persisted: false,
    });
  }

  static reconstitute(snapshot: AccessSnapshot): StorefrontAccess {
    return new StorefrontAccess(snapshot);
  }

  /**
   * Validates first, mutates only on success. `accessVersion` bumps when the password changes and
   * when the store goes from unlocked to locked, which revokes every unlock cookie at once.
   */
  apply(input: {
    readonly locked: boolean;
    readonly newPasswordHash: string | null;
    readonly message: LocalizedText;
    readonly now: Date;
  }): Result<void, DomainError> {
    const hash = input.newPasswordHash ?? this.state.passwordHash;
    if (input.locked && hash === null) return err(passwordRequired());
    const passwordChanged = input.newPasswordHash !== null;
    const relocked = input.locked && !this.state.locked;
    this.state = {
      ...this.state,
      locked: input.locked,
      passwordHash: hash,
      passwordUpdatedAt: passwordChanged ? input.now : this.state.passwordUpdatedAt,
      message: input.message,
      accessVersion: this.state.accessVersion + (passwordChanged || relocked ? 1 : 0),
      updatedAt: input.now,
    };
    return ok(undefined);
  }

  snapshot(): AccessSnapshot {
    return this.state;
  }

  get nextVersion(): number {
    return this.state.persisted ? this.state.version + 1 : 1;
  }
}
