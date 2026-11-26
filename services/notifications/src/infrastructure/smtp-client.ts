import { createHash, randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import net, { isIP } from "node:net";
import tls from "node:tls";

/**
 * Wave 2b2 Task 3 (D52): a small SMTP client on `node:net` / `node:tls` and nothing else. It sends ONE
 * mail through the MERCHANT's own mailbox (Gmail app password, Outlook, Zoho or any server).
 *
 * Safety rules, each with a test:
 * - Certificates are always verified (`rejectUnauthorized: true`). Tests inject their own CA; nothing
 *   switches checking off.
 * - AUTH is never sent over a socket that is not encrypted. `starttls` with a server that does not
 *   offer STARTTLS is a failure, never a plain-text fallback.
 * - Every header value is checked: a CR, LF or NUL anywhere refuses the mail (no header injection).
 * - The server's own text is never kept: failures are one of five fixed codes.
 * - The host must resolve to a public address (a merchant must not be able to point this at the
 *   platform's private network); one overall timeout covers the whole conversation.
 */

export type SmtpSecurity = "tls" | "starttls";

export type SmtpFailureCode =
  "AUTH_FAILED" | "DAILY_LIMIT" | "CONNECTION_FAILED" | "TLS_FAILED" | "REJECTED";

/** The only thing a failure carries: its code. The message IS the code, so nothing else can leak. */
export class SmtpClientError extends Error {
  readonly code: SmtpFailureCode;
  constructor(code: SmtpFailureCode) {
    super(code);
    this.name = "SmtpClientError";
    this.code = code;
  }
}

export interface SmtpEndpoint {
  readonly host: string;
  readonly port: number;
  readonly security: SmtpSecurity;
  readonly username: string;
  readonly password: string;
}

export interface SmtpMessage {
  /** `"Name" <address>`, `<address>` or a bare address. */
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** Message-ID is derived from it, so a retry of the same mail carries the same id. */
  readonly idempotencyKey?: string;
}

export interface SmtpClientOptions {
  /** Overall budget for connect + TLS + AUTH + send + QUIT. Default 20 s. */
  readonly timeoutMs?: number;
  /** Extra trusted CA(s). Tests only; production uses the platform's default roots. */
  readonly ca?: string | Buffer | readonly (string | Buffer)[];
  /** Resolves the host to the one address to connect to. Default: DNS + public-address check. */
  readonly resolveHost?: (host: string) => Promise<string>;
  /** EHLO name; default is the sender's own domain. */
  readonly clientName?: string;
  readonly now?: () => Date;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_REPLY_BYTES = 64 * 1024;
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const CRLF = "\r\n";

// ---------------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------------

/** True for loopback, private, link-local, carrier-grade NAT, reserved and multicast addresses. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped?.[1] !== undefined) return isPrivateAddress(mapped[1]);
    return (
      lower === "::" ||
      lower === "::1" ||
      /^f[cd]/.test(lower) ||
      /^fe[89ab]/.test(lower) ||
      lower.startsWith("ff") ||
      lower.startsWith("2001:db8")
    );
  }
  return true;
}

async function resolvePublicHost(host: string): Promise<string> {
  let address: string;
  try {
    address = (await dnsLookup(host)).address;
  } catch {
    throw new SmtpClientError("CONNECTION_FAILED");
  }
  if (isPrivateAddress(address)) throw new SmtpClientError("CONNECTION_FAILED");
  return address;
}

const ADDRESS_PATTERN =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

function refuse(): never {
  throw new SmtpClientError("REJECTED");
}

/** CR, LF, NUL and every other control character are refused in anything that becomes a header. */
export function assertHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000A-\u001F\u007F]/.test(value)) refuse();
  return value;
}

export interface ParsedFrom {
  readonly name: string;
  readonly address: string;
}

export function parseFromHeader(from: string): ParsedFrom {
  assertHeaderValue(from);
  const match = /^\s*(?:"([^"]*)"|([^<>"]*?))?\s*<([^<>\s]+)>\s*$/.exec(from);
  const address = match?.[3] ?? from.trim();
  const name = (match?.[1] ?? match?.[2] ?? "").trim();
  if (!ADDRESS_PATTERN.test(address)) refuse();
  return { name: assertHeaderValue(name), address };
}

