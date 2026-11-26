import type { UseCase } from "@platform/application";
import type { Clock } from "@platform/contracts";
import { err, ok, type Result } from "@platform/types";
import {
  ConcurrencyError,
  ConflictError,
  NotFoundError,
  ValidationError,
  type DomainError,
} from "@platform/utils";
import {
  connectionState,
  sanitizeProviderMessage,
  secretLast4,
  validateEmailConnectionDraft,
  type ConnectionState,
  type EmailConnectionKind,
  type EmailConnectionStatus,
  type StoredEmailConnection,
} from "../domain/messaging/email-connection";
import type {
  EmailConnectionRepository,
  EmailConnectionWrite,
} from "../domain/messaging/messaging-repositories";
import { SETTINGS_STALE_MESSAGE } from "../domain/messaging/notification-settings";
import { formatFrom } from "../domain/messaging/sender-resolution";
import { EmailConnectionUnavailableError } from "./email-connection-errors";
import type {
  EmailConnectionVault,
  StoreEmailMessage,
  StoreEmailProvider,
} from "./email-connection-ports";
import type { StoreProfilePort } from "./messaging-ports";
import { PROVIDER_UNREACHABLE_MESSAGE } from "./store-email-delivery";

export interface EmailConnectionDeps {
  readonly connections: EmailConnectionRepository;
  readonly store: StoreProfilePort;
  readonly clock: Clock;
  /** Absent (no KEK outside local): saving answers 503 NOT_CONFIGURED "Not available yet". */
  readonly vault?: EmailConnectionVault;
  readonly provider?: StoreEmailProvider;
}

/** What the page shows. Never the key, never the sealed blob: only the last four characters. */
export interface EmailConnectionView {
  readonly kind: EmailConnectionKind;
  readonly fromEmail: string;
  readonly secretLast4: string;
  readonly enabled: boolean;
  readonly status: EmailConnectionStatus;
  /** none | disabled | failed | connected: what "Customer emails" can honestly say. */
  readonly state: ConnectionState;
  readonly lastError: string | null;
  readonly lastErrorAt: string | null;
  readonly verifiedAt: string | null;
  readonly version: number;
}

export interface EmailConnectionOutput {
  /** The server can seal and use email credentials (a KEK and a provider are configured). */
  readonly credentialsConfigured: boolean;
  /** null while the store has not connected an email account. */
  readonly connection: EmailConnectionView | null;
}

function toView(connection: StoredEmailConnection): EmailConnectionView {
  return {
    kind: connection.kind,
    fromEmail: connection.fromEmail,
    secretLast4: connection.secretLast4,
    enabled: connection.enabled,
    status: connection.status,
    state: connectionState(connection),
    lastError: connection.lastError,
    lastErrorAt: connection.lastErrorAt?.toISOString() ?? null,
    verifiedAt: connection.verifiedAt?.toISOString() ?? null,
    version: connection.version,
  };
}

function output(
  deps: EmailConnectionDeps,
  row: StoredEmailConnection | null,
): EmailConnectionOutput {
  return {
    credentialsConfigured: deps.vault !== undefined && deps.provider !== undefined,
    connection: row === null ? null : toView(row),
  };
}

function toWrite(connection: StoredEmailConnection): EmailConnectionWrite {
  return {
    kind: connection.kind,
    fromEmail: connection.fromEmail,
    sealedCredentials: connection.sealedCredentials,
    secretLast4: connection.secretLast4,
    enabled: connection.enabled,
    status: connection.status,
    lastError: connection.lastError,
    lastErrorAt: connection.lastErrorAt,
    verifiedAt: connection.verifiedAt,
  };
}

const NO_ADDRESS = new ValidationError("We can't find an email address for your account", [
  { field: "actor", message: "no email address" },
]);

type TestOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * Sends one test mail to the acting staff member through the merchant's own account (D49). The key
 * only ever exists in memory here. A provider that throws is a failed test, never an exception that
 * could carry the key.
 */
