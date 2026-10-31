import {
  normalizeLocalizedText,
  type ContentIssue,
  type LocalizedText,
} from "@platform/storefront-content";
import { err, ok, type Result } from "@platform/types";
import { ValidationError, type DomainError } from "@platform/utils";
import { invalidContent, versionConflict } from "../domain/errors";
import { AccessChanged } from "../domain/events";
import {
  parsePasswordInput,
  VISITOR_MESSAGE_MAX,
  type StorefrontAccess,
} from "../domain/storefront-access";
import type { OnlineStoreDeps } from "./deps";
import { eventProps, inUnitOfWork, iso } from "./guarded";

export interface AccessStatusView {
  readonly locked: boolean;
  readonly passwordSet: boolean;
  readonly passwordUpdatedAt: string | null;
  readonly message: LocalizedText;
  readonly version: number;
}

export interface PublicAccessView {
  readonly locked: boolean;
  readonly accessVersion: number;
  readonly message: LocalizedText;
}

export interface UpdateAccessInput {
  readonly locked: boolean;
  readonly password?: string | null;
  readonly message: unknown;
  readonly expectedVersion: number;
  readonly tenantId: string;
}

/** The only shape the admin sees: never the hash, never the password (spec 1.5). */
function statusOf(access: StorefrontAccess, version: number): AccessStatusView {
  const s = access.snapshot();
  return {
    locked: s.locked,
    passwordSet: s.passwordHash !== null,
    passwordUpdatedAt: iso(s.passwordUpdatedAt),
    message: s.message,
    version,
  };
}

export class GetAccessStatus {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly tenantId: string;
  }): Promise<Result<AccessStatusView, DomainError>> {
    const access = await this.deps.access.get(input.tenantId);
    return ok(statusOf(access, access.snapshot().version));
  }
}

export class UpdateAccess {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: UpdateAccessInput): Promise<Result<AccessStatusView, DomainError>> {
    const password = parsePasswordInput(input.password);
    if (password.kind === "invalid") {
      return err(
        new ValidationError("PASSWORD_LENGTH: Use 4 to 100 characters.", [
          { field: "password", message: "PASSWORD_LENGTH" },
        ]),
      );
    }
    const issues: ContentIssue[] = [];
    const message = normalizeLocalizedText(
      input.message,
      { path: "message", max: VISITOR_MESSAGE_MAX, multiline: true },
      issues,
    );
    if (issues.length > 0) return err(invalidContent(issues));
    // Ruling 10: scrypt runs BEFORE the transaction opens.
    const newPasswordHash =
      password.kind === "set" ? await this.deps.passwordHasher.hash(password.password) : null;
    return inUnitOfWork(this.deps, async (tx) => {
      const access = await this.deps.access.get(input.tenantId, tx);
      if (access.snapshot().version !== input.expectedVersion) return err(versionConflict());
      const version = access.nextVersion;
      const applied = access.apply({
        locked: input.locked,
        newPasswordHash,
        message,
        now: this.deps.clock.now(),
      });
      if (!applied.ok) return applied; // nothing written yet
      await this.deps.access.save(access, input.tenantId, tx);
      await this.deps.events.record(
        [new AccessChanged(eventProps(this.deps, input.tenantId), { locked: input.locked })],
        input.tenantId,
        tx,
      );
      return ok(statusOf(access, version));
    });
  }
}

export class GetPublicAccess {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: { readonly tenantId: string }): Promise<PublicAccessView> {
    const s = (await this.deps.access.get(input.tenantId)).snapshot();
    return { locked: s.locked, accessVersion: s.accessVersion, message: s.message };
  }
}

/**
 * Ruling 11: wrong password, no lock and no hash all cost one scrypt verify (a dummy hash minted
 * once per process with the same hasher), and all answer the same "incorrect".
 */
export class VerifyStorefrontPassword {
  private dummyHash: Promise<string> | undefined;
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly password: string;
    readonly tenantId: string;
  }): Promise<{ readonly ok: true; readonly accessVersion: number } | { readonly ok: false }> {
    const s = (await this.deps.access.get(input.tenantId)).snapshot();
    this.dummyHash ??= this.deps.passwordHasher.hash("morbeh-unlock-dummy");
    const hash = s.passwordHash ?? (await this.dummyHash);
    const matches = await this.deps.passwordHasher.verify(input.password.trim(), hash);
    if (matches && s.locked && s.passwordHash !== null)
      return { ok: true, accessVersion: s.accessVersion };
    return { ok: false };
  }
}