function parseRecipient(to: string): string {
  assertHeaderValue(to);
  const address = to.trim();
  if (!ADDRESS_PATTERN.test(address)) refuse();
  return address;
}

// ---------------------------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------------------------

/** RFC 2047 `=?UTF-8?B?...?=` words, each short enough (<= 68 chars, so a header line stays under 78), joined by a folded line. */
export function encodeWords(text: string): string {
  const words: string[] = [];
  let chunk = "";
  const flush = (): void => {
    if (chunk !== "") words.push(`=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`);
    chunk = "";
  };
  for (const char of text) {
    if (Buffer.byteLength(chunk + char, "utf8") > 40) flush();
    chunk += char;
  }
  flush();
  return words.join(`${CRLF} `);
}

const PLAIN_TEXT = /^[\u0020-\u007E]*$/;

function encodeSubject(subject: string): string {
  assertHeaderValue(subject);
  if (subject.length > 900) refuse();
  return PLAIN_TEXT.test(subject) ? subject : encodeWords(subject);
}

function encodeDisplayName(name: string): string {
  if (name === "") return "";
  if (PLAIN_TEXT.test(name)) return `"${name.replace(/["\\]/g, " ")}" `;
  return `${encodeWords(name)} `;
}

function wrapBase64(text: string): string {
  const encoded = Buffer.from(text, "utf8").toString("base64");
  return (encoded.match(/.{1,76}/g) ?? [""]).join(CRLF);
}

/** Message-Date in RFC 5322 form with a numeric zone. */
export function formatDate(date: Date): string {
  return date.toUTCString().replace("GMT", "+0000");
}

export interface BuiltMail {
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly mime: string;
  readonly messageId: string;
}

/**
 * Builds the whole RFC 5322 message: Date, From, To, Subject (RFC 2047 when not plain ASCII),
 * Message-ID derived from the idempotency key, multipart/alternative with base64 text and html.
 */
export function buildMail(message: SmtpMessage, now: Date): BuiltMail {
  const from = parseFromHeader(message.from);
  const toAddress = parseRecipient(message.to);
  const subject = encodeSubject(message.subject);
  const seed = message.idempotencyKey ?? randomUUID();
  assertHeaderValue(seed);
  const digest = createHash("sha256").update(seed, "utf8").digest("hex");
  const domain = from.address.split("@")[1] ?? "localhost";
  const messageId = `<${digest.slice(0, 32)}@${domain}>`;
  const boundary = `=_morbeh_${digest.slice(32, 56)}`;
  const headers = [
    `Date: ${formatDate(now)}`,
    `From: ${encodeDisplayName(from.name)}<${from.address}>`,
    `To: <${toAddress}>`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative;${CRLF} boundary="${boundary}"`,
  ];
  const part = (type: string, body: string): string =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset=utf-8`,
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(body),
    ].join(CRLF);
  const mime = [
    ...headers,
    "",
    part("text/plain", message.text),
    part("text/html", message.html),
    `--${boundary}--`,
    "",
  ].join(CRLF);
  if (Buffer.byteLength(mime, "utf8") > MAX_MESSAGE_BYTES) refuse();
  return { fromAddress: from.address, toAddress, mime, messageId };
}

/** A line that starts with "." gets a second one, so the end-of-data marker can't be forged. */
export function dotStuff(data: string): string {
  return data.replace(/(^|\r\n)\./g, "$1..");
}

// ---------------------------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------------------------

interface Reply {
  readonly code: number;
  readonly text: string;
}

const CERTIFICATE_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED",
  "CERT_REVOKED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
]);

function classifySocketError(error: unknown, tlsPhase: boolean): SmtpClientError {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (CERTIFICATE_CODES.has(code) || code.startsWith("ERR_SSL") || code.startsWith("ERR_TLS")) {
    return new SmtpClientError("TLS_FAILED");
  }
  if (tlsPhase && code !== "ETIMEDOUT" && code !== "ECONNREFUSED" && code !== "ENOTFOUND") {
    return new SmtpClientError("TLS_FAILED");
  }
  return new SmtpClientError("CONNECTION_FAILED");
}

