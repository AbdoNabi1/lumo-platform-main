import { describe, expect, it } from "vitest";
import { EmailSignupEmailAdapter, LoggingEmailSender, ResendEmailSender } from "@platform/admin";
import { resolveEmailWiring } from "./email-wiring";

describe("resolveEmailWiring (Plan 1C)", () => {
  it("without a key: a logging sender and NO signup adapter (the G-72 guard keeps refusing)", () => {
    const wiring = resolveEmailWiring({ RESEND_API_KEY: undefined, EMAIL_FROM: "x@y.test" });
    expect(wiring.emailSender).toBeInstanceOf(LoggingEmailSender);
    expect(wiring.signupEmail).toBeUndefined();
  });

  it("with a key: a Resend sender and a real signup adapter", () => {
    const wiring = resolveEmailWiring({
      RESEND_API_KEY: "re_fake_key_123",
      EMAIL_FROM: "Morbeh <onboarding@resend.dev>",
    });
    expect(wiring.emailSender).toBeInstanceOf(ResendEmailSender);
    expect(wiring.signupEmail).toBeInstanceOf(EmailSignupEmailAdapter);
  });
});
