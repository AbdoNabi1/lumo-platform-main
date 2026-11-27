import type {
  SmtpStoreEmailFailureCode,
  StoreEmailCredentials,
  StoreEmailMessage,
  StoreEmailProvider,
  StoreEmailResult,
} from "../application/email-connection-ports";
import type { SmtpErrorCode } from "../domain/messaging/email-connection";
import { sendSmtpMail, SmtpClientError, type SmtpClientOptions } from "./smtp-client";

/**
 * What a failed mailbox send records and shows. The `CODE: ` prefix is part of the contract: it is
 * how the admin API derives `lastErrorCode` and how the page picks its own (translated) sentence.
 * Nothing of the server's reply, the address or the password ever goes in here.
 */
const SMTP_MESSAGES: Readonly<Record<SmtpErrorCode, string>> = {
  AUTH_FAILED:
    "The mail server didn't accept the username or password. For Gmail, use an app password.",
  DAILY_LIMIT: "The mailbox reached its sending limit for now. Try again later.",
  CONNECTION_FAILED:
    "We couldn't reach the mail server. The server may block mail ports, or it may be down.",
  TLS_FAILED: "The mail server's secure connection could not be verified.",
  REJECTED: "The mail server refused this email.",
};

const STORE_CODES: Readonly<Record<SmtpErrorCode, SmtpStoreEmailFailureCode>> = {
  AUTH_FAILED: "EMAIL_AUTH_FAILED",
  DAILY_LIMIT: "EMAIL_DAILY_LIMIT",
  CONNECTION_FAILED: "EMAIL_CONNECTION_FAILED",
  TLS_FAILED: "EMAIL_TLS_FAILED",
  REJECTED: "EMAIL_REJECTED",
};

function failure(code: SmtpErrorCode): StoreEmailResult {
  return { ok: false, code: STORE_CODES[code], message: `${code}: ${SMTP_MESSAGES[code]}` };
}

/**
 * Wave 2b2 Task 3 (D52): sends through the MERCHANT's own mailbox over SMTP, with their app
 * password. It holds no platform credential and no fallback. Never throws for a refusal; whatever
 * the network throws is reduced to one of five fixed codes.
 */
export class SmtpStoreEmailProvider implements StoreEmailProvider {
  private readonly options: SmtpClientOptions;

  constructor(options: SmtpClientOptions = {}) {
    this.options = options;
  }

  async send(
    credentials: StoreEmailCredentials,
    message: StoreEmailMessage,
  ): Promise<StoreEmailResult> {
    if (credentials.kind !== "smtp" || credentials.smtp === undefined) return failure("REJECTED");
    try {
      await sendSmtpMail(
        { ...credentials.smtp, password: credentials.apiKey },
        {
          from: message.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          ...(message.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: message.idempotencyKey }),
        },
        this.options,
      );
      return { ok: true };
    } catch (error) {
      return failure(error instanceof SmtpClientError ? error.code : "CONNECTION_FAILED");
    }
  }
}

/**
 * Picks the provider by connection kind. A kind without a provider (SMTP while the server flag is
 * off) is a refusal, never a different account.
 */
export class RoutingStoreEmailProvider implements StoreEmailProvider {
  private readonly providers: Readonly<
    Partial<Record<StoreEmailCredentials["kind"], StoreEmailProvider>>
  >;

  constructor(
    providers: Readonly<Partial<Record<StoreEmailCredentials["kind"], StoreEmailProvider>>>,
  ) {
    this.providers = providers;
  }

  send(credentials: StoreEmailCredentials, message: StoreEmailMessage): Promise<StoreEmailResult> {
    const provider = this.providers[credentials.kind];
    if (provider === undefined) {
      return Promise.resolve({
        ok: false,
        code: "EMAIL_PROVIDER_UNAVAILABLE",
        message: "This email provider isn't available right now.",
      });
    }
    return provider.send(credentials, message);
  }
}
