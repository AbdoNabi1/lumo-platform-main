import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { StoreEmailCredentials } from "../application/email-connection-ports";
import { smtpErrorCodeOf } from "../domain/messaging/email-connection";
import { startFakeSmtpServer, type FakeSmtpServer } from "../testing/fake-smtp-server";
import { makeSelfSignedCertificate, type TestCertificate } from "../testing/self-signed-cert";
import { InMemoryStoreEmailProvider } from "./in-memory-store-email-provider";
import { RoutingStoreEmailProvider, SmtpStoreEmailProvider } from "./smtp-store-email-provider";

const PASSWORD = "abcdefghijklmnop";
const message = {
  to: "customer@example.test",
  subject: "Order #1001",
  text: "Thanks",
  html: "<p>Thanks</p>",
  from: '"Nusuj Store" <shop@gmail.test>',
  idempotencyKey: "ntf_1:attempt:0",
};

let certificate: TestCertificate;
const servers: FakeSmtpServer[] = [];

beforeAll(() => {
  certificate = makeSelfSignedCertificate();
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function setup(replies: Parameters<typeof startFakeSmtpServer>[0]["replies"] = {}) {
  const server = await startFakeSmtpServer({
    mode: "tls",
    certificate,
    credentials: { user: "shop@gmail.test", pass: PASSWORD },
    replies,
  });
  servers.push(server);
  const credentials = (password = PASSWORD): StoreEmailCredentials => ({
    kind: "smtp",
    apiKey: password,
    smtp: { host: "localhost", port: server.port, security: "tls", username: "shop@gmail.test" },
  });
  const provider = new SmtpStoreEmailProvider({
    ca: certificate.cert,
    resolveHost: () => Promise.resolve("127.0.0.1"),
    timeoutMs: 5_000,
  });
  return { server, credentials, provider };
}

describe("SmtpStoreEmailProvider", () => {
  it("sends through the mailbox and answers ok", async () => {
    const { server, credentials, provider } = await setup();
    expect(await provider.send(credentials(), message)).toEqual({ ok: true });
    expect(server.received).toHaveLength(1);
    expect(server.received[0]?.mailFrom).toBe("<shop@gmail.test>");
  });

  it("a wrong password is EMAIL_AUTH_FAILED with a fixed sentence and no secret", async () => {
    const { credentials, provider } = await setup();
    const result = await provider.send(credentials("not-the-password"), message);
    expect(result).toMatchObject({ ok: false, code: "EMAIL_AUTH_FAILED" });
    const text = JSON.stringify(result);
    expect(text).not.toContain("not-the-password");
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain("not accepted");
    expect(smtpErrorCodeOf((result as { message: string }).message)).toBe("AUTH_FAILED");
  });

  it("maps the daily limit, a refusal and a dead server to their own codes", async () => {
    const limited = await setup({ dataEnd: "550 5.4.5 Daily user sending quota exceeded." });
    expect(await limited.provider.send(limited.credentials(), message)).toMatchObject({
      code: "EMAIL_DAILY_LIMIT",
    });

    const refused = await setup({ rcptTo: "550 5.1.1 no such user customer@example.test" });
    const refusal = await refused.provider.send(refused.credentials(), message);
    expect(refusal).toMatchObject({ code: "EMAIL_REJECTED" });
    expect(JSON.stringify(refusal)).not.toContain("example.test");

    const down = await setup();
    await down.server.close();
    expect(await down.provider.send(down.credentials(), message)).toMatchObject({
      code: "EMAIL_CONNECTION_FAILED",
      message: expect.stringContaining("may block mail ports"),
    });
  });

  it("an untrusted certificate is EMAIL_TLS_FAILED", async () => {
    const { credentials } = await setup();
    const strict = new SmtpStoreEmailProvider({
      ca: makeSelfSignedCertificate().cert,
      resolveHost: () => Promise.resolve("127.0.0.1"),
      timeoutMs: 5_000,
    });
    expect(await strict.send(credentials(), message)).toMatchObject({ code: "EMAIL_TLS_FAILED" });
  });

  it("refuses credentials that are not a mailbox's, without connecting", async () => {
    const { provider, server } = await setup();
    expect(await provider.send({ kind: "resend", apiKey: "re_x" }, message)).toMatchObject({
      ok: false,
      code: "EMAIL_REJECTED",
    });
    expect(server.connections()).toBe(0);
  });

  it("a header-injection attempt is refused before any connection", async () => {
    const { provider, credentials, server } = await setup();
    const result = await provider.send(credentials(), {
      ...message,
      subject: "Hi\r\nBcc: attacker@evil.test",
    });
    expect(result).toMatchObject({ ok: false, code: "EMAIL_REJECTED" });
    expect(server.connections()).toBe(0);
  });
});

describe("RoutingStoreEmailProvider", () => {
  it("sends each kind through its own provider and refuses a kind it has none for", async () => {
    const resend = new InMemoryStoreEmailProvider();
    const smtp = new InMemoryStoreEmailProvider();
    const router = new RoutingStoreEmailProvider({ resend, smtp });
    await router.send({ kind: "resend", apiKey: "re_a" }, message);
    await router.send({ kind: "smtp", apiKey: "p" }, message);
    expect(resend.calls).toHaveLength(1);
    expect(smtp.calls).toHaveLength(1);

    const resendOnly = new RoutingStoreEmailProvider({ resend });
    expect(await resendOnly.send({ kind: "smtp", apiKey: "p" }, message)).toMatchObject({
      ok: false,
      code: "EMAIL_PROVIDER_UNAVAILABLE",
    });
    expect(resend.calls).toHaveLength(1);
  });
});
