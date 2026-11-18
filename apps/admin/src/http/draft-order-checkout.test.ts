import { describe, expect, it } from "vitest";
import {
  BusinessRuleError,
  ConcurrencyError,
  NotFoundError,
  toErrorEnvelope,
} from "@platform/utils";
import { withDraftConflictCode } from "./draft-order-checkout";

const conflict = (error: Error) => ({ status: 409, body: toErrorEnvelope(error) });
const codeOf = (response: { body: unknown }) => (response.body as { code?: string }).code;

describe("withDraftConflictCode (Pre-flight 7, Ruling 19)", () => {
  it.each([
    "DRAFT_COMPLETED",
    "DRAFT_TOTAL_TOO_LARGE",
    "DRAFT_LOCKED",
    "OUT_OF_STOCK",
    "DRAFT_BUSY",
  ])("keeps %s as its own code — never relabelled DRAFT_BUSY", (code) => {
    expect(codeOf(withDraftConflictCode(conflict(new BusinessRuleError(`${code}: why`))))).toBe(
      code,
    );
  });

  it("keeps VERSION_CONFLICT from a concurrency refusal", () => {
    const response = withDraftConflictCode(
      conflict(new ConcurrencyError("VERSION_CONFLICT: changed by someone else")),
    );
    expect(codeOf(response)).toBe("VERSION_CONFLICT");
  });

  it("a 409 with no code of its own becomes DRAFT_BUSY", () => {
    for (const error of [
      new BusinessRuleError("Checkout session is expired and can no longer be modified"),
      new ConcurrencyError("CheckoutSession was modified concurrently"),
    ]) {
      const response = withDraftConflictCode(conflict(error));
      expect(response.status).toBe(409);
      expect(codeOf(response)).toBe("DRAFT_BUSY");
      expect((response.body as { message: string }).message).toMatch(/^DRAFT_BUSY: /);
    }
  });

  it("leaves every other status untouched", () => {
    const missing = { status: 404, body: toErrorEnvelope(new NotFoundError("gone")) };
    expect(withDraftConflictCode(missing)).toBe(missing);
  });
});
