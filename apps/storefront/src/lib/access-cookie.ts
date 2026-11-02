import { MIN_SECRET_BYTES } from "./storefront-env";

export const ACCESS_COOKIE = "morbeh-storefront-access";
export const ACCESS_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const encoder = new TextEncoder();
/** A non-negative integer written the one canonical way (no sign, leading zero, exponent or space). */
const CANONICAL_INTEGER = /^(?:0|[1-9][0-9]{0,15})$/;

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  let binary = "";
  for (const byte of bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function key(secret: string): Promise<CryptoKey> {
  if (encoder.encode(secret).length < MIN_SECRET_BYTES)
    throw new Error("STOREFRONT_ACCESS_SECRET is too short");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

const payload = (shopId: string, accessVersion: number, expUnix: number) =>
  encoder.encode(`${shopId}|${accessVersion}|${expUnix}`);

/** Spec 1.5: `v1.<accessVersion>.<expUnix>.<base64url(HMAC-SHA256(secret, shopId|accessVersion|expUnix))>`. */
export async function signAccessCookie(input: {
  readonly secret: string;
  readonly shopId: string;
  readonly accessVersion: number;
  readonly expUnix: number;
}): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(input.secret),
    payload(input.shopId, input.accessVersion, input.expUnix),
  );
  return `v1.${input.accessVersion}.${input.expUnix}.${toBase64Url(signature)}`;
}

/**
 * Edge-safe; `crypto.subtle.verify` compares in constant time. No secret ⇒ nothing verifies (fail
 * closed). Only the one canonical spelling of a cookie is accepted (preflight 13): the numbers must be
 * written canonically and the signature must re-encode to exactly the text received, so the padding
 * bits of the last base64url character cannot be varied.
 */
export async function verifyAccessCookie(
  value: string | undefined,
  expected: {
    readonly secret: string | null;
    readonly shopId: string;
    readonly accessVersion: number;
    readonly nowUnix: number;
  },
): Promise<boolean> {
  if (value === undefined || expected.secret === null) return false;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const [, versionText = "", expText = "", mac = ""] = parts;
  if (!CANONICAL_INTEGER.test(versionText) || !CANONICAL_INTEGER.test(expText)) return false;
  const version = Number(versionText);
  const exp = Number(expText);
  if (version !== expected.accessVersion || exp <= expected.nowUnix) return false;
  const signature = fromBase64Url(mac);
  if (signature === null || toBase64Url(signature) !== mac) return false;
  try {
    return await crypto.subtle.verify(
      "HMAC",
      await key(expected.secret),
      signature,
      payload(expected.shopId, version, exp),
    );
  } catch {
    return false;
  }
}
