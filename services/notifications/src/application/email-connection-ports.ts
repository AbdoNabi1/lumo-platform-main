import type { EmailConnectionKind } from "../domain/messaging/email-connection";

/**
 * Seals and opens a store's email credentials (D48). What the vault returns is an opaque string the
 * repository stores as is. The tenant and the connection kind are sealed INSIDE and re-checked on
 * open, so a blob copied from one store's row into another's opens as nothing. Every failure is the
 * same generic error that names no tenant, key, plaintext or ciphertext.
 */
export interface EmailConnectionVault {
  /** `stub` is NOT encryption: the boot guard refuses it outside `APP_ENV=local`. */
  readonly backing: "real" | "stub";
  seal(
    tenantId: string,
    kind: EmailConnectionKind,
    secrets: Readonly<Record<string, string>>,
  ): Promise<string>;
  open(
    tenantId: string,
    kind: EmailConnectionKind,
    sealed: string,
  ): Promise<Readonly<Record<string, string>>>;
}

/** The merchant's own credentials for one send: in memory only, never stored or logged. */
export interface StoreEmailCredentials {
  readonly kind: EmailConnectionKind;
  readonly apiKey: string;
}

export interface StoreEmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly from: string;
  /** A retry of the same logical mail carries the same key, so the provider sends it once. */
  readonly idempotencyKey?: string;
}

/** Why a send through the merchant's account failed. Codes are what a notification row records. */
export type StoreEmailFailureCode =
  | "EMAIL_KEY_REJECTED"
  | "EMAIL_SENDER_REJECTED"
  | "EMAIL_REQUEST_REJECTED"
  | "EMAIL_RATE_LIMITED"
  | "EMAIL_PROVIDER_UNAVAILABLE"
  | "EMAIL_TIMEOUT";

export type StoreEmailResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: StoreEmailFailureCode;
      /** Already sanitized: no key, no address, no body. Safe to store and show the merchant. */
      readonly message: string;
    };

/**
 * One email provider's HTTPS API, called with the MERCHANT's own credentials (D47). It never reads a
 * platform key: the key arrives with each call. Never throws for a provider refusal: that is a
 * `{ ok: false }` result.
 */
export interface StoreEmailProvider {
  send(credentials: StoreEmailCredentials, message: StoreEmailMessage): Promise<StoreEmailResult>;
}
