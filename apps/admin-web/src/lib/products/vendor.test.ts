import { describe, expect, it } from "vitest";
import type { BrandDto } from "@/lib/api/brands";
import { resolveVendor } from "./vendor";

const brands: readonly BrandDto[] = [
  { id: "b1", name: "Acme Toys", slug: "acme-toys" },
  { id: "b2", name: "شركة الأمل", slug: "brand-abc123" },
];

describe("resolveVendor", () => {
  it("treats a blank vendor as no brand", () => {
    expect(resolveVendor("", brands)).toEqual({ kind: "none" });
    expect(resolveVendor("   ", brands)).toEqual({ kind: "none" });
  });

  it("matches an existing brand case-insensitively, on trimmed names", () => {
    expect(resolveVendor(" acme toys ", brands)).toEqual({ kind: "existing", brandId: "b1" });
    expect(resolveVendor("ACME TOYS", brands)).toEqual({ kind: "existing", brandId: "b1" });
    expect(resolveVendor("شركة الأمل", brands)).toEqual({ kind: "existing", brandId: "b2" });
  });

  it("asks for a new brand, with a handle-style slug, when nothing matches", () => {
    expect(resolveVendor("Nile Kids", brands)).toEqual({
      kind: "new",
      name: "Nile Kids",
      slug: "nile-kids",
    });
  });

  it("trims the name of a new brand", () => {
    expect(resolveVendor("  Nile Kids  ", [])).toEqual({
      kind: "new",
      name: "Nile Kids",
      slug: "nile-kids",
    });
  });

  it("falls back to a brand-<token> slug for a name with no Latin letters", () => {
    const resolved = resolveVendor("شركة النيل", brands);

    expect(resolved.kind).toBe("new");
    if (resolved.kind === "new") {
      expect(resolved.name).toBe("شركة النيل");
      expect(resolved.slug).toMatch(/^brand-[a-z0-9]{6}$/);
    }
  });
});
