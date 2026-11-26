/** What the Notifications messaging use cases need from outside the context (Wave 2b). All ports; no I/O here. */

export interface StoreProfile {
  readonly storeName: string;
  /** The store's contact email: the Sender email's default and the Reply-To when nothing else is set. */
  readonly contactEmail: string | null;
  /** The store's default language (`ar` | `en`), if known. */
  readonly defaultLocale: string | null;
}

export interface StoreProfilePort {
  get(tenantId: string): Promise<StoreProfile>;
}

/** A customer's contact, resolved at send time and never stored on a notification row (ADR-0006). */
export interface RecipientContact {
  readonly name: string;
  readonly email: string;
  readonly language: string | null;
}

export interface RecipientResolverPort {
  resolve(tenantId: string, customerRef: string): Promise<RecipientContact | null>;
}

/** A store's mail, without a From: the store's own email account decides that (D46). */
export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly idempotencyKey?: string;
}

/**
 * The one way the Notifications context sends a store's mail (D45/D46): through the STORE's own email
 * connection, resolved per call. There is no platform fallback: no connection, a switched-off one or
 * one that fails means nothing is sent and `send` throws a `StoreEmailError`.
 */
export interface StoreMailSender {
  /** True when the store has a connected, switched-on connection the server can open and use. */
  isConnected(tenantId: string): Promise<boolean>;
  /** `storeName` becomes the display name of the From (the merchant's own address). */
  send(tenantId: string, storeName: string, mail: OutgoingMail): Promise<void>;
}

/** Logs without bodies or addresses (ADR-0006). */
export interface NotificationLog {
  warn(
    message: string,
    fields?: Readonly<Record<string, string | number | boolean | undefined>>,
  ): void;
}
