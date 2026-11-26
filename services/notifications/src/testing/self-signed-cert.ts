import { generateKeyPairSync, sign, X509Certificate } from "node:crypto";

/**
 * TEST ONLY. Makes a throw-away, self-signed ECDSA P-256 certificate for `localhost` / 127.0.0.1 at
 * test time, so the SMTP suites need no private key committed to the repository. The certificate is
 * handed to the client as its trusted `ca`, which is exactly how the real certificate checks run:
 * nothing about verification is switched off.
 *
 * Only the few DER shapes an X.509 v3 certificate needs are implemented (node:crypto can parse
 * certificates but not create them).
 */

function length(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let value = n; value > 0; value = Math.floor(value / 256)) bytes.unshift(value & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, ...parts: readonly Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
}

const seq = (...parts: readonly Buffer[]): Buffer => tlv(0x30, ...parts);

function integer(value: number): Buffer {
  const bytes: number[] = [];
  for (let n = value; n > 0; n = Math.floor(n / 256)) bytes.unshift(n & 0xff);
  if (bytes.length === 0) bytes.push(0);
  if ((bytes[0] ?? 0) & 0x80) bytes.unshift(0);
  return tlv(0x02, Buffer.from(bytes));
}

function oid(dotted: string): Buffer {
  const arcs = dotted.split(".").map(Number);
  const out: number[] = [40 * (arcs[0] ?? 0) + (arcs[1] ?? 0)];
  for (const arc of arcs.slice(2)) {
    const chunk: number[] = [arc & 0x7f];
    for (let n = Math.floor(arc / 128); n > 0; n = Math.floor(n / 128))
      chunk.unshift((n & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

function utcTime(date: Date): Buffer {
  const p = (n: number): string => String(n).padStart(2, "0");
  const text = `${p(date.getUTCFullYear() % 100)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(text, "ascii"));
}

function pem(label: string, der: Buffer): string {
  const lines = der.toString("base64").match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

export interface TestCertificate {
  readonly key: string;
  readonly cert: string;
}

/** A fresh certificate valid for `localhost` and 127.0.0.1, for about two days. */
export function makeSelfSignedCertificate(commonName = "localhost"): TestCertificate {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const ecdsaSha256 = seq(oid("1.2.840.10045.4.3.2"));
  const name = seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, Buffer.from(commonName)))));
  const now = Date.now();
  const validity = seq(
    utcTime(new Date(now - 24 * 3600_000)),
    utcTime(new Date(now + 48 * 3600_000)),
  );
  const san = seq(tlv(0x82, Buffer.from("localhost")), tlv(0x87, Buffer.from([127, 0, 0, 1])));
  const extensions = tlv(
    0xa3,
    seq(
      seq(oid("2.5.29.17"), tlv(0x04, san)),
      seq(
        oid("2.5.29.19"),
        tlv(0x01, Buffer.from([0xff])),
        tlv(0x04, seq(tlv(0x01, Buffer.from([0xff])))),
      ),
    ),
  );
  const tbs = seq(
    tlv(0xa0, integer(2)),
    integer(Math.floor(Math.random() * 0x7fffffff) + 1),
    ecdsaSha256,
    name,
    validity,
    name,
    publicKey.export({ type: "spki", format: "der" }),
    extensions,
  );
  const signature = sign("sha256", tbs, { key: privateKey, dsaEncoding: "der" });
  const cert = seq(tbs, ecdsaSha256, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const certPem = pem("CERTIFICATE", cert);
  // Fail loudly if the hand-built DER is ever wrong, instead of with an opaque TLS error later.
  new X509Certificate(certPem);
  return {
    key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    cert: certPem,
  };
}