async function testSend(
  deps: EmailConnectionDeps,
  provider: StoreEmailProvider,
  input: {
    readonly tenantId: string;
    readonly kind: EmailConnectionKind;
    readonly apiKey: string;
    readonly fromEmail: string;
    readonly to: string;
  },
): Promise<TestOutcome> {
  const profile = await deps.store.get(input.tenantId);
  const message: StoreEmailMessage = {
    to: input.to,
    subject: `Test email from ${profile.storeName === "" ? "your store" : profile.storeName}`,
    text:
      "This is a test email from your store's email account. If you can read it, your customers " +
      "will receive their order emails from this address.\n\n" +
      "هذه رسالة تجريبية من حساب البريد الإلكتروني الخاص بمتجرك.",
    html:
      "<p>This is a test email from your store's email account. If you can read it, your " +
      "customers will receive their order emails from this address.</p>" +
      '<p dir="rtl">هذه رسالة تجريبية من حساب البريد الإلكتروني الخاص بمتجرك.</p>',
    from: formatFrom(profile.storeName, input.fromEmail),
  };
  try {
    const result = await provider.send({ kind: input.kind, apiKey: input.apiKey }, message);
    if (result.ok) return { ok: true };
    return {
      ok: false,
      message: sanitizeProviderMessage(result.message, PROVIDER_UNREACHABLE_MESSAGE, [
        input.apiKey,
      ]),
    };
  } catch {
    return { ok: false, message: PROVIDER_UNREACHABLE_MESSAGE };
  }
}

export interface GetEmailConnectionInput {
  readonly tenantId: string;
}

export class GetEmailConnection implements UseCase<
  GetEmailConnectionInput,
  EmailConnectionOutput,
  DomainError
> {
  private readonly deps: EmailConnectionDeps;

  constructor(deps: EmailConnectionDeps) {
    this.deps = deps;
  }

  async execute(
    input: GetEmailConnectionInput,
  ): Promise<Result<EmailConnectionOutput, DomainError>> {
    return ok(output(this.deps, await this.deps.connections.find(input.tenantId)));
  }
}

export interface SaveEmailConnectionInput {
  readonly tenantId: string;
  /** The version the page loaded; null when it loaded "not connected". */
  readonly expectedVersion: number | null;
  readonly kind: unknown;
  readonly fromEmail: unknown;
  /** Write-only. Absent/empty keeps the stored key (only when the store already has one). */
  readonly apiKey: unknown;
  /** The signed-in staff member's own address, resolved server-side: where the test mail goes. */
  readonly actorEmail: string | null;
}

/**
 * Connects (or reconnects) the store's own email account: validates, seals the key, sends a test
 * mail to the acting staff member through it, and saves with status `connected` ONLY when that
 * succeeded, else `failed` with the provider's sanitized message (D49). A refused test is a saved
 * `failed` connection (200), not an error: the page shows why.
 */
export class SaveEmailConnection implements UseCase<
  SaveEmailConnectionInput,
  EmailConnectionOutput,
  DomainError
> {
  private readonly deps: EmailConnectionDeps;

  constructor(deps: EmailConnectionDeps) {
    this.deps = deps;
  }

  async execute(
    input: SaveEmailConnectionInput,
  ): Promise<Result<EmailConnectionOutput, DomainError>> {
    const { vault, provider } = this.deps;
    if (vault === undefined || provider === undefined) {
      return err(new EmailConnectionUnavailableError());
    }
    const draft = validateEmailConnectionDraft(input);
    if (!draft.ok) return err(draft.error);
    const existing = await this.deps.connections.find(input.tenantId);
    if ((existing?.version ?? null) !== input.expectedVersion) {
      return err(new ConflictError(SETTINGS_STALE_MESSAGE));
    }
    if (input.actorEmail === null || input.actorEmail === "") return err(NO_ADDRESS);

    const { kind, fromEmail } = draft.value;
    let apiKey = draft.value.apiKey;
    let sealed: string;
    let last4: string;
    if (apiKey !== null) {
      sealed = await vault.seal(input.tenantId, kind, { apiKey });
      last4 = secretLast4(apiKey);
    } else {
      // Keeping the stored key: only possible when there is one of the same kind that still opens.
      let stored: string | undefined;
      if (existing !== null && existing.kind === kind) {
        try {
          stored = (await vault.open(input.tenantId, kind, existing.sealedCredentials))["apiKey"];
        } catch {
          stored = undefined;
        }
      }
      if (stored === undefined || stored === "" || existing === null) {
        return err(
          new ValidationError("Enter your API key", [
            { field: "apiKey", message: "must not be empty" },
          ]),
        );
      }
      apiKey = stored;
      sealed = existing.sealedCredentials;
      last4 = existing.secretLast4;
    }

    const now = this.deps.clock.now();
    const tested = await testSend(this.deps, provider, {
      tenantId: input.tenantId,
      kind,
      apiKey,
      fromEmail,
      to: input.actorEmail,
    });
    const row: EmailConnectionWrite = {
      kind,
      fromEmail,
      sealedCredentials: sealed,
      secretLast4: last4,
      enabled: existing?.enabled ?? true,
      status: tested.ok ? "connected" : "failed",
      lastError: tested.ok ? null : tested.message,
      lastErrorAt: tested.ok ? null : now,
      verifiedAt: tested.ok ? now : null,
    };
    try {
      await this.deps.connections.save(input.tenantId, row, input.expectedVersion);
    } catch (error) {
      if (error instanceof ConcurrencyError) return err(new ConflictError(SETTINGS_STALE_MESSAGE));
      throw error;
    }
    return ok(output(this.deps, await this.deps.connections.find(input.tenantId)));
  }
}