/** Maps a refusal to a fixed code from the numeric reply only. The server's text is never kept. */
function classifyReply(phase: "auth" | "other", reply: Reply): SmtpClientError {
  const { code, text } = reply;
  if ((code === 550 && /\b5\.4\.5\b/.test(text)) || (code === 421 && /\b4\.7\.0\b/.test(text))) {
    return new SmtpClientError("DAILY_LIMIT");
  }
  if (/daily (?:user )?sending (?:limit|quota)/i.test(text))
    return new SmtpClientError("DAILY_LIMIT");
  if (phase === "auth") {
    return new SmtpClientError(code >= 500 ? "AUTH_FAILED" : "CONNECTION_FAILED");
  }
  if (code === 421) return new SmtpClientError("CONNECTION_FAILED");
  return new SmtpClientError("REJECTED");
}

class Session {
  private socket: net.Socket;
  private buffer = "";
  private failure: SmtpClientError | null = null;
  private waiter: {
    resolve: (reply: Reply) => void;
    reject: (error: SmtpClientError) => void;
  } | null = null;
  private readonly onData = (chunk: Buffer): void => {
    this.buffer += chunk.toString("utf8");
    if (this.buffer.length > MAX_REPLY_BYTES) this.fail(new SmtpClientError("CONNECTION_FAILED"));
    else this.drain();
  };
  private readonly onClose = (): void => this.fail(new SmtpClientError("CONNECTION_FAILED"));
  private readonly onError = (error: unknown): void => this.fail(classifySocketError(error, false));
  secure: boolean;

  constructor(socket: net.Socket, secure: boolean) {
    this.socket = socket;
    this.secure = secure;
    this.listen(socket);
  }

  private listen(socket: net.Socket): void {
    socket.on("data", this.onData);
    socket.on("close", this.onClose);
    socket.on("error", this.onError);
  }

  private unlisten(socket: net.Socket): void {
    socket.off("data", this.onData);
    socket.off("close", this.onClose);
    socket.off("error", this.onError);
  }

  fail(error: SmtpClientError): void {
    if (this.failure === null) this.failure = error;
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(this.failure);
    this.socket.destroy();
  }

  /** The next complete reply (a multi-line reply ends at the line with a space after the code). */
  private parse(): Reply | null {
    const lines = this.buffer.split(CRLF);
    if (lines.length < 2) return null;
    const collected: string[] = [];
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index] ?? "";
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (match === null) throw new SmtpClientError("CONNECTION_FAILED");
      collected.push(match[3] ?? "");
      if (match[2] === " ") {
        this.buffer = lines.slice(index + 1).join(CRLF);
        return { code: Number(match[1]), text: collected.join("\n") };
      }
    }
    return null;
  }

  private drain(): void {
    if (this.waiter === null) return;
    let reply: Reply | null;
    try {
      reply = this.parse();
    } catch (error) {
      this.fail(
        error instanceof SmtpClientError ? error : new SmtpClientError("CONNECTION_FAILED"),
      );
      return;
    }
    if (reply === null) return;
    const waiter = this.waiter;
    this.waiter = null;
    waiter.resolve(reply);
  }

  readReply(): Promise<Reply> {
    return new Promise<Reply>((resolve, reject) => {
      if (this.waiter !== null) throw new Error("one reader at a time");
      this.waiter = { resolve, reject };
      let buffered: Reply | null = null;
      try {
        buffered = this.parse();
      } catch (error) {
        this.waiter = null;
        reject(error instanceof SmtpClientError ? error : new SmtpClientError("CONNECTION_FAILED"));
        return;
      }
      if (buffered !== null) {
        this.waiter = null;
        resolve(buffered);
      } else if (this.failure !== null) {
        this.waiter = null;
        reject(this.failure);
      }
    });
  }

  write(text: string): void {
    if (this.failure !== null) throw this.failure;
    this.socket.write(text);
  }

  /** Sends a command and returns the reply. */
  async command(line: string): Promise<Reply> {
    this.write(`${line}${CRLF}`);
    return this.readReply();
  }

  /** Stops reading the plain socket so the TLS wrapper alone owns it from here on. */
  detachForUpgrade(): void {
    this.unlisten(this.socket);
    this.socket.on("error", () => undefined);
  }

  /** Swaps the plain socket for its TLS-wrapped successor (STARTTLS). */
  upgrade(secureSocket: tls.TLSSocket): void {
    this.socket = secureSocket;
    this.buffer = "";
    this.secure = true;
    this.listen(secureSocket);
  }

  hasBufferedBytes(): boolean {
    return this.buffer.length > 0;
  }

  close(): void {
    this.unlisten(this.socket);
    this.socket.on("error", () => undefined);
    this.socket.destroy();
  }

  endGracefully(): void {
    try {
      this.socket.end();
    } catch {
      // The mail is already accepted: nothing here may turn into a failure.
    }
  }
}

