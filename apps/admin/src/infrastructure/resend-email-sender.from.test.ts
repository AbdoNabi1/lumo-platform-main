import { describe, expect, it } from "vitest";
import { LoggingEmailSender } from "./logging-email-sender";
import { ResendEmailSender } from "./resend-email-sender";

/** Wave 2b: the sender port gained optional `from`, `replyTo` and `idempotencyKey`. */
function capture() {
  const seen: { init: RequestInit }[] = [];
  const sender = new ResendEmailSender({
    apiKey: "re_test_fake",
    from: "Morbeh <onboarding@resend.dev>",
    fetchImpl: ((_url: string, init: RequestInit) => {
      seen.push({ init });
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch,
  });
  return { sender, seen };
}

describe("ResendEmailSender from / reply-to / idempotency (Wave 2b)", () => {
  it("sends the store's From and Reply-To, and the idempotency key as a header", async () => {
    expect.hasAssertions();
    const { sender, seen } = capture();
    await sender.send({
      to: "c@x.test",
      subject: "S",
      text: "T",
      html: "<p>T</p>",
      from: '"Nusuj" <onboarding@resend.dev>',
      replyTo: "shop@gmail.com",
      idempotencyKey: "abc:attempt:0",
    });
    const init = seen[0]!.init;
    expect(JSON.parse(String(init.body))).toEqual({
      from: '"Nusuj" <onboarding@resend.dev>',
      to: ["c@x.test"],
      subject: "S",
      text: "T",
      html: "<p>T</p>",
      reply_to: "shop@gmail.com",
    });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("abc:attempt:0");
  });

  it("keeps the configured From and sends no reply_to or key when none are given", async () => {
    expect.hasAssertions();
    const { sender, seen } = capture();
    await sender.send({ to: "c@x.test", subject: "S", text: "T" });
    const init = seen[0]!.init;
    expect(JSON.parse(String(init.body))).toEqual({
      from: "Morbeh <onboarding@resend.dev>",
      to: ["c@x.test"],
      subject: "S",
      text: "T",
    });
    expect(Object.keys(init.headers as object)).not.toContain("idempotency-key");
  });

  it("gives up after a bounded wait so a hung provider cannot hold a transition open", async () => {
    expect.hasAssertions();
    const { sender, seen } = capture();
    await sender.send({ to: "c@x.test", subject: "S", text: "T" });
    expect(seen[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("LoggingEmailSender with the new fields", () => {
  it("still logs recipient and subject only: no body, no From, no Reply-To, no key", async () => {
    expect.hasAssertions();
    const lines: string[] = [];
    const logger = { info: (m: string, f?: unknown) => lines.push(`${m} ${JSON.stringify(f)}`) };
    await new LoggingEmailSender(logger).send({
      to: "c@x.test",
      subject: "S",
      text: "SECRET-BODY",
      from: "Shop <a@b.test>",
      replyTo: "merchant@shop.test",
      idempotencyKey: "KEY-1",
    } as never);
    const out = lines.join("\n");
    expect(out).toContain("c@x.test");
    for (const hidden of ["SECRET-BODY", "a@b.test", "merchant@shop.test", "KEY-1"]) {
      expect(out).not.toContain(hidden);
    }
  });
});
