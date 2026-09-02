import { createHash, createHmac } from "node:crypto";

/**
 * AWS **Signature Version 4** request signing (H-3 / G-SEC-2) — the exact algorithm AWS specifies, built
 * on `node:crypto` only (no AWS SDK, honouring the dependency freeze; the same "bind vendors with
 * primitives, not SDKs" discipline as the Ory HTTP clients). Isolated + pure so it is unit-testable
 * against AWS's published SigV4 test vectors and reused by the AWS KMS adapter without leaking signing
 * concerns into it. Credentials are used to derive the signing key and never logged.
 */

const ALGORITHM = "AWS4-HMAC-SHA256";

export interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** STS session token for temporary credentials (adds `X-Amz-Security-Token`). */
  readonly sessionToken?: string;
}

export interface SignAwsRequestInput {
  readonly method: string;
  readonly host: string;
  /** Canonical resource path (KMS uses `/`). Must start with `/`. */
  readonly path: string;
  /** Query parameters (empty for KMS POST). */
  readonly query?: Readonly<Record<string, string>>;
  /** Request headers to sign (host + x-amz-date are added/enforced here). */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly service: string;
  readonly region: string;
  readonly credentials: AwsCredentials;
  /** The signing instant; determines `X-Amz-Date` + the credential scope date. */
  readonly date: Date;
}

/** RFC 3986 encoding AWS requires (encodeURIComponent leaves `!'()*` unescaped). */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

/** `YYYYMMDDTHHMMSSZ` (amz date) — UTC, seconds precision, no separators. */
function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function canonicalQuery(query: Readonly<Record<string, string>>): string {
  return Object.keys(query)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k] ?? "")}`)
    .join("&");
}

/**
 * Signs a request and returns the headers to send (the original headers plus `Host`, `X-Amz-Date`,
 * optional `X-Amz-Security-Token`, and `Authorization`). Deterministic for a fixed `date`.
 */
export function signAwsRequest(input: SignAwsRequestInput): Record<string, string> {
  const amz = amzDate(input.date);
  const dateStamp = amz.slice(0, 8);
  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;

  // Canonical + signed headers (lowercased names, trimmed values, sorted) — always include host + date.
  const signedHeaderMap: Record<string, string> = { host: input.host, "x-amz-date": amz };
  for (const [name, value] of Object.entries(input.headers))
    signedHeaderMap[name.toLowerCase()] = value.trim();
  const sortedNames = Object.keys(signedHeaderMap).sort();
  const canonicalHeaders = sortedNames.map((n) => `${n}:${signedHeaderMap[n]}\n`).join("");
  const signedHeaders = sortedNames.join(";");

  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path,
    canonicalQuery(input.query ?? {}),
    canonicalHeaders,
    signedHeaders,
    sha256Hex(input.body),
  ].join("\n");

  const stringToSign = [ALGORITHM, amz, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${input.credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const authorization = `${ALGORITHM} Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    ...input.headers,
    Host: input.host,
    "X-Amz-Date": amz,
    ...(input.credentials.sessionToken !== undefined
      ? { "X-Amz-Security-Token": input.credentials.sessionToken }
      : {}),
    Authorization: authorization,
  };
}
