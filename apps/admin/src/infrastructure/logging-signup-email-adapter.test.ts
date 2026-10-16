import { describe, expect, it } from "vitest";
import { LoggingSignupEmailAdapter } from "./logging-signup-email-adapter";

describe("LoggingSignupEmailAdapter (G-72)", () => {
  it("resolves without throwing for sendCompleteAccountEmail", async () => {
    const adapter = new LoggingSignupEmailAdapter();
    await expect(
      adapter.sendCompleteAccountEmail({
        email: "guest@example.com",
        link: "https://shop.example.com/account/signup/complete?token=abc",
        tenantId: "tenant-1",
      }),
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing for sendAlreadyRegisteredEmail", async () => {
    const adapter = new LoggingSignupEmailAdapter();
    await expect(
      adapter.sendAlreadyRegisteredEmail({ email: "real@example.com", tenantId: "tenant-1" }),
    ).resolves.toBeUndefined();
  });
});