function connectPlain(address: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: address, port });
    socket.once("connect", () => {
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", (error) => {
      socket.destroy();
      reject(classifySocketError(error, false));
    });
  });
}

function connectTls(options: tls.ConnectionOptions): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      ...options,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    });
    socket.once("secureConnect", () => {
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", (error) => {
      socket.destroy();
      reject(classifySocketError(error, true));
    });
  });
}

function tlsOptions(endpoint: SmtpEndpoint, options: SmtpClientOptions): tls.ConnectionOptions {
  return {
    ...(isIP(endpoint.host) === 0 ? { servername: endpoint.host } : {}),
    ...(options.ca === undefined ? {} : { ca: options.ca as tls.ConnectionOptions["ca"] }),
  };
}

async function authenticate(
  session: Session,
  offered: readonly string[],
  endpoint: SmtpEndpoint,
): Promise<void> {
  // The one rule that must never bend: no credentials over a socket that is not encrypted.
  if (!session.secure) throw new SmtpClientError("TLS_FAILED");
  const mechanisms = offered.map((m) => m.toUpperCase());
  const canPlain = mechanisms.includes("PLAIN");
  const canLogin = mechanisms.includes("LOGIN");
  if (!canPlain && !canLogin) throw new SmtpClientError("REJECTED");

  if (canPlain) {
    const token = Buffer.from(`\0${endpoint.username}\0${endpoint.password}`, "utf8").toString(
      "base64",
    );
    const reply = await session.command(`AUTH PLAIN ${token}`);
    if (reply.code === 235) return;
    // Only an unsupported mechanism falls through to LOGIN: wrong credentials are final (retrying
    // them would just count as another failed sign-in).
    const unsupported =
      reply.code === 504 || reply.code === 502 || reply.code === 500 || reply.code === 501;
    if (!unsupported || !canLogin) throw classifyReply("auth", reply);
  }

  const start = await session.command("AUTH LOGIN");
  if (start.code !== 334) throw classifyReply("auth", start);
  const user = await session.command(Buffer.from(endpoint.username, "utf8").toString("base64"));
  if (user.code !== 334) throw classifyReply("auth", user);
  const done = await session.command(Buffer.from(endpoint.password, "utf8").toString("base64"));
  if (done.code !== 235) throw classifyReply("auth", done);
}

function offeredMechanisms(ehlo: Reply): string[] {
  for (const line of ehlo.text.split("\n")) {
    const match = /^AUTH[ =](.+)$/i.exec(line.trim());
    if (match?.[1] !== undefined) return match[1].trim().split(/\s+/);
  }
  return [];
}

function offersStartTls(ehlo: Reply): boolean {
  return ehlo.text.split("\n").some((line) => line.trim().toUpperCase() === "STARTTLS");
}

