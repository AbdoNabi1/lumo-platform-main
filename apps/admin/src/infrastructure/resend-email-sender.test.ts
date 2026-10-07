import { describe, expect, it } from "vitest";
import { LoggingEmailSender } from "./logging-email-sender";
import { ResendEmailSender } from "./resend-email-sender";
import { passwordResetEmail } from "./email-templates";

describe("ResendEmailSender (Plan 1C)", () => {
  it("POSTs to the Resend API with a bearer key and the message", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const sender = new ResendEmailSender({
      apiKey: "re_test_fake",
      from: "Morbeh <onboarding@resend.dev>",
      fetchImpl: ((url: string, init: RequestInit) => {
        seen = { url, init };
        return Promise.resolve(new Response(JSON.stringify({ id: "1" }), { status: 200 }));
      }) as typeof fetch,
    });
    await sender.send({ to: "o@x.test", subject: "S", text: "T" });
    expect(seen?.url).toBe("https://api.resend.com/emails");
    expect((seen?.init.headers as Record<string, string>)["authorization"]).toBe(
      "Bearer re_test_fake",
    );
    expect(JSON.parse(String(seen?.init.body))).toEqual({
      from: "Morbeh <onboarding@resend.dev>",
      to: ["o@x.test"],
      subject: "S",
      text: "T",
    });
  });

  it("throws on a non-2xx answer without echoing the key", async () => {
    const sender = new ResendEmailSender({
      apiKey: "re_test_fake",
      from: "x@y.test",
      fetchImpl: (() => Promise.resolve(new Response("nope", { status: 422 }))) as typeof fetch,
    });
    const failure = await sender
      .send({ to: "o@x.test", subject: "S", text: "T" })
      .then(() => null)
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
    expect(failure).toMatch(/422/);
    expect(failure).not.toContain("re_test_fake");
  });
});

describe("LoggingEmailSender", () => {
  it("logs recipient and subject only — never the body or link", async () => {
    const lines: string[] = [];
    const logger = { info: (m: string, f?: unknown) => lines.push(`${m} ${JSON.stringify(f)}`) };
    const mail = passwordResetEmail("https://admin.test/reset-password?token=SECRET-TOKEN");
    await new LoggingEmailSender(logger).send({ to: "o@x.test", ...mail });
    expect(lines.join("\n")).toContain("o@x.test");
    expect(lines.join("\n")).not.toContain("SECRET-TOKEN");
  });
});

describe("templates", () => {
  it("are bilingual and carry the link", () => {
    const mail = passwordResetEmail("https://admin.test/reset-password?token=abc");
    expect(mail.text).toContain("https://admin.test/reset-password?token=abc");
    expect(mail.text).toMatch(/[؀-ۿ]/);
    expect(mail.text).toMatch(/password/i);
  });
});
