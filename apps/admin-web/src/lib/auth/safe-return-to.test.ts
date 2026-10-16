import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./safe-return-to";

/**
 * H-01 (audit) — the OAuth callback used `new URL(returnTo, origin)` on an unvalidated
 * `RETURN_TO_COOKIE` value with no same-origin check, so an absolute or protocol-relative value
 * redirected the browser off-site immediately after a successful login. These are exactly the
 * shapes that must collapse to the safe "/" default.
 */
describe("safeReturnTo", () => {
  const origin = "https://admin.morbeh.example.com";

  it("passes through a same-origin root-relative path unchanged", () => {
    expect(safeReturnTo("/orders/123", origin)).toBe("/orders/123");
  });

  it("passes through a root-relative path with a query string", () => {
    expect(safeReturnTo("/orders?status=open", origin)).toBe("/orders?status=open");
  });

  it("falls back to / when the cookie is absent", () => {
    expect(safeReturnTo(undefined, origin)).toBe("/");
  });

  it("rejects an absolute URL to another origin", () => {
    expect(safeReturnTo("https://evil.com", origin)).toBe("/");
    expect(safeReturnTo("https://evil.com/orders", origin)).toBe("/");
  });

  it("rejects a protocol-relative URL (//host resolves to a different origin)", () => {
    expect(safeReturnTo("//evil.com", origin)).toBe("/");
    expect(safeReturnTo("//evil.com/path", origin)).toBe("/");
  });

  it("rejects a backslash-prefixed value (browsers normalize \\ to / for scheme-relative hosts)", () => {
    expect(safeReturnTo("/\\evil.com", origin)).toBe("/");
  });

  it("rejects a value that does not start with /", () => {
    expect(safeReturnTo("evil.com", origin)).toBe("/");
    expect(safeReturnTo("javascript:alert(1)", origin)).toBe("/");
  });

  it("rejects a same-origin-looking value that actually re-encodes to another host", () => {
    // A literal backslash survives into new URL()'s parsing as a path separator equivalent to
    // "/", which is exactly the case the dedicated "/\\" check above exists to catch before this
    // fallback URL-parse check ever runs.
    expect(safeReturnTo("/\\\\evil.com/x", origin)).toBe("/");
  });
});
