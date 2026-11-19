import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MenuLink } from "./menu-link";

/** The one shape a rendered internal href may have: exactly `/`, or one `/` then neither `/` nor `\`. */
const SAFE_SHAPE = /^\/(?:$|[^/\\])/;

/** Part 1's open-redirect attempts (middleware.test.ts, review C-1) and the dot-segment cases. */
const REDIRECT_ATTACKS = [
  "//evil.example",
  "/\\evil.example",
  "/\t/evil.example",
  "/\n/evil.example",
  "https://evil.example/",
  "javascript:alert(1)",
  "/.//evil.example",
  "/..//evil.example",
  "/%2e//evil.example",
  "/%2e//evil.example/x",
  "/%2E%2E//evil.example/x?y#z",
  "/.\t//evil.example",
  "/a/..//evil.example",
  "//evil",
  "/\t/evil",
  "https://evil",
  "javascript:",
  "/./\\evil.example",
  "/.%2e//evil.example",
];
const SAME_SITE = ["/", "/pages/about", "/collections/a/../b?x=1#top", "/search?q=%D8%A7"];
const entry = (href: string) => ({ label: "Go", href, external: false, children: [] });

describe("MenuLink (spec 2.8, preflight 3)", () => {
  it("every rendered internal href starts with exactly one /, with and without a preview", () => {
    const hrefs: string[] = [];
    for (const token of [null, "T".repeat(43)]) {
      for (const href of [...REDIRECT_ATTACKS, ...SAME_SITE]) {
        const { container, unmount } = render(
          <MenuLink entry={entry(href)} previewToken={token} />,
        );
        for (const a of container.querySelectorAll("a")) hrefs.push(a.getAttribute("href") ?? "");
        unmount();
      }
    }
    const internal = hrefs.filter((h) => !/^(https:|mailto:|tel:)/.test(h));
    expect(internal.length).toBeGreaterThanOrEqual(SAME_SITE.length * 2);
    for (const href of internal) expect(href).toMatch(SAFE_SHAPE);
    expect(hrefs.some((h) => h.startsWith("//") || h.includes("evil.example?preview"))).toBe(false);
  });

  it("an unsafe href renders the label as text, never a link", () => {
    for (const href of ["//evil.example", "/.//evil.example", "javascript:alert(1)", "data:x"]) {
      const { container, unmount } = render(<MenuLink entry={entry(href)} previewToken="tok" />);
      expect(container.querySelector("a")).toBeNull();
      expect(container.textContent).toBe("Go");
      unmount();
    }
  });

  it("decides external from the href itself, not the entry's flag", () => {
    render(
      <MenuLink
        entry={{ label: "Out", href: "https://shop.example/", external: false, children: [] }}
        previewToken="tok"
      />,
    );
    const link = screen.getByRole("link", { name: "Out" });
    expect(link).toHaveAttribute("href", "https://shop.example/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
  });

  it("mailto and tel are plain links; the label is isolated", () => {
    render(
      <>
        <MenuLink entry={{ ...entry("mailto:a@b.example"), label: "Mail" }} previewToken="tok" />
        <MenuLink entry={{ ...entry("tel:+20100"), label: "Call" }} previewToken="tok" />
      </>,
    );
    const mail = screen.getByRole("link", { name: "Mail" });
    expect(mail).toHaveAttribute("href", "mailto:a@b.example");
    expect(mail).not.toHaveAttribute("target");
    expect(screen.getByRole("link", { name: "Call" })).toHaveAttribute("href", "tel:+20100");
    expect(mail.querySelector("bdi")).toHaveAttribute("dir", "auto");
  });
});
