import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  startFakeSmtpServer,
  type FakeSmtpOptions,
  type FakeSmtpServer,
} from "../testing/fake-smtp-server";
import { makeSelfSignedCertificate, type TestCertificate } from "../testing/self-signed-cert";
import {
  assertHeaderValue,
  buildMail,
  dotStuff,
  encodeWords,
  isPrivateAddress,
  parseFromHeader,
  sendSmtpMail,
  SmtpClientError,
  type SmtpClientOptions,
  type SmtpEndpoint,
  type SmtpMessage,
} from "./smtp-client";

const PASSWORD = "app-pass-Zx9-secret";
const USER = "shop@gmail.test";

const MESSAGE: SmtpMessage = {
  from: '"Nusuj Store" <shop@gmail.test>',
  to: "customer@example.test",
  subject: "Your order #1001",
  text: "Thanks for your order.",
  html: "<p>Thanks for your order.</p>",
  idempotencyKey: "ntf_1:attempt:1",
};

let certificate: TestCertificate;
let stranger: TestCertificate;
const servers: FakeSmtpServer[] = [];

beforeAll(() => {
  certificate = makeSelfSignedCertificate();
  stranger = makeSelfSignedCertificate();
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function start(options: Partial<FakeSmtpOptions> & Pick<FakeSmtpOptions, "mode">) {
  const server = await startFakeSmtpServer({
    certificate,
    credentials: { user: USER, pass: PASSWORD },
    ...options,
  });
  servers.push(server);
  return server;
}

function endpointFor(server: FakeSmtpServer, security: SmtpEndpoint["security"]): SmtpEndpoint {
  return { host: "localhost", port: server.port, security, username: USER, password: PASSWORD };
}

const clientOptions = (extra: SmtpClientOptions = {}): SmtpClientOptions => ({
  ca: certificate.cert,
  resolveHost: () => Promise.resolve("127.0.0.1"),
  now: () => new Date("2026-11-26T10:00:00.000Z"),
  timeoutMs: 5_000,
  ...extra,
});

async function failureOf(run: Promise<unknown>): Promise<SmtpClientError> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(SmtpClientError);
    return error as SmtpClientError;
  }
  throw new Error("expected the send to fail");
}

function decodeBase64Part(mime: string, contentType: string): string {
  const start = mime.indexOf(`Content-Type: ${contentType}`);
  const body = mime.slice(mime.indexOf("\r\n\r\n", start) + 4);
  const encoded = body.slice(0, body.indexOf("\r\n--")).replace(/\r\n/g, "");
  return Buffer.from(encoded, "base64").toString("utf8");
}

function decodeSubject(mime: string): string {
  const header = /^Subject: ((?:.*)(?:\r\n [^\r\n]*)*)/m.exec(mime)?.[1] ?? "";
  return header
    .replace(/\r\n /g, "")
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, b64: string) =>
      Buffer.from(b64, "base64").toString("utf8"),
    );
}