export interface SetEmailConnectionEnabledInput {
  readonly tenantId: string;
  readonly expectedVersion: number;
  readonly enabled: boolean;
}

/** The on/off switch. Switching on does not re-test: status stays what the last test said. */
export class SetEmailConnectionEnabled implements UseCase<
  SetEmailConnectionEnabledInput,
  EmailConnectionOutput,
  DomainError
> {
  private readonly deps: EmailConnectionDeps;

  constructor(deps: EmailConnectionDeps) {
    this.deps = deps;
  }

  async execute(
    input: SetEmailConnectionEnabledInput,
  ): Promise<Result<EmailConnectionOutput, DomainError>> {
    const existing = await this.deps.connections.find(input.tenantId);
    if (existing === null) return err(new NotFoundError("No email account is connected"));
    if (existing.version !== input.expectedVersion) {
      return err(new ConflictError(SETTINGS_STALE_MESSAGE));
    }
    try {
      await this.deps.connections.save(
        input.tenantId,
        { ...toWrite(existing), enabled: input.enabled },
        input.expectedVersion,
      );
    } catch (error) {
      if (error instanceof ConcurrencyError) return err(new ConflictError(SETTINGS_STALE_MESSAGE));
      throw error;
    }
    return ok(output(this.deps, await this.deps.connections.find(input.tenantId)));
  }
}

/** Disconnects: the row, and with it the sealed key, is deleted. Disconnecting nothing is fine. */
export class DeleteEmailConnection implements UseCase<
  GetEmailConnectionInput,
  EmailConnectionOutput,
  DomainError
> {
  private readonly deps: EmailConnectionDeps;

  constructor(deps: EmailConnectionDeps) {
    this.deps = deps;
  }

  async execute(
    input: GetEmailConnectionInput,
  ): Promise<Result<EmailConnectionOutput, DomainError>> {
    await this.deps.connections.remove(input.tenantId);
    return ok(output(this.deps, null));
  }
}

export interface TestEmailConnectionInput {
  readonly tenantId: string;
  readonly actorEmail: string | null;
}

/** "Send test": the same test mail as saving, through the stored key; updates status and the last error. */
export class TestEmailConnection implements UseCase<
  TestEmailConnectionInput,
  EmailConnectionOutput,
  DomainError
> {
  private readonly deps: EmailConnectionDeps;

  constructor(deps: EmailConnectionDeps) {
    this.deps = deps;
  }

  async execute(
    input: TestEmailConnectionInput,
  ): Promise<Result<EmailConnectionOutput, DomainError>> {
    const { vault, provider } = this.deps;
    if (vault === undefined || provider === undefined) {
      return err(new EmailConnectionUnavailableError());
    }
    const existing = await this.deps.connections.find(input.tenantId);
    if (existing === null) return err(new NotFoundError("No email account is connected"));
    if (input.actorEmail === null || input.actorEmail === "") return err(NO_ADDRESS);

    let apiKey: string | undefined;
    try {
      apiKey = (await vault.open(input.tenantId, existing.kind, existing.sealedCredentials))[
        "apiKey"
      ];
    } catch {
      apiKey = undefined;
    }
    const now = this.deps.clock.now();
    const tested: TestOutcome =
      apiKey === undefined || apiKey === ""
        ? {
            ok: false,
            message: "The saved email key can't be used any more. Enter your API key again.",
          }
        : await testSend(this.deps, provider, {
            tenantId: input.tenantId,
            kind: existing.kind,
            apiKey,
            fromEmail: existing.fromEmail,
            to: input.actorEmail,
          });
    try {
      await this.deps.connections.save(
        input.tenantId,
        {
          ...toWrite(existing),
          status: tested.ok ? "connected" : "failed",
          lastError: tested.ok ? null : tested.message,
          lastErrorAt: tested.ok ? null : now,
          verifiedAt: tested.ok ? now : null,
        },
        existing.version,
      );
    } catch (error) {
      if (error instanceof ConcurrencyError) return err(new ConflictError(SETTINGS_STALE_MESSAGE));
      throw error;
    }
    return ok(output(this.deps, await this.deps.connections.find(input.tenantId)));
  }
}