async function converse(
  session: Session,
  endpoint: SmtpEndpoint,
  built: BuiltMail,
  options: SmtpClientOptions,
  upgrade: () => Promise<tls.TLSSocket>,
): Promise<void> {
  const greeting = await session.readReply();
  if (greeting.code !== 220) throw new SmtpClientError("CONNECTION_FAILED");

  const clientName = options.clientName ?? built.fromAddress.split("@")[1] ?? "localhost";
  let ehlo = await session.command(`EHLO ${clientName}`);
  if (ehlo.code !== 250) throw classifyReply("other", ehlo);

  if (endpoint.security === "starttls") {
    if (!offersStartTls(ehlo)) throw new SmtpClientError("TLS_FAILED");
    const proceed = await session.command("STARTTLS");
    if (proceed.code !== 220) throw new SmtpClientError("TLS_FAILED");
    // Bytes that arrived before the handshake belong to the attacker, not the server: refuse them.
    if (session.hasBufferedBytes()) throw new SmtpClientError("TLS_FAILED");
    session.detachForUpgrade();
    session.upgrade(await upgrade());
    ehlo = await session.command(`EHLO ${clientName}`);
    if (ehlo.code !== 250) throw classifyReply("other", ehlo);
  }

  await authenticate(session, offeredMechanisms(ehlo), endpoint);

  const mailFrom = await session.command(`MAIL FROM:<${built.fromAddress}>`);
  if (mailFrom.code !== 250) throw classifyReply("other", mailFrom);
  const rcpt = await session.command(`RCPT TO:<${built.toAddress}>`);
  if (rcpt.code !== 250 && rcpt.code !== 251) throw classifyReply("other", rcpt);
  const data = await session.command("DATA");
  if (data.code !== 354) throw classifyReply("other", data);
  const body = dotStuff(built.mime);
  session.write(`${body}${body.endsWith(CRLF) ? "" : CRLF}.${CRLF}`);
  const accepted = await session.readReply();
  if (accepted.code !== 250) throw classifyReply("other", accepted);
}

/**
 * Sends one mail through the merchant's mailbox. Resolves when the server accepted it; throws a
 * {@link SmtpClientError} (one of five fixed codes) otherwise. Never logs and never throws anything
 * that contains the password, the address or the server's own text.
 */
export async function sendSmtpMail(
  endpoint: SmtpEndpoint,
  message: SmtpMessage,
  options: SmtpClientOptions = {},
): Promise<void> {
  const built = buildMail(message, (options.now ?? (() => new Date()))());
  assertHeaderValue(endpoint.host);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let session: Session | null = null;
  let plainSocket: net.Socket | null = null;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      session?.fail(new SmtpClientError("CONNECTION_FAILED"));
      plainSocket?.destroy();
      reject(new SmtpClientError("CONNECTION_FAILED"));
    }, timeoutMs);
  });
  deadline.catch(() => undefined);

  const run = async (): Promise<void> => {
    const address = await (options.resolveHost ?? resolvePublicHost)(endpoint.host);
    if (endpoint.security === "tls") {
      const socket = await connectTls({
        host: address,
        port: endpoint.port,
        ...tlsOptions(endpoint, options),
      });
      plainSocket = socket;
      session = new Session(socket, true);
    } else {
      const socket = await connectPlain(address, endpoint.port);
      plainSocket = socket;
      session = new Session(socket, false);
    }
    const active = session;
    await converse(active, endpoint, built, options, async () => {
      const upgraded = await connectTls({
        socket: plainSocket as net.Socket,
        ...tlsOptions(endpoint, options),
      });
      plainSocket = upgraded;
      return upgraded;
    });
    // Accepted. QUIT is courtesy: whatever happens next cannot undo the delivery.
    try {
      active.write(`QUIT${CRLF}`);
      await Promise.race([active.readReply(), new Promise((resolve) => setTimeout(resolve, 1000))]);
    } catch {
      // The server hung up first: fine.
    }
    active.endGracefully();
  };

  try {
    await Promise.race([run(), deadline]);
  } catch (error) {
    throw error instanceof SmtpClientError
      ? new SmtpClientError(error.code)
      : new SmtpClientError("CONNECTION_FAILED");
  } finally {
    clearTimeout(timer);
    (session as Session | null)?.close();
    (plainSocket as net.Socket | null)?.destroy();
  }
}