describe("SMTP client over implicit TLS (port 465 style)", () => {
  it("sends a multipart mail after AUTH PLAIN, with the certificate verified", async () => {
    const server = await start({ mode: "tls" });
    await sendSmtpMail(endpointFor(server, "tls"), MESSAGE, clientOptions());

    expect(server.received).toHaveLength(1);
    const mail = server.received[0]!;
    expect(mail.mailFrom).toBe("<shop@gmail.test>");
    expect(mail.rcptTo).toEqual(["<customer@example.test>"]);
    expect(mail.data).toContain('From: "Nusuj Store" <shop@gmail.test>\r\n');
    expect(mail.data).toContain("To: <customer@example.test>\r\n");
    expect(mail.data).toContain("Subject: Your order #1001\r\n");
    expect(mail.data).toContain("Date: Thu, 26 Nov 2026 10:00:00 +0000\r\n");
    expect(mail.data).toMatch(/Message-ID: <[0-9a-f]{32}@gmail\.test>\r\n/);
    expect(mail.data).toContain("MIME-Version: 1.0\r\n");
    expect(mail.data).toContain("multipart/alternative");
    expect(decodeBase64Part(mail.data, "text/plain")).toBe("Thanks for your order.");
    expect(decodeBase64Part(mail.data, "text/html")).toBe("<p>Thanks for your order.</p>");
    expect(server.authSecure).toEqual([true]);
    expect(server.commands.at(-1)).toBe("QUIT");
  });

  it("falls back to AUTH LOGIN when the server does not take PLAIN", async () => {
    const server = await start({ mode: "tls", mechanisms: ["LOGIN"] });
    await sendSmtpMail(endpointFor(server, "tls"), MESSAGE, clientOptions());
    expect(server.received).toHaveLength(1);

    const refusing = await start({ mode: "tls", replies: { plain: "504 5.5.4 not supported" } });
    await sendSmtpMail(endpointFor(refusing, "tls"), MESSAGE, clientOptions());
    expect(refusing.received).toHaveLength(1);
    // PLAIN refused, then LOGIN: two AUTH attempts, both over TLS.
    expect(refusing.authSecure).toEqual([true, true]);
  });

  it("answers AUTH_FAILED to a 535 and does not retry the same wrong password", async () => {
    const server = await start({
      mode: "tls",
      credentials: { user: USER, pass: "something-else" },
    });
    const error = await failureOf(
      sendSmtpMail(endpointFor(server, "tls"), MESSAGE, clientOptions()),
    );
    expect(error.code).toBe("AUTH_FAILED");
    expect(error.message).toBe("AUTH_FAILED");
    expect(JSON.stringify(error) + String(error.stack)).not.toContain(PASSWORD);
    expect(server.authSecure).toHaveLength(1);
    expect(server.received).toHaveLength(0);
  });

  it("answers DAILY_LIMIT for Gmail's 550 5.4.5 and 421 4.7.0", async () => {
    const atEnd = await start({
      mode: "tls",
      replies: { dataEnd: "550 5.4.5 Daily user sending quota exceeded. secret-server-detail" },
    });
    const first = await failureOf(
      sendSmtpMail(endpointFor(atEnd, "tls"), MESSAGE, clientOptions()),
    );
    expect(first.code).toBe("DAILY_LIMIT");
    expect(first.message).not.toContain("secret-server-detail");

    const atRcpt = await start({ mode: "tls", replies: { rcptTo: "421 4.7.0 Try again later" } });
    const second = await failureOf(
      sendSmtpMail(endpointFor(atRcpt, "tls"), MESSAGE, clientOptions()),
    );
    expect(second.code).toBe("DAILY_LIMIT");
  });

  it("answers REJECTED for any other 5xx refusal and never repeats the server's text", async () => {
    const server = await start({
      mode: "tls",
      replies: { rcptTo: "550 5.1.1 customer@example.test mailbox unavailable" },
    });
    const error = await failureOf(
      sendSmtpMail(endpointFor(server, "tls"), MESSAGE, clientOptions()),
    );
    expect(error.code).toBe("REJECTED");
    expect(error.message).toBe("REJECTED");
    expect(String(error.stack)).not.toContain("example.test");
  });

  it("answers TLS_FAILED for a certificate it does not trust, before any command", async () => {
    const server = await start({ mode: "tls" });
    const error = await failureOf(
      sendSmtpMail(endpointFor(server, "tls"), MESSAGE, clientOptions({ ca: stranger.cert })),
    );
    expect(error.code).toBe("TLS_FAILED");
    expect(server.commands).toEqual([]);
  });

  it("answers CONNECTION_FAILED when the server never speaks (the overall timeout)", async () => {
    const server = await start({ mode: "tls", silent: true });
    const started = Date.now();
    const error = await failureOf(
      sendSmtpMail(endpointFor(server, "tls"), MESSAGE, clientOptions({ timeoutMs: 300 })),
    );
    expect(error.code).toBe("CONNECTION_FAILED");
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("answers CONNECTION_FAILED when nothing listens on the port", async () => {
    const server = await start({ mode: "tls" });
    const port = server.port;
    await server.close();
    const error = await failureOf(
      sendSmtpMail({ ...endpointFor(server, "tls"), port }, MESSAGE, clientOptions()),
    );
    expect(error.code).toBe("CONNECTION_FAILED");
  });
});

describe("SMTP client with STARTTLS (port 587 style)", () => {
  it("upgrades, says EHLO again, and only then authenticates", async () => {
    const server = await start({ mode: "starttls" });
    await sendSmtpMail(endpointFor(server, "starttls"), MESSAGE, clientOptions());

    expect(server.commands.filter((command) => command !== "QUIT")).toEqual([
      "EHLO gmail.test",
      "STARTTLS",
      "EHLO gmail.test",
      "AUTH ***",
      "MAIL FROM:<shop@gmail.test>",
      "RCPT TO:<customer@example.test>",
      "DATA",
    ]);
    expect(server.authSecure).toEqual([true]);
    expect(server.received).toHaveLength(1);
  });

  it("never sends AUTH when the server hides STARTTLS, even if it offers AUTH in the clear", async () => {
    const server = await start({
      mode: "starttls",
      hideStartTls: true,
      advertiseAuthBeforeTls: true,
    });
    const error = await failureOf(
      sendSmtpMail(endpointFor(server, "starttls"), MESSAGE, clientOptions()),
    );
    expect(error.code).toBe("TLS_FAILED");
    expect(server.authSecure).toEqual([]);
    expect(server.commands.some((command) => command.startsWith("AUTH"))).toBe(false);
    expect(server.received).toHaveLength(0);
  });

  it("refuses an untrusted certificate after STARTTLS and never authenticates", async () => {
    const server = await start({ mode: "starttls" });
    const error = await failureOf(
      sendSmtpMail(endpointFor(server, "starttls"), MESSAGE, clientOptions({ ca: stranger.cert })),
    );
    expect(error.code).toBe("TLS_FAILED");
    expect(server.authSecure).toEqual([]);
  });
});

describe("what the client refuses to put on the wire", () => {
  const injections: readonly [string, Partial<SmtpMessage>][] = [
    ["subject with CRLF", { subject: "Hi\r\nBcc: attacker@evil.test" }],
    ["subject with LF", { subject: "Hi\nBcc: attacker@evil.test" }],
    ["subject with CR", { subject: "Hi\rBcc: attacker@evil.test" }],
    ["subject with NUL", { subject: "Hi\u0000there" }],
    ["recipient with CRLF", { to: "customer@example.test\r\nBcc: attacker@evil.test" }],
    ["recipient with a second address", { to: "a@example.test, b@example.test" }],
    ["from name with CRLF", { from: '"Shop\r\nBcc: x@evil.test" <shop@gmail.test>' }],
    ["from address with LF", { from: "<shop@gmail.test\nRCPT TO:<x@evil.test>>" }],
    ["idempotency key with CRLF", { idempotencyKey: "k\r\nBcc: x@evil.test" }],
  ];

  for (const [label, patch] of injections) {
    it(`refuses ${label} before connecting`, async () => {
      const server = await start({ mode: "tls" });
      const error = await failureOf(
        sendSmtpMail(endpointFor(server, "tls"), { ...MESSAGE, ...patch }, clientOptions()),
      );
      expect(error.code).toBe("REJECTED");
      expect(server.connections()).toBe(0);
    });
  }

  it("rejects control characters in any header value", () => {
    for (const bad of ["a\r", "a\n", "a\u0000", "a\u001B", "a\u007F"]) {
      expect(() => assertHeaderValue(bad)).toThrow(SmtpClientError);
    }
    expect(assertHeaderValue("tab\tis fine")).toBe("tab\tis fine");
  });

  it("refuses private and loopback destinations by default (no pointing it inward)", async () => {
    const server = await start({ mode: "tls" });
    const error = await failureOf(
      sendSmtpMail({ ...endpointFor(server, "tls") }, MESSAGE, {
        ca: certificate.cert,
        timeoutMs: 3_000,
      }),
    );
    expect(error.code).toBe("CONNECTION_FAILED");
    expect(server.connections()).toBe(0);
  });

  it("classifies private address ranges", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
      "not-an-ip",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ["8.8.8.8", "172.32.0.1", "74.125.130.108", "2607:f8b0:4004:c1b::6c"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});

describe("the message itself", () => {
  it("dot-stuffs every line that starts with a dot", () => {
    expect(dotStuff("a\r\n.b\r\n..c\r\n.\r\nd")).toBe("a\r\n..b\r\n...c\r\n..\r\nd");
    expect(dotStuff(".first")).toBe("..first");
    expect(dotStuff("no dots\r\nhere.")).toBe("no dots\r\nhere.");
  });

  it("keeps a body made of dot-lines intact end to end", async () => {
    const server = await start({ mode: "tls" });
    const text = "line one\n.hidden\n..two dots\n.\nlast";
    await sendSmtpMail(endpointFor(server, "tls"), { ...MESSAGE, text }, clientOptions());
    const mail = server.received[0]!;
    expect(decodeBase64Part(mail.data, "text/plain")).toBe(text);
    // Nothing on the wire could end the message early.
    expect(mail.wireData.split("\r\n").filter((line) => line === ".")).toEqual([]);
  });

  it("encodes an Arabic subject and store name as RFC 2047 words, ASCII on the wire", async () => {
    const subject = "تأكيد طلبك رقم 1001 من متجر نسيج للأزياء والمنسوجات اليدوية";
    const server = await start({ mode: "tls" });
    await sendSmtpMail(
      endpointFor(server, "tls"),
      {
        ...MESSAGE,
        subject,
        from: '"متجر نسيج" <shop@gmail.test>',
        text: "شكرا لطلبك",
        html: "<p>شكرا</p>",
      },
      clientOptions(),
    );
    const mail = server.received[0]!;
    // eslint-disable-next-line no-control-regex
    expect(/^[\u0000-\u007F]*$/.test(mail.wireData)).toBe(true);
    expect(mail.data).toContain("Subject: =?UTF-8?B?");
    expect(decodeSubject(mail.data)).toBe(subject);
    for (const line of mail.data.split("\r\n")) expect(line.length).toBeLessThanOrEqual(78);
    const fromHeader = /^From: (.*(?:\r\n [^\r\n]*)*)/m.exec(mail.data)?.[1] ?? "";
    expect(fromHeader).toContain("=?UTF-8?B?");
    expect(fromHeader.endsWith("<shop@gmail.test>")).toBe(true);
    expect(decodeBase64Part(mail.data, "text/plain")).toBe("شكرا لطلبك");
  });

  it("splits long encoded words on character boundaries (never inside an Arabic letter)", () => {
    const text = "ع".repeat(100) + "😀".repeat(20);
    const encoded = encodeWords(text);
    const words = encoded.split("\r\n ");
    expect(words.length).toBeGreaterThan(2);
    for (const word of words) expect(word.length).toBeLessThanOrEqual(75);
    const back = words
      .map((w) =>
        Buffer.from(/^=\?UTF-8\?B\?(.*)\?=$/.exec(w)?.[1] ?? "", "base64").toString("utf8"),
      )
      .join("");
    expect(back).toBe(text);
    expect(back).not.toContain("\uFFFD");
  });

  it("derives Message-ID from the idempotency key: a retry has the same id", () => {
    const now = new Date("2026-11-26T10:00:00.000Z");
    const first = buildMail(MESSAGE, now);
    const retry = buildMail(MESSAGE, new Date("2026-11-26T10:05:00.000Z"));
    const other = buildMail({ ...MESSAGE, idempotencyKey: "ntf_2:attempt:1" }, now);
    expect(retry.messageId).toBe(first.messageId);
    expect(other.messageId).not.toBe(first.messageId);
    expect(first.messageId).toMatch(/^<[0-9a-f]{32}@gmail\.test>$/);
    const { idempotencyKey: _omit, ...withoutKey } = MESSAGE;
    expect(buildMail(withoutKey, now).messageId).not.toBe(buildMail(withoutKey, now).messageId);
  });

  it("parses the From header the way formatFrom writes it", () => {
    expect(parseFromHeader('"Nusuj Store" <shop@gmail.test>')).toEqual({
      name: "Nusuj Store",
      address: "shop@gmail.test",
    });
    expect(parseFromHeader("<shop@gmail.test>")).toEqual({ name: "", address: "shop@gmail.test" });
    expect(parseFromHeader("shop@gmail.test")).toEqual({ name: "", address: "shop@gmail.test" });
    expect(() => parseFromHeader("not an address")).toThrow(SmtpClientError);
  });
});
