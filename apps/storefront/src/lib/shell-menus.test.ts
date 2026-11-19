import { describe, expect, it } from "vitest";
import { footerColumns, footerPolicyLinks, menuEntries } from "./shell-menus";

const item = (label: Record<string, string>, href: string, children: unknown[] = []) =>
  ({ label, href, external: href.startsWith("https:"), children }) as never;

describe("menuEntries", () => {
  it("picks the locale, falls back to the other, skips an unlabelled item", () => {
    expect(
      menuEntries(
        [
          item({ ar: "الرئيسية", en: "Home" }, "/"),
          item({ ar: "تخفيضات" }, "/collections/sale"),
          item({}, "/x"),
        ],
        "en",
      ),
    ).toEqual([
      { label: "Home", href: "/", external: false, children: [] },
      { label: "تخفيضات", href: "/collections/sale", external: false, children: [] },
    ]);
  });

  it("maps children the same way", () => {
    expect(
      menuEntries(
        [item({ en: "Shop" }, "/collections/all", [item({ ar: "تخفيضات" }, "/collections/sale")])],
        "en",
      ),
    ).toEqual([
      {
        label: "Shop",
        href: "/collections/all",
        external: false,
        children: [{ label: "تخفيضات", href: "/collections/sale", external: false, children: [] }],
      },
    ]);
  });
});

describe("footerColumns (spec 2.8)", () => {
  it("parents become columns; childless items gather under Links, last", () => {
    const columns = footerColumns(
      [
        item({ en: "Search" }, "/search"),
        item({ en: "Shop" }, "/collections/all", [item({ en: "Sale" }, "/collections/sale")]),
        item({ en: "About" }, "/pages/about"),
      ],
      "en",
      "Links",
    );
    expect(columns.map((c) => [c.title, c.links.map((l) => l.label)])).toEqual([
      ["Shop", ["Sale"]],
      ["Links", ["Search", "About"]],
    ]);
  });

  it("no menu, no columns", () => {
    expect(footerColumns([], "en", "Links")).toEqual([]);
  });
});

describe("footerPolicyLinks (Ruling 12)", () => {
  it("skips policies the footer menu already links; titles come from POLICY_TITLES", () => {
    const links = footerPolicyLinks(
      ["refund", "privacy", "contact"],
      [item({ en: "Help" }, "/pages/help", [item({ en: "Returns" }, "/policies/refund-policy")])],
      "ar",
    );
    expect(links).toEqual([
      { label: "سياسة الخصوصية", href: "/policies/privacy-policy", external: false, children: [] },
      {
        label: "معلومات التواصل",
        href: "/policies/contact-information",
        external: false,
        children: [],
      },
    ]);
  });

  it("a top-level menu link also counts", () => {
    expect(
      footerPolicyLinks(["terms"], [item({ en: "Terms" }, "/policies/terms-of-service")], "en"),
    ).toEqual([]);
  });

  it("a parent item is a column heading, not a link: its policy still gets a link (review M-2)", () => {
    const menu = [
      item({ en: "Returns" }, "/policies/refund-policy", [item({ en: "FAQ" }, "/pages/faq")]),
    ];
    expect(footerColumns(menu, "en", "Links")).toEqual([
      {
        title: "Returns",
        links: [{ label: "FAQ", href: "/pages/faq", external: false, children: [] }],
      },
    ]);
    expect(footerPolicyLinks(["refund"], menu, "en")).toEqual([
      { label: "Refund policy", href: "/policies/refund-policy", external: false, children: [] },
    ]);
  });

  it("an unlabelled item renders nothing, so it does not count as a link either", () => {
    expect(
      footerPolicyLinks(["terms"], [item({}, "/policies/terms-of-service")], "en"),
    ).toHaveLength(1);
  });
});
