import { describe, expect, it } from "vitest";
import { AppError, DomainError, NotFoundError, ValidationError, isDomainError } from "./index";

describe("domain error re-export", () => {
  it("re-exports the kernel hierarchy without redefining it", () => {
    const error = new NotFoundError("missing");
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(DomainError);
    expect(isDomainError(error)).toBe(true);
    expect(new ValidationError("bad").code).toBe("VALIDATION");
  });
});
