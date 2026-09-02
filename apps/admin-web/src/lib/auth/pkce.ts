/**
 * L-03 (audit) — PKCE (RFC 7636, S256 method only; the `plain` method exists in the spec purely
 * for constrained clients that cannot compute SHA-256 and has no place here). Web Crypto only
 * (`crypto.getRandomValues`, `crypto.subtle.digest`, `TextEncoder`, `btoa`) — no Node-only APIs —
 * so this is safe to import from BOTH `middleware.ts` (Next.js Edge runtime) and the Node-only
 * `auth/callback/route.ts`; Node 22 (this repo's pinned version) exposes the same Web Crypto
 * globals natively, so there is no dual implementation to keep in sync.
 */

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A fresh, high-entropy `code_verifier` (RFC 7636 §4.1: 43–128 chars from its unreserved set; 32 random bytes base64url-encode to 43). */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** `code_challenge = BASE64URL(SHA256(code_verifier))` — RFC 7636 §4.2, method S256. */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}
