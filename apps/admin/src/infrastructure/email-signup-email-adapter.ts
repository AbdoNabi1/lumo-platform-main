import type { EmailSender } from "../interfaces/email-sender.port";
import type { SignupEmailPort } from "../interfaces/signup-email.port";
import { alreadyRegisteredEmail, signupCompleteEmail } from "./email-templates";

/** Plan 1C (closes G-72 when configured): customer signup emails through the real sender. */
export class EmailSignupEmailAdapter implements SignupEmailPort {
  private readonly sender: EmailSender;

  constructor(sender: EmailSender) {
    this.sender = sender;
  }

  sendCompleteAccountEmail(input: {
    readonly email: string;
    readonly link: string;
  }): Promise<void> {
    return this.sender.send({ to: input.email, ...signupCompleteEmail(input.link) });
  }

  sendAlreadyRegisteredEmail(input: { readonly email: string }): Promise<void> {
    return this.sender.send({ to: input.email, ...alreadyRegisteredEmail() });
  }
}
