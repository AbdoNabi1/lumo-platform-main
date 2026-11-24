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
   * Wave 1d (R1): `true` only when `emailSender` REALLY delivers (the Resend branch). The logging sender
   * answers every call successfully while sending nothing, so it must never back an invitation.
   */
  readonly deliveryConfigured: boolean;
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
    return { emailSender: new LoggingEmailSender(logger), deliveryConfigured: false };
  }
  const emailSender = new ResendEmailSender({
    apiKey: config.RESEND_API_KEY,
    from: config.EMAIL_FROM,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
  return {
    emailSender,
    deliveryConfigured: true,
    signupEmail: new EmailSignupEmailAdapter(emailSender),
  };
}

/**
 * Wave 1d (R1): what the admin wiring receives for staff invitations. The sender is passed ONLY when
 * delivery is real and `ADMIN_PUBLIC_URL` is set (the link is built from it); otherwise inviting answers
 * 503 NOT_CONFIGURED before anything is written. Password reset keeps using `emailSender` as before.
 */
export function staffInviteDelivery(
  email: Pick<EmailWiring, "emailSender" | "deliveryConfigured">,
  config: Pick<RuntimeConfig, "ADMIN_PUBLIC_URL">,
): { readonly staffInviteEmailSender?: EmailSender } {
  return email.deliveryConfigured && config.ADMIN_PUBLIC_URL !== undefined
    ? { staffInviteEmailSender: email.emailSender }
    : {};
}
