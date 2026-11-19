import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { RichText } from "./rich-text";

describe("<RichText> (spec 2.8)", () => {
  it("renders the allowed elements with dir=auto", () => {
    const { container } = render(
      <RichText text={"## Returns\n**14** days, [contact us](/pages/contact)\n- one\n---"} />,
    );
    expect([...container.querySelectorAll("*")].map((e) => e.tagName.toLowerCase())).toEqual(
      expect.arrayContaining(["h2", "p", "strong", "a", "ul", "li", "hr"]),
    );
    expect(container.querySelector("h2")).toHaveAttribute("dir", "auto");
    expect(container.querySelector("a")).toHaveAttribute("href", "/pages/contact");
  });

  it("hostile input is text: no script, no handler, no javascript href", () => {
    const { container } = render(
      <RichText
        text={"<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1))"}
      />,
    );
    expect(container.querySelector("script, img")).toBeNull();
    expect(container.innerHTML).not.toMatch(/href="javascript/i);
    // `onerror=` is still in the page, as escaped text: no element carries any handler attribute.
    const attributes = [...container.querySelectorAll("*")].flatMap((e) =>
      [...e.attributes].map((a) => a.name),
    );
    expect(attributes.filter((name) => /^on/i.test(name))).toEqual([]);
    expect(container.querySelector("a")).toBeNull();
    expect(container.innerHTML).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("styles through the prose classes, external links open safely, className reaches the div", () => {
    const { container } = render(
      <RichText text={"## Title\n[site](https://example.com)"} className="extra" />,
    );
    expect(container.firstElementChild).toHaveClass("extra");
    expect(container.querySelector("h2")).toHaveClass("text-xl", "font-semibold");
    const link = container.querySelector("a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(link).toHaveClass("text-primary", "underline");
  });
});
