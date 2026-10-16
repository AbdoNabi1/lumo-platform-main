import {
  EmailSignupEmailAdapter,
  LoggingEmailSender,
  ResendEmailSender,
  type EmailSender,
  type SignupEmailPort,
} from "@platform/admin";
import { logger } from "@platform/utils";
import type { RuntimeConfig } from "./config";

export interface EmailWiring {
  readonly emailSender: EmailSender;
  /**
   * Present ONLY when `RESEND_API_KEY` is set. Absent ⇒ the caller keeps the logging signup adapter,
   * so `assertProductionSignupEmailConfigured` still refuses a non-local deployment with no real sender.
   */
  readonly signupEmail?: SignupEmailPort;
}

/** Plan 1C: Resend when a key is configured, otherwise a sender that logs recipient + subject only. */
export function resolveEmailWiring(
  config: Pick<RuntimeConfig, "RESEND_API_KEY" | "EMAIL_FROM">,
  fetchImpl?: typeof fetch,
): EmailWiring {
  if (config.RESEND_API_KEY === undefined) {
    return { emailSender: new LoggingEmailSender(logger) };
  }
  const emailSender = new ResendEmailSender({
    apiKey: config.RESEND_API_KEY,
    from: config.EMAIL_FROM,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
  return { emailSender, signupEmail: new EmailSignupEmailAdapter(emailSender) };
}
