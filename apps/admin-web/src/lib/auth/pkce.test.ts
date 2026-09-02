import { describe, expect, it } from "vitest";
import { deriveCodeChallenge, generateCodeVerifier } from "./pkce";

/**
 * G0-2 (launch-readiness review) — pkce.ts had zero test coverage despite being the codebase's
 * only cryptographic code path in admin-web. A silently-wrong base64url encoding or a swapped
 * digest algorithm would make every login attempt fail against a real Hydra (safe but broken), or
 * — worse — make PKCE appear wired while contributing no actual protection. Both failure modes
 * are invisible without a test that pins the exact output shape RFC 7636 requires.
 */
describe("generateCodeVerifier", () => {
  it("produces a string in RFC 7636 §4.1's valid length range (43–128 chars)", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it("uses only RFC 7636 §4.1's unreserved character set (base64url, no padding)", () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(verifier).not.toContain("=");
    expect(verifier).not.toContain("+");
    expect(verifier).not.toContain("/");
  });

  it("is fresh on every call — never reuses a verifier across flows", () => {
    const first = generateCodeVerifier();
    const second = generateCodeVerifier();
    expect(first).not.toBe(second);
  });
});

describe("deriveCodeChallenge", () => {
  it("matches RFC 7636 Appendix B's published S256 test vector exactly", async () => {
    // The exact verifier/challenge pair the RFC itself uses to illustrate S256 — the strongest
    // possible check: it fails if the digest algorithm, the encoding, or the padding stripping is
    // wrong in any way, not just if the function is internally self-consistent.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await deriveCodeChallenge(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("is deterministic — the same verifier always derives the same challenge", async () => {
    const verifier = generateCodeVerifier();
    const first = await deriveCodeChallenge(verifier);
    const second = await deriveCodeChallenge(verifier);
    expect(first).toBe(second);
  });

  it("produces a base64url string with no padding, matching the verifier's own character set", async () => {
    const challenge = await deriveCodeChallenge(generateCodeVerifier());
    expect(challenge).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(challenge).not.toContain("=");
  });

  it("derives a different challenge for a different verifier — not a constant fallback", async () => {
    const a = await deriveCodeChallenge(generateCodeVerifier());
    const b = await deriveCodeChallenge(generateCodeVerifier());
    expect(a).not.toBe(b);
  });
});
