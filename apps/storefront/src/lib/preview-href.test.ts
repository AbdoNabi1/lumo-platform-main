import { describe, expect, it } from "vitest";
import { withPreview } from "./preview-href";

describe("withPreview", () => {
  it("adds or replaces ?preview= and keeps query and hash", () => {
    expect(withPreview("/products/a", "tok")).toBe("/products/a?preview=tok");
    expect(withPreview("/search?q=x#top", "tok")).toBe("/search?q=x&preview=tok#top");
    expect(withPreview("/?preview=old", "new")).toBe("/?preview=new");
  });
  it("is the identity without a token", () => {
    expect(withPreview("/cart", null)).toBe("/cart");
  });
});
