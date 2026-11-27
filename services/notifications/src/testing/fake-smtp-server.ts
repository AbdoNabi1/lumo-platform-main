import net from "node:net";
import tls from "node:tls";
import type { TestCertificate } from "./self-signed-cert";

/**
 * TEST ONLY. A small but real SMTP server on node:net / node:tls: implicit TLS (465 style) or
 * STARTTLS (587 style), AUTH PLAIN / LOGIN, MAIL / RCPT / DATA with dot-unstuffing. Any reply can be
 * scripted to exercise the client's failure paths. It records what it saw, including whether each
 * AUTH arrived over an encrypted socket.
 */

export interface ReceivedMail {
  readonly mailFrom: string;
  readonly rcptTo: readonly string[];
  /** The message exactly as the server read it, after removing the dot-stuffing. */
  readonly data: string;
  /** The same data as it was on the wire (dot-stuffed), to prove the client stuffed it. */
  readonly wireData: string;
}

export interface FakeSmtpOptions {
  readonly mode: "tls" | "starttls";
  readonly certificate: TestCertificate;
  /** Mechanisms advertised after TLS. Default PLAIN and LOGIN. */
  readonly mechanisms?: readonly string[];
  readonly credentials?: { readonly user: string; readonly pass: string };
  /** Advertise AUTH even before TLS (to prove the client never uses it). */
  readonly advertiseAuthBeforeTls?: boolean;
  /** Do not offer STARTTLS in EHLO (a downgrade attempt). */
  readonly hideStartTls?: boolean;
  /** Scripted replies, each one full reply text including the code (e.g. "550 5.4.5 limit"). */
  readonly replies?: {
    readonly greeting?: string;
    readonly plain?: string;
    readonly authLoginUser?: string;
    readonly mailFrom?: string;
    readonly rcptTo?: string;
    readonly dataEnd?: string;
  };
  /** Never answer the greeting: the client must time out. */
  readonly silent?: boolean;
}

export interface FakeSmtpServer {
  readonly port: number;
  readonly received: ReceivedMail[];
  /** Every command line seen, in order (AUTH payloads are masked). */
  readonly commands: string[];
  /** For each AUTH attempt: was the socket encrypted when it arrived? */
  readonly authSecure: boolean[];
  readonly connections: () => number;
  close(): Promise<void>;
}

const CRLF = "\r\n";

export async function startFakeSmtpServer(options: FakeSmtpOptions): Promise<FakeSmtpServer> {
  const received: ReceivedMail[] = [];
  const commands: string[] = [];
  const authSecure: boolean[] = [];
  const sockets = new Set<net.Socket>();
  let connectionCount = 0;
  const tlsOptions = { key: options.certificate.key, cert: options.certificate.cert };
  const mechanisms = options.mechanisms ?? ["PLAIN", "LOGIN"];

  function handle(socket: net.Socket, startSecure: boolean): void {
    connectionCount += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    let active: net.Socket = socket;
    let secure = startSecure;
    let buffer = "";
    let mailFrom = "";
    let rcptTo: string[] = [];
    let inData = false;
    let authStep: null | "login-user" | "login-pass" = null;
    let loginUser = "";

    const reply = (text: string): void => {
      active.write(text.endsWith(CRLF) ? text : `${text}${CRLF}`);
    };

    function onLine(line: string): void {
      if (authStep === "login-user") {
        loginUser = Buffer.from(line, "base64").toString("utf8");
        authStep = "login-pass";
        reply("334 UGFzc3dvcmQ6");
        return;
      }
      if (authStep === "login-pass") {
        authStep = null;
        finishAuth(loginUser, Buffer.from(line, "base64").toString("utf8"));
        return;
      }
      const upper = line.toUpperCase();
      commands.push(upper.startsWith("AUTH") ? "AUTH ***" : line);
      if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
        const lines = ["250-localhost", "250-SIZE 10485760"];
        if (!secure && options.mode === "starttls" && options.hideStartTls !== true) {
          lines.push("250-STARTTLS");
        }
        if (secure || options.advertiseAuthBeforeTls === true) {
          lines.push(`250-AUTH ${mechanisms.join(" ")}`);
        }
        lines.push("250 8BITMIME");
        reply(lines.join(CRLF));
      } else if (upper === "STARTTLS") {
        reply("220 2.0.0 Ready to start TLS");
        active.removeAllListeners("data");
        const wrapped = new tls.TLSSocket(active, { ...tlsOptions, isServer: true });
        wrapped.on("error", () => undefined);
        sockets.add(wrapped);
        active = wrapped;
        secure = true;
        buffer = "";
        wrapped.on("data", onData);
      } else if (upper.startsWith("AUTH PLAIN")) {
        authSecure.push(secure);
        if (!mechanisms.includes("PLAIN")) {
          reply("504 5.5.4 Unrecognized authentication type");
          return;
        }
        if (options.replies?.plain !== undefined) {
          reply(options.replies.plain);
          return;
        }
        const [, user = "", pass = ""] = Buffer.from(line.split(" ")[2] ?? "", "base64")
          .toString("utf8")
          .split("\0");
        finishAuth(user, pass);
      } else if (upper === "AUTH LOGIN") {
        authSecure.push(secure);
        if (!mechanisms.includes("LOGIN")) {
          reply("504 5.5.4 Unrecognized authentication type");
          return;
        }
        authStep = "login-user";
        reply(options.replies?.authLoginUser ?? "334 VXNlcm5hbWU6");
      } else if (upper.startsWith("MAIL FROM:")) {
        mailFrom = line.slice(10).trim();
        reply(options.replies?.mailFrom ?? "250 2.1.0 OK");
      } else if (upper.startsWith("RCPT TO:")) {
        rcptTo.push(line.slice(8).trim());
        reply(options.replies?.rcptTo ?? "250 2.1.5 OK");
      } else if (upper === "DATA") {
        inData = true;
        reply("354 Go ahead");
      } else if (upper === "QUIT") {
        reply("221 2.0.0 Bye");
        active.end();
      } else if (upper === "RSET" || upper === "NOOP") {
        reply("250 OK");
      } else {
        reply("502 5.5.2 Command not recognized");
      }
    }

    function finishAuth(user: string, pass: string): void {
      const expected = options.credentials;
      if (expected === undefined || (user === expected.user && pass === expected.pass)) {
        reply("235 2.7.0 Accepted");
      } else {
        reply("535 5.7.8 Username and Password not accepted");
      }
    }

    function onData(chunk: Buffer): void {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf(`${CRLF}.${CRLF}`);
          if (end === -1) return;
          const wireData = buffer.slice(0, end + 2);
          buffer = buffer.slice(end + 5);
          inData = false;
          const data = wireData
            .split(CRLF)
            .map((line) => (line.startsWith("..") ? line.slice(1) : line))
            .join(CRLF);
          received.push({ mailFrom, rcptTo: [...rcptTo], data, wireData });
          mailFrom = "";
          rcptTo = [];
          reply(options.replies?.dataEnd ?? "250 2.0.0 OK queued");
          continue;
        }
        const lineEnd = buffer.indexOf(CRLF);
        if (lineEnd === -1) return;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        onLine(line);
      }
    }

    socket.on("data", onData);
    if (options.silent !== true) reply(options.replies?.greeting ?? "220 localhost ESMTP ready");
  }

  const server =
    options.mode === "tls"
      ? tls.createServer(tlsOptions, (socket) => handle(socket, true))
      : net.createServer((socket) => handle(socket, false));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");

  return {
    port: address.port,
    received,
    commands,
    authSecure,
    connections: () => connectionCount,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
