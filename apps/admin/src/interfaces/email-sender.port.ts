/** Plan 1C: the one way the platform sends email. Implementations never log the body. */
export interface EmailSender {
  send(message: {
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    readonly html?: string;
    /** Wave 2b: the mailbox the mail comes from; absent ⇒ the sender's own default (the platform mailbox). */
    readonly from?: string;
    /** Wave 2b: where a customer's reply goes (the merchant's address). */
    readonly replyTo?: string;
    /** Wave 2b: a retry of the same logical mail carries the same key, so the provider sends it once. */
    readonly idempotencyKey?: string;
  }): Promise<void>;
}
