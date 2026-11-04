import { describe, expect, it } from "vitest";
import { FALLBACK_SHELL, type StorefrontShell } from "./online-store";
import { brandStyleFor, lockedMetadataFor, logoSize, metadataFor } from "./shell-presentation";
import { en } from "@/messages/en";
import { ar } from "@/messages/ar";

const branded: StorefrontShell = {
  ...FALLBACK_SHELL,
  branded: true,
  storeName: "Nour",
  preferences: {
    homeTitle: { ar: "متجر النور" },
    homeMetaDescription: { en: "Hand-made lamps" },
    shareImage: { url: "https://cdn.test/og.jpg", alt: "Lamps", width: 1200, height: 630 },
  },
  brand: {
    ...FALLBACK_SHELL.brand,
    favicon: { url: "https://cdn.test/f.png", alt: null, width: 64, height: 64 },
  },
};

describe("brandStyleFor", () => {
  it("emits nothing for an unbranded shop (today's look, dark mode kept)", () => {
    expect(brandStyleFor(FALLBACK_SHELL)).toBeNull();
  });

  it("emits the validated sheet for a branded shop; a corrupt brand renders the default palette (Review Focus 1)", () => {
    const corrupt = {
      ...branded,
      brand: {
        ...branded.brand,
        style: { colors: { background: "#000000;}</style><script>" } } as never,
      },
    };
    const css = brandStyleFor(corrupt);
    expect(css).toMatch(/^:root:root:root\{/);
    expect(css).toContain("--background:#f8fafc");
    expect(css).not.toContain("<");
  });
});

describe("metadataFor", () => {
  it("titles with the home title in the request locale, else the other, with the store-name template", () => {
    expect(metadataFor(branded, "en", en).title).toEqual({
      default: "متجر النور",
      template: "%s | Nour",
    });
    expect(metadataFor(FALLBACK_SHELL, "en", en).title).toEqual({
      default: "Store",
      template: "%s",
    });
    expect(metadataFor({ ...FALLBACK_SHELL, storeName: "Nour" }, "ar", ar).title).toEqual({
      default: "Nour",
      template: "%s | Nour",
    });
  });

  it("sets description, Open Graph with the share image, Twitter and icons", () => {
    const meta = metadataFor(branded, "ar", ar);
    expect(meta.description).toBe("Hand-made lamps");
    // No og:title / og:description here: Next fills them per page from the resolved title and
    // description, so a product page shares its own title, not the home one (review M-6).
    expect(meta.openGraph).toEqual({
      siteName: "Nour",
      locale: "ar_EG",
      type: "website",
      images: [{ url: "https://cdn.test/og.jpg", width: 1200, height: 630, alt: "Lamps" }],
    });
    expect(meta.twitter).toEqual({ card: "summary_large_image" });
    expect(meta.icons).toEqual({
      icon: [{ url: "https://cdn.test/f.png" }],
      apple: [{ url: "https://cdn.test/f.png" }],
    });
    expect(meta.robots).toBeUndefined();
  });

  it("leaves out images, icons and description when the shell has none (a media failure is null)", () => {
    const meta = metadataFor(FALLBACK_SHELL, "ar", ar);
    expect(meta.icons).toBeUndefined();
    expect(meta.description).toBeUndefined();
    expect(meta.openGraph).toEqual({ locale: "ar_EG", type: "website" });
  });

  it("keeps a hostile or percent-bearing store name as plain data (M-3, M-6)", () => {
    const rlo = String.fromCodePoint(0x202e);
    const hostile = `</style><script>alert(1)</script>${rlo}100%s`;
    const meta = metadataFor({ ...FALLBACK_SHELL, storeName: hostile }, "en", en);
    expect(meta.title).toEqual({
      default: hostile,
      // Next replaces every %s in the template; the name must not add one.
      template: `%s | </style><script>alert(1)</script>${rlo}100s`,
    });
    expect(meta.openGraph).toMatchObject({ siteName: hostile });
  });

  it("noindexes a locked store and every preview, locked or not (final review M-1)", () => {
    const noindex = { index: false, follow: false };
    expect(metadataFor({ ...branded, locked: true }, "en", en).robots).toEqual(noindex);
    expect(metadataFor({ ...branded, locked: true, mode: "preview" }, "en", en).robots).toEqual(
      noindex,
    );
    expect(metadataFor({ ...branded, mode: "preview" }, "en", en).robots).toEqual(noindex);
    expect(metadataFor({ ...branded, mode: "live" }, "en", en).robots).toBeUndefined();
  });
});

describe("lockedMetadataFor (preflight 18, Review Focus 5)", () => {
  it("a locked store's link preview shows the store name and 'Opening soon' only", () => {
    const meta = lockedMetadataFor({ ...branded, locked: true }, "en", en);
    expect(meta).toEqual({
      title: "Nour",
      description: en.password.defaultMessage,
      openGraph: {
        siteName: "Nour",
        locale: "en_US",
        title: "Nour",
        description: en.password.defaultMessage,
      },
      twitter: { card: "summary", title: "Nour", description: en.password.defaultMessage },
      icons: {
        icon: [{ url: "https://cdn.test/f.png" }],
        apple: [{ url: "https://cdn.test/f.png" }],
      },
      robots: { index: false, follow: false },
    });
    const text = JSON.stringify(meta);
    expect(text).not.toContain("متجر النور");
    expect(text).not.toContain("Hand-made lamps");
    expect(text).not.toContain("og.jpg");
  });

  it("without a store name: the page title, in the request locale, and no site name", () => {
    const meta = lockedMetadataFor({ ...FALLBACK_SHELL, locked: true }, "ar", ar);
    expect(meta.title).toBe(ar.password.title);
    expect(meta.description).toBe(ar.password.defaultMessage);
    expect(meta.openGraph).toEqual({
      locale: "ar_EG",
      title: ar.password.title,
      description: ar.password.defaultMessage,
    });
    expect(meta.icons).toBeUndefined();
  });

  it("keeps a hostile store name as plain data", () => {
    const hostile = "</title><script>alert(1)</script>%s";
    const meta = lockedMetadataFor({ ...FALLBACK_SHELL, storeName: hostile }, "en", en);
    expect(meta.title).toBe(hostile);
  });
});

describe("logoSize", () => {
  it("keeps the aspect ratio at the chosen width, and leaves height open when unknown", () => {
    expect(logoSize({ url: "u", alt: null, width: 800, height: 100 }, 160)).toEqual({
      width: 160,
      height: 20,
    });
    expect(logoSize({ url: "u", alt: null, width: null, height: null }, 160)).toEqual({
      width: 160,
      height: undefined,
    });
  });
});
