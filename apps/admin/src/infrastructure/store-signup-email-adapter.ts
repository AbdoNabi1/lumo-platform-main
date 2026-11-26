import { escapeHtml, type StoreMailSender, type StoreProfilePort } from "@platform/notifications";
import type { SignupEmailPort } from "../interfaces/signup-email.port";
import { alreadyRegisteredEmail, signupCompleteEmail } from "./email-templates";

/**
 * Wave 2b2 (D45/D46/D51): a store's customer sign-up mails go ONLY through that store's own email
 * connection, From the store's name at the merchant's own address. This adapter holds no platform
 * sender and has no fallback: with no working connection `isAvailable` is false (the sign-up route
 * answers 503 EMAIL_NOT_CONNECTED before anything is looked up) and a send throws.
 */
export class StoreSignupEmailAdapter implements SignupEmailPort {
  private readonly mail: StoreMailSender;
  private readonly store: StoreProfilePort;

  constructor(mail: StoreMailSender, store: StoreProfilePort) {
    this.mail = mail;
    this.store = store;
  }

  isAvailable(tenantId: string): Promise<boolean> {
    return this.mail.isConnected(tenantId);
  }

  sendCompleteAccountEmail(input: {
    readonly email: string;
    readonly link: string;
    readonly tenantId: string;
  }): Promise<void> {
    return this.send(input.tenantId, input.email, signupCompleteEmail(input.link));
  }

  sendAlreadyRegisteredEmail(input: {
    readonly email: string;
    readonly tenantId: string;
  }): Promise<void> {
    return this.send(input.tenantId, input.email, alreadyRegisteredEmail());
  }

  private async send(
    tenantId: string,
    to: string,
    mail: { readonly subject: string; readonly text: string },
  ): Promise<void> {
    const profile = await this.store.get(tenantId);
    await this.mail.send(tenantId, profile.storeName, {
      to,
      subject: mail.subject,
      text: mail.text,
      html: `<div dir="auto" style="white-space:pre-wrap">${escapeHtml(mail.text)}</div>`,
    });
  }
}
