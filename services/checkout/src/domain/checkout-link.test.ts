import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BusinessRuleError, ValidationError } from "@platform/utils";
import {
  CheckoutLink,
  hashLinkToken,
  isWellFormedLinkToken,
  RECOVERY_LINK_TTL_MS,
} from "./checkout-link";

const NOW = new Date("2026-10-18T12:00:00.000Z");
const SESSION = "01920000-0000-7000-8000-000000000001";

function issueRecovery(now = NOW) {
  return CheckoutLink.issue({
    id: "01920000-0000-7000-8000-0000000000a1",
    purpose: "recovery",
    target: { checkoutSessionId: SESSION },
    createdBy: "staff-op",
    now,
    ttlMs: RECOVERY_LINK_TTL_MS,
  });
}

describe("CheckoutLink.issue", () => {
  it("mints a 32-byte base64url token (43 chars) and keeps only its SHA-256", () => {
    const { link, token } = issueRecovery();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(link.tokenHash).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
    expect(link.tokenHash).toBe(hashLinkToken(token));
    expect(JSON.stringify(link.snapshot())).not.toContain(token);
  });

  it("never mints the same token twice", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => issueRecovery().token));
    expect(tokens.size).toBe(50);
  });

  it("a recovery link points at its checkout, expires in 7 days and starts unclaimed", () => {
    const { link } = issueRecovery();
    expect(link.purpose).toBe("recovery");
    expect(link.checkoutSessionId).toBe(SESSION);
    expect(link.draftOrderRef).toBeNull();
    expect(link.expiresAt).toEqual(new Date("2026-10-25T12:00:00.000Z"));
    expect(link.claimCount).toBe(0);
    expect(link.lastClaimedAt).toBeNull();
    expect(link.resultCheckoutRef).toBeNull();
    expect(link.revokedAt).toBeNull();
    expect(link.createdBy).toBe("staff-op");
    expect(link.createdAt).toEqual(NOW);
    expect(link.isNew).toBe(true);
  });

  it("refuses a recovery link without a checkout, an invoice link without a draft, and a bad ttl", () => {
    const base = { id: "x", createdBy: "staff-op", now: NOW, ttlMs: RECOVERY_LINK_TTL_MS };
    expect(() =>
      CheckoutLink.issue({ ...base, purpose: "recovery", target: { draftOrderRef: "d-1" } }),
    ).toThrow(ValidationError);
    expect(() =>
      CheckoutLink.issue({ ...base, purpose: "invoice", target: { checkoutSessionId: SESSION } }),
    ).toThrow(ValidationError);
    expect(() =>
      CheckoutLink.issue({
        ...base,
        purpose: "recovery",
        target: { checkoutSessionId: SESSION },
        ttlMs: 0,
      }),
    ).toThrow(ValidationError);
    expect(() =>
      CheckoutLink.issue({
        ...base,
        purpose: "recovery",
        target: { checkoutSessionId: SESSION },
        createdBy: " ",
      }),
    ).toThrow(ValidationError);
  });
});

describe("CheckoutLink lifecycle", () => {
  it("is usable until the expiry instant, not at it", () => {
    const { link } = issueRecovery();
    expect(link.isUsable(new Date(link.expiresAt.getTime() - 1))).toBe(true);
    expect(link.isUsable(link.expiresAt)).toBe(false);
  });

  it("counts claims and remembers the session the last claim produced", () => {
    const { link } = issueRecovery();
    link.recordClaim(new Date("2026-10-19T00:00:00.000Z"), "result-1");
    link.recordClaim(new Date("2026-10-19T01:00:00.000Z"));
    expect(link.claimCount).toBe(2);
    expect(link.lastClaimedAt).toEqual(new Date("2026-10-19T01:00:00.000Z"));
    expect(link.resultCheckoutRef).toBe("result-1");
  });

  it("refuses a claim on an expired or revoked link", () => {
    const expired = issueRecovery().link;
    expect(() => expired.recordClaim(expired.expiresAt)).toThrow(BusinessRuleError);
    const revoked = issueRecovery().link;
    revoked.revoke(NOW);
    expect(revoked.isUsable(NOW)).toBe(false);
    expect(() => revoked.recordClaim(NOW)).toThrow(BusinessRuleError);
  });

  it("revoking twice keeps the first time", () => {
    const { link } = issueRecovery();
    link.revoke(new Date("2026-10-19T00:00:00.000Z"));
    link.revoke(new Date("2026-10-20T00:00:00.000Z"));
    expect(link.revokedAt).toEqual(new Date("2026-10-19T00:00:00.000Z"));
  });

  it("a reconstituted link is not new and keeps every field", () => {
    const { link } = issueRecovery();
    const loaded = CheckoutLink.reconstitute(link.snapshot());
    expect(loaded.isNew).toBe(false);
    expect(loaded.snapshot()).toEqual(link.snapshot());
  });
});

describe("isWellFormedLinkToken", () => {
  it("accepts a minted token and nothing else", () => {
    expect(isWellFormedLinkToken(issueRecovery().token)).toBe(true);
    expect(isWellFormedLinkToken("short")).toBe(false);
    expect(isWellFormedLinkToken(`${"a".repeat(42)}/`)).toBe(false);
    expect(isWellFormedLinkToken("a".repeat(44))).toBe(false);
  });
});
