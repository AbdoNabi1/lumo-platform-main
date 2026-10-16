import type { Logger } from "@platform/utils";
import type { EmailSender } from "../interfaces/email-sender.port";

/** Plan 1C: dev/test sender. Logs who and what subject — never the body, which may hold a link. */
export class LoggingEmailSender implements EmailSender {
  private readonly logger: Pick<Logger, "info">;

  constructor(logger: Pick<Logger, "info">) {
    this.logger = logger;
  }

  send(message: { readonly to: string; readonly subject: string }): Promise<void> {
    this.logger.info("email (not sent: logging sender)", {
      to: message.to,
      subject: message.subject,
    });
    return Promise.resolve();
  }
}
