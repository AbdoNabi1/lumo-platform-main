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

export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly from: string;
  readonly replyTo?: string;
  readonly idempotencyKey?: string;
}

/** The one way the Notifications context sends a real email (the admin app implements it over `EmailSender`). */
export interface EmailDeliveryPort {
  /** `false` when the runtime has no real provider: nothing is ever delivered, and the UI says so (D40). */
  readonly deliveryConfigured: boolean;
  /** The platform's sending mailbox, e.g. `Morbeh <onboarding@resend.dev>`. */
  readonly platformFrom: string;
  send(message: OutgoingMail): Promise<void>;
}

/** Logs without bodies or addresses (ADR-0006). */
export interface NotificationLog {
  warn(
    message: string,
    fields?: Readonly<Record<string, string | number | boolean | undefined>>,
  ): void;
}
