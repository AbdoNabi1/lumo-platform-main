import type { Clock } from "@platform/contracts";
import { isUsableConnection, sanitizeProviderMessage } from "../domain/messaging/email-connection";
import type { EmailConnectionRepository } from "../domain/messaging/messaging-repositories";
import { formatFrom } from "../domain/messaging/sender-resolution";
import type {
  EmailConnectionVault,
  StoreEmailFailureCode,
  StoreEmailProvider,
} from "./email-connection-ports";
import type { OutgoingMail, StoreMailSender } from "./messaging-ports";

/** What a delivery failure records: the connection is unusable, or the provider's own refusal. */
export type StoreEmailErrorCode = "EMAIL_NOT_CONNECTED" | StoreEmailFailureCode;

/** A fixed-code failure: the message IS the code, so nothing else can ever leak through it. */
export class StoreEmailError extends Error {
  readonly code: StoreEmailErrorCode;
  /** The provider's sanitized message, when there is one (the test mail shows it to the merchant). */
  readonly providerMessage: string | undefined;

  constructor(code: StoreEmailErrorCode, providerMessage?: string) {
    super(code);
    this.name = "StoreEmailError";
    this.code = code;
    this.providerMessage = providerMessage;
  }
}

export const KEY_UNREADABLE_MESSAGE =
  "The saved email key can't be used any more. Reconnect your email account.";
export const PROVIDER_UNREACHABLE_MESSAGE =
  "We couldn't reach your email provider. Try again in a moment.";

export interface StoreEmailDeliveryDeps {
  readonly connections: EmailConnectionRepository;
  /** Absent (no KEK): nothing can be opened, so nothing is sent. */
  readonly vault?: EmailConnectionVault;
  readonly provider?: StoreEmailProvider;
  readonly clock: Clock;
}

/**
 * Wave 2b2 (D45/D46): the ONLY way a store's mail leaves the platform. It resolves the store's own
 * email connection per call, opens its key, and sends through the merchant's provider account. There
 * is no other path and no fallback: no connection, a switched-off one, a failed one, an unopenable
 * key, or a refusing provider means the mail is not sent and the caller gets a `StoreEmailError` whose
 * message is a fixed code. Every real failure also updates the connection's `last_error` with a
 * sanitized message (no address, body or key).
 */
export class StoreEmailDelivery implements StoreMailSender {
  private readonly deps: StoreEmailDeliveryDeps;

  constructor(deps: StoreEmailDeliveryDeps) {
    this.deps = deps;
  }

  async isConnected(tenantId: string): Promise<boolean> {
    if (this.deps.vault === undefined || this.deps.provider === undefined) return false;
    return isUsableConnection(await this.deps.connections.find(tenantId));
  }

  async send(tenantId: string, storeName: string, mail: OutgoingMail): Promise<void> {
    const { vault, provider, connections } = this.deps;
    const connection = await connections.find(tenantId);
    if (vault === undefined || provider === undefined || !isUsableConnection(connection)) {
      throw new StoreEmailError("EMAIL_NOT_CONNECTED");
    }

    let apiKey: string | undefined;
    try {
      apiKey = (await vault.open(tenantId, connection.kind, connection.sealedCredentials))[
        "apiKey"
      ];
    } catch {
      apiKey = undefined;
    }
    if (apiKey === undefined || apiKey === "") {
      await this.recordFailure(tenantId, KEY_UNREADABLE_MESSAGE);
      throw new StoreEmailError("EMAIL_NOT_CONNECTED");
    }

    let result;
    try {
      result = await provider.send(
        { kind: connection.kind, apiKey },
        {
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          from: formatFrom(storeName, connection.fromEmail),
          ...(mail.idempotencyKey === undefined ? {} : { idempotencyKey: mail.idempotencyKey }),
        },
      );
    } catch {
      // An adapter defect: whatever it threw may carry the key or an address, so none of it is kept.
      result = {
        ok: false as const,
        code: "EMAIL_PROVIDER_UNAVAILABLE" as const,
        message: PROVIDER_UNREACHABLE_MESSAGE,
      };
    }
    if (result.ok) return;
    const message = sanitizeProviderMessage(result.message, PROVIDER_UNREACHABLE_MESSAGE, [apiKey]);
    await this.recordFailure(tenantId, message);
    throw new StoreEmailError(result.code, message);
  }

  /** Best effort: a failure to note the failure never replaces the failure being reported. */
  private async recordFailure(tenantId: string, message: string): Promise<void> {
    try {
      await this.deps.connections.recordFailure(tenantId, message, this.deps.clock.now());
    } catch {
      // Nothing more to do: the caller still gets the failure code.
    }
  }
}
