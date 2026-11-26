import type { EmailDeliveryPort, OutgoingMail } from "@platform/notifications";
import type { EmailSender } from "../../interfaces/email-sender.port";

/**
 * Wave 2b: the Notifications context's one way to send a real email, over the platform's
 * `EmailSender`. `deliveryConfigured` is the runtime's own answer (Resend present or not): when it is
 * `false` the sender only logs, so nothing here ever claims a mail was sent (D40).
 */
export class SenderEmailDelivery implements EmailDeliveryPort {
  readonly deliveryConfigured: boolean;
  readonly platformFrom: string;
  private readonly sender: EmailSender | undefined;

  constructor(options: {
    readonly sender?: EmailSender;
    readonly deliveryConfigured: boolean;
    readonly platformFrom: string;
  }) {
    this.sender = options.sender;
    this.deliveryConfigured = options.deliveryConfigured && options.sender !== undefined;
    this.platformFrom = options.platformFrom;
  }

  async send(message: OutgoingMail): Promise<void> {
    if (!this.deliveryConfigured || this.sender === undefined) {
      throw new Error("EMAIL_NOT_CONFIGURED");
    }
    await this.sender.send({
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      from: message.from,
      ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
      ...(message.idempotencyKey === undefined ? {} : { idempotencyKey: message.idempotencyKey }),
    });
  }
}
