import { describe, expect, it } from "vitest";
import { ResendStoreEmailProvider } from "./resend-store-email-provider";

const STORE_KEY = "re_store_AbCdEfGhIjKlMnOpQrStUv1234";
const credentials = { kind: "resend" as const, apiKey: STORE_KEY };
const message = {
  to: "sara@customer.test",
  subject: "Order #1 confirmed",
  text: "Thanks",
  html: "<p>Thanks</p>",
  from: '"Nusuj Store" <shop@nusuj.com>',
  idempotencyKey: "n-1:attempt:0",
};

interface Seen {
  url: string;
  init: RequestInit;
}

function provider(respond: (seen: Seen) => Promise<Response> | Response) {
  const calls: Seen[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    const seen = { url, init };
    calls.push(seen);
    return Promise.resolve(respond(seen));
  }) as typeof fetch;
  return { sender: new ResendStoreEmailProvider({ fetchImpl }), calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("ResendStoreEmailProvider (D47): the MERCHANT's own Resend account", () => {
  it("POSTs to Resend with the STORE's key as the bearer, the idempotency key and the exact message", async () => {
    expect.hasAssertions();
    const { sender, calls } = provider(() => json(200, { id: "1" }));
    expect(await sender.send(credentials, message)).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Bearer ${STORE_KEY}`);
    expect(headers["idempotency-key"]).toBe("n-1:attempt:0");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      from: message.from,
      to: ["sara@customer.test"],
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    // A 10 s timeout signal is attached (a hung provider must not hold an order open).
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends no idempotency header when the mail has no key (a test mail)", async () => {
    expect.hasAssertions();
    const { sender, calls } = provider(() => json(200, { id: "1" }));
    const { idempotencyKey: _unused, ...bare } = message;
    await sender.send(credentials, bare);
    expect("idempotency-key" in (calls[0]?.init.headers as object)).toBe(false);
  });

  it("maps each refusal to a code and keeps the provider's useful message", async () => {
    expect.hasAssertions();
    const cases: [number, string, string, string][] = [
      [401, "API key is invalid", "EMAIL_KEY_REJECTED", "API key is invalid"],
      [
        403,
        "The nusuj.com domain is not verified. Please, add and verify your domain.",
        "EMAIL_SENDER_REJECTED",
        "The nusuj.com domain is not verified",
      ],
      [
        422,
        "Invalid `from` field. The email address needs to follow the `email@example.com` format.",
        "EMAIL_REQUEST_REJECTED",
        "Invalid `from` field",
      ],
      [400, "Missing `subject` field.", "EMAIL_REQUEST_REJECTED", "Missing `subject` field"],
      [429, "Too many requests", "EMAIL_RATE_LIMITED", "Too many requests"],
      [500, "Internal server error", "EMAIL_PROVIDER_UNAVAILABLE", "Internal server error"],
      [503, "Service unavailable", "EMAIL_PROVIDER_UNAVAILABLE", "Service unavailable"],
    ];
    for (const [status, text, code, expected] of cases) {
      const { sender } = provider(() =>
        json(status, { statusCode: status, name: "x", message: text }),
      );
      const result = await sender.send(credentials, message);
      expect(result).toMatchObject({ ok: false, code });
      expect(result.ok ? "" : result.message).toContain(expected);
    }
  });

  it("a 403 about a restricted key is a key problem, not a sender problem", async () => {
    expect.hasAssertions();
    const { sender } = provider(() =>
      json(403, {
        name: "restricted_api_key",
        message: "This API key is restricted to only send emails",
      }),
    );
    expect(await sender.send(credentials, message)).toMatchObject({
      ok: false,
      code: "EMAIL_KEY_REJECTED",
    });
  });

  it("never echoes the key, a recipient address or a Bearer token from the provider's text", async () => {
    expect.hasAssertions();
    const { sender } = provider(() =>
      json(422, {
        message: `bad key ${STORE_KEY} for sara@customer.test (Bearer abcdefgh12345678)`,
      }),
    );
    const result = await sender.send(credentials, message);
    const text = JSON.stringify(result);
    expect(text).not.toContain(STORE_KEY);
    expect(text).not.toContain("sara@customer.test");
    expect(text).not.toContain("abcdefgh12345678");
  });

  it("an unreadable answer falls back to a fixed message per status", async () => {
    expect.hasAssertions();
    const { sender } = provider(() => new Response("<html>gateway</html>", { status: 502 }));
    const result = await sender.send(credentials, message);
    expect(result).toMatchObject({ ok: false, code: "EMAIL_PROVIDER_UNAVAILABLE" });
    expect(result.ok ? "" : result.message).not.toContain("html");
  });

  it("a timeout is EMAIL_TIMEOUT and a network error EMAIL_PROVIDER_UNAVAILABLE: no cause kept, no key in the message", async () => {
    expect.hasAssertions();
    const timeout = new ResendStoreEmailProvider({
      fetchImpl: (() =>
        Promise.reject(
          new DOMException("The operation timed out", "TimeoutError"),
        )) as typeof fetch,
    });
    expect(await timeout.send(credentials, message)).toMatchObject({
      ok: false,
      code: "EMAIL_TIMEOUT",
    });
    const network = new ResendStoreEmailProvider({
      fetchImpl: (() => Promise.reject(new Error(`ECONNRESET with ${STORE_KEY}`))) as typeof fetch,
    });
    const result = await network.send(credentials, message);
    expect(result).toMatchObject({ ok: false, code: "EMAIL_PROVIDER_UNAVAILABLE" });
    expect(JSON.stringify(result)).not.toContain(STORE_KEY);
  });

  it("refuses a connection kind it does not speak, without calling out", async () => {
    expect.hasAssertions();
    const { sender, calls } = provider(() => json(200, {}));
    const result = await sender.send(
      { kind: "sendgrid" as unknown as "resend", apiKey: STORE_KEY },
      message,
    );
    expect(result).toMatchObject({ ok: false, code: "EMAIL_REQUEST_REJECTED" });
    expect(calls).toHaveLength(0);
  });

  it("has no platform key anywhere: its constructor takes no key", () => {
    expect.hasAssertions();
    expect(ResendStoreEmailProvider.length).toBeLessThanOrEqual(1);
  });
});
