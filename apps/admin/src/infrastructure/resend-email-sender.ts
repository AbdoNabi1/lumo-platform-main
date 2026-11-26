import type { EmailSender } from "../interfaces/email-sender.port";

/** Plan 1C: Resend over plain HTTP (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendEmailSender implements EmailSender {
  private readonly options: {
    readonly apiKey: string;
    readonly from: string;
    readonly fetchImpl?: typeof fetch;
  };

  constructor(options: {
    readonly apiKey: string;
    readonly from: string;
    readonly fetchImpl?: typeof fetch;
  }) {
    this.options = options;
  }

  async send(message: {
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    readonly html?: string;
    readonly from?: string;
    readonly replyTo?: string;
    readonly idempotencyKey?: string;
  }): Promise<void> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const response = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
        ...(message.idempotencyKey === undefined
          ? {}
          : { "idempotency-key": message.idempotencyKey }),
      },
      body: JSON.stringify({
        from: message.from ?? this.options.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html === undefined ? {} : { html: message.html }),
        ...(message.replyTo === undefined ? {} : { reply_to: message.replyTo }),
      }),
      // A hung provider must not hold an order or payment transition open (D42).
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`email provider responded with status ${response.status}`);
  }
}
