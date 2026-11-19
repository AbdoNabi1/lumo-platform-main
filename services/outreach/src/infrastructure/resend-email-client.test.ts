import { describe, expect, it } from "vitest";
import { createMetaFetchHarness } from "../testing/meta-fetch-harness";
import { ResendEmailClient } from "./resend-email-client";

const message = {
  from: "Store <from@example.com>",
  replyTo: "reply@example.com",
  to: "to@example.com",
  subject: "Subject",
  html: "<p>Hello</p>",
  text: "Hello",
  idempotencyKey: "outreach/email/123",
  headers: { "X-Test": "yes" },
};

describe("ResendEmailClient", () => {
  it("sends the exact request and caller idempotency key", async () => {
    expect.hasAssertions();
    const h = createMetaFetchHarness([{ status: 200, json: { id: "email-1" } }]);
    const client = new ResendEmailClient({ apiKey: "secret", fetchImpl: h.fetchImpl });
    expect(await client.send(message)).toEqual({ kind: "accepted", providerMessageId: "email-1" });
    expect(h.calls[0]?.url).toBe("https://api.resend.com/emails");
    expect(h.calls[0]?.method).toBe("POST");
    expect(h.calls[0]?.headers.authorization?.startsWith("Bearer ")).toBe(true);
    expect(h.calls[0]?.headers["idempotency-key"]).toBe(message.idempotencyKey);
    expect(h.calls[0]?.body).toEqual({
      from: message.from,
      reply_to: message.replyTo,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers,
    });
  });
  it("maps failures without exposing the key", async () => {
    expect.hasAssertions();
    const h = createMetaFetchHarness([
      { status: 429, json: { name: "rate_limit", message: "secret" } },
      { status: 500, json: {} },
      { throw: new Error("secret") },
      { status: 200, json: {} },
    ]);
    const client = new ResendEmailClient({ apiKey: "secret", fetchImpl: h.fetchImpl });
    const rate = await client.send(message);
    expect(rate).toMatchObject({ kind: "rejected", retryable: true });
    expect(JSON.stringify(rate)).not.toContain("secret");
    for (let i = 0; i < 3; i++) {
      const result = await client.send(message);
      expect(result.kind).toBe("unknown");
      expect(JSON.stringify(result)).not.toContain("secret");
    }
  });
  it("omits optional fields, maps a 2xx without id to unknown, and defaults fetch and timeout", async () => {
    expect.hasAssertions();
    const h = createMetaFetchHarness([{ status: 200, json: { id: "" } }]);
    const client = new ResendEmailClient({ apiKey: "secret", fetchImpl: h.fetchImpl });
    const { replyTo: _replyTo, headers: _headers, ...minimal } = message;
    expect(await client.send(minimal)).toEqual({
      kind: "unknown",
      message: "Email provider returned no message id",
    });
    expect(h.calls[0]?.body).toEqual({
      from: message.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    expect(new ResendEmailClient({ apiKey: "secret" })).toBeInstanceOf(ResendEmailClient);
  });
});
