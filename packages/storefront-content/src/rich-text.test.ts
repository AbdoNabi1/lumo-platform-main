import { describe, expect, it } from "vitest";
import {
  escapeRichText,
  parseRichText,
  renderRichText,
  RICH_TEXT_MAX,
  validateRichText,
  type CreateElement,
  type RichBlock,
  type RichInline,
} from "./rich-text";

const blocks = (text: string): readonly RichBlock[] => parseRichText(text).document.blocks;
const inline = (text: string) => (blocks(text)[0] as { children: unknown }).children;
const t = (value: string) => ({ type: "text", value }) as const;
const br = { type: "break" } as const;
const LINE_SEPARATOR = String.fromCharCode(0x2028);

describe("parseRichText — blocks (spec 2.1)", () => {
  it("separates paragraphs by blank lines; one newline is a hard break (Ruling 8)", () => {
    expect(blocks("one\ntwo\n\n\nthree")).toEqual([
      { type: "paragraph", children: [t("one"), br, t("two")] },
      { type: "paragraph", children: [t("three")] },
    ]);
  });

  it("normalises CRLF and a lone CR first", () => {
    expect(blocks("a\r\nb\rc")).toEqual(blocks("a\nb\nc"));
  });

  it("only ## and ### are headings; #, ####, ##x and an empty heading stay text", () => {
    expect(blocks("## Returns\n### Refunds\n# Big\n#### Small\n##Tight\n## ")).toEqual([
      { type: "heading", level: 2, children: [t("Returns")] },
      { type: "heading", level: 3, children: [t("Refunds")] },
      {
        type: "paragraph",
        children: [t("# Big"), br, t("#### Small"), br, t("##Tight"), br, t("##")],
      },
    ]);
  });

  it("- and 1. make one-level lists; indentation is flattened; the kinds never mix", () => {
    expect(blocks("- a\n  - b\n1. c\n12. d\n-e")).toEqual([
      { type: "list", ordered: false, items: [[t("a")], [t("b")]] },
      { type: "list", ordered: true, items: [[t("c")], [t("d")]] },
      { type: "paragraph", children: [t("-e")] },
    ]);
  });

  it("--- (or longer) is a rule, also right under a paragraph line", () => {
    expect(blocks("text\n---\n-----")).toEqual([
      { type: "paragraph", children: [t("text")] },
      { type: "rule" },
      { type: "rule" },
    ]);
  });

  it("an empty or blank text has no blocks", () => {
    expect(blocks("")).toEqual([]);
    expect(blocks(" \n\n \t")).toEqual([]);
  });

  it("a paragraph line closes a list, and a list item closes a paragraph", () => {
    expect(blocks("p\n- a\nq")).toEqual([
      { type: "paragraph", children: [t("p")] },
      { type: "list", ordered: false, items: [[t("a")]] },
      { type: "paragraph", children: [t("q")] },
    ]);
  });

  it("never throws, even on a value that is not a string", () => {
    expect(parseRichText(undefined as unknown as string).document.blocks).toEqual([]);
  });
});

describe("parseRichText — inline", () => {
  it("bold, italic, and the two nested either way", () => {
    expect(inline("**b** and *i*")).toEqual([
      { type: "strong", children: [t("b")] },
      t(" and "),
      { type: "em", children: [t("i")] },
    ]);
    expect(inline("**bold *both***")).toEqual([
      { type: "strong", children: [t("bold "), { type: "em", children: [t("both")] }] },
    ]);
    expect(inline("*a **b** c*")).toEqual([
      { type: "em", children: [t("a "), { type: "strong", children: [t("b")] }, t(" c")] },
    ]);
  });

  // Preflight 4: an even run inside an `em` opens or closes a `strong`, never three `em`s.
  it("***x*** is strong around em", () => {
    expect(inline("***x***")).toEqual([
      { type: "strong", children: [{ type: "em", children: [t("x")] }] },
    ]);
  });

  it("unclosed markers are literal text, merged into one text node", () => {
    expect(inline("**open and *half")).toEqual([t("**open and *half")]);
  });

  it("an empty emphasis or link is literal text", () => {
    expect(inline("a **** b ** c")).toEqual([t("a **** b ** c")]);
    expect(inline("[](/x)")).toEqual([t("[](/x)")]);
  });

  it("markup never spans lines (Ruling 8)", () => {
    expect(inline("**a\nb**")).toEqual([t("**a"), br, t("b**")]);
  });

  it("links: https is external; a same-site path, mailto and tel are not", () => {
    expect(
      inline("[Shop](https://shop.example/a) [About](/pages/about) [Call](tel:+201001234567)"),
    ).toEqual([
      { type: "link", href: "https://shop.example/a", external: true, children: [t("Shop")] },
      t(" "),
      { type: "link", href: "/pages/about", external: false, children: [t("About")] },
      t(" "),
      { type: "link", href: "tel:+201001234567", external: false, children: [t("Call")] },
    ]);
  });

  it("link text may carry emphasis but never another link", () => {
    expect(inline("[**Big** sale](/collections/sale)")).toEqual([
      {
        type: "link",
        href: "/collections/sale",
        external: false,
        children: [{ type: "strong", children: [t("Big")] }, t(" sale")],
      },
    ]);
    expect(inline("[a [b](/x) c](/y)")).toEqual([
      { type: "link", href: "/y", external: false, children: [t("a b c")] },
    ]);
  });

  it("a link inside emphasis inside a link is unwrapped too", () => {
    expect(inline("[a **[b](/x)** c](/y)")).toEqual([
      {
        type: "link",
        href: "/y",
        external: false,
        children: [t("a "), { type: "strong", children: [t("b")] }, t(" c")],
      },
    ]);
  });

  it("an unsafe link renders its label as text and is reported at its line (Ruling 9)", () => {
    const parsed = parseRichText("ok\n[x](javascript:alert(1)) and [y](//evil.example)");
    expect(parsed.document.blocks).toEqual([
      { type: "paragraph", children: [t("ok"), br, t("x) and y")] },
    ]);
    expect(parsed.unsafeLinkLines).toEqual([2]);
  });

  it("a dot-segment path that leaves the shop is unsafe (preflight 3)", () => {
    const parsed = parseRichText("[x](/.//evil.example) [y](/%2e//evil.example)");
    expect(parsed.document.blocks).toEqual([{ type: "paragraph", children: [t("x y")] }]);
    expect(parsed.unsafeLinkLines).toEqual([1]);
  });

  it("whitespace in the url or an empty url is not a link at all", () => {
    expect(inline("[a](https://x.example/a b) [c]()")).toEqual([
      t("[a](https://x.example/a b) [c]()"),
    ]);
  });

  it("![image](url) stays literal text (no images)", () => {
    expect(inline("![logo](https://cdn.example/a.png)")).toEqual([
      t("![logo](https://cdn.example/a.png)"),
    ]);
    // An escaped `!` does not make an image.
    expect(inline("\\![a](/x)")).toEqual([
      t("!"),
      { type: "link", href: "/x", external: false, children: [t("a")] },
    ]);
  });

  it("a backslash escapes punctuation; HTML and backticks are plain text", () => {
    expect(inline("\\*not\\* \\[x\\](y) <b>hi</b> `code`")).toEqual([
      t("*not* [x](y) <b>hi</b> `code`"),
    ]);
    expect(inline("a\\b c\\")).toEqual([t("a\\b c\\")]);
  });

  it("Arabic and mixed text keep every character", () => {
    expect(blocks("## سياسة الاسترجاع\n**مهم:** خلال 14 يوم — within 14 days")).toEqual([
      { type: "heading", level: 2, children: [t("سياسة الاسترجاع")] },
      {
        type: "paragraph",
        children: [{ type: "strong", children: [t("مهم:")] }, t(" خلال 14 يوم — within 14 days")],
      },
    ]);
  });

  // Preflight 6: an opener beyond 16 open frames on a line is literal text.
  it("at most 16 frames are open at once on a line", () => {
    const depthOf = (nodes: readonly RichInline[]): number =>
      Math.max(
        0,
        ...nodes.map((node) =>
          node.type === "strong" || node.type === "em" || node.type === "link"
            ? 1 + depthOf(node.children)
            : 0,
        ),
      );
    const deep = `${"[*".repeat(20)}x${"*](/a)".repeat(20)}`;
    expect(depthOf(inline(deep) as readonly RichInline[])).toBeLessThanOrEqual(16);
    // The 17th `[` is text inside the 16th frame, so it ends up in the innermost link's label;
    // the 15 frames under it are never closed and come back as text.
    expect(inline(`${"[".repeat(17)}x](/a)`)).toEqual([
      t("[".repeat(15)),
      { type: "link", href: "/a", external: false, children: [t("[x")] },
    ]);
  });
});

describe("parseRichText — hostile sizes run in linear time", () => {
  const timed = (text: string) => {
    const start = performance.now();
    parseRichText(text);
    return performance.now() - start;
  };
  it.each([
    ["100k unclosed **", "**".repeat(50_000)],
    ["100k [", "[".repeat(100_000)],
    ["25k [a](", "[a](".repeat(25_000)],
    ["50k ](", "](".repeat(50_000)],
    ["alternating * and **", "*a **b ".repeat(14_000)],
    ["one 100k line", "x".repeat(100_000)],
    ["50k lines", "a\n".repeat(50_000)],
    ["50k list items", "- a\n1. b\n".repeat(12_500)],
    // Preflight 6: nested link frames with element children.
    ["14k [**a**", "[**a** ".repeat(14_000)],
    ["16k [*a*", "[*a* ".repeat(16_000)],
    ["deep nesting", `${"[**[*".repeat(5_000)}x${"*](/a)**](/b)".repeat(5_000)}`],
    ["100k *", "*".repeat(100_000)],
    ["100k \\", "\\".repeat(100_000)],
    ["100k ]", "]".repeat(100_000)],
    ["nested unsafe links", "[[x](javascript:a)](".repeat(5_000)],
    ["100k headings and rules", "## a\n---\n".repeat(10_000)],
    // `.` does not match a line separator: the block patterns must not backtrack over spaces.
    ["heading of 99k spaces", `## ${" ".repeat(99_000)}a${LINE_SEPARATOR}b`],
    ["list item of 99k spaces", `- ${" ".repeat(99_000)}a${LINE_SEPARATOR}b`],
    ["ordered item of 99k spaces", `1. ${" ".repeat(99_000)}a${LINE_SEPARATOR}b`],
  ])("%s parses in under 400 ms", (_name, text) => {
    expect(timed(text)).toBeLessThan(400);
  });

  it("reads at most RICH_TEXT_MAX.body characters", () => {
    const parsed = parseRichText(`${"a".repeat(RICH_TEXT_MAX.body)}[x](javascript:y)`);
    expect(parsed.document.blocks).toEqual([
      { type: "paragraph", children: [t("a".repeat(RICH_TEXT_MAX.body))] },
    ]);
    expect(parsed.unsafeLinkLines).toEqual([]);
    expect(timed("[**a** ".repeat(100_000))).toBeLessThan(400);
  });

  it("a paragraph or a list holds at most 1,000 lines; the next one starts a new block", () => {
    const paragraphs = blocks("a\n".repeat(2_500));
    expect(paragraphs.map((b) => (b.type === "paragraph" ? b.children.length : -1))).toEqual([
      1_999, 1_999, 999,
    ]);
    const lists = blocks("- a\n".repeat(1_001));
    expect(lists.map((b) => (b.type === "list" ? b.items.length : -1))).toEqual([1_000, 1]);
  });
});

describe("validateRichText", () => {
  it("over the limit is TOO_LONG at line 0", () => {
    expect(validateRichText("a".repeat(11), 10)).toEqual([{ code: "TOO_LONG", line: 0 }]);
    expect(validateRichText("a".repeat(10), 10)).toEqual([]);
  });
  it("every line with an unsafe link is reported once, in order", () => {
    expect(
      validateRichText(
        "[a](http://x.example) [b](javascript:x)\n\n[c](https://x.example)\n[d](data:text/html,x)",
        RICH_TEXT_MAX.body,
      ),
    ).toEqual([
      { code: "UNSAFE_LINK", line: 1 },
      { code: "UNSAFE_LINK", line: 4 },
    ]);
  });
  it("the limits are 100,000 for bodies and 5,000 for sections", () => {
    expect(RICH_TEXT_MAX).toEqual({ body: 100_000, section: 5_000 });
  });
});

describe("escapeRichText (template substitution, spec 2.3)", () => {
  it("a value with markup and a link stays one plain text node", () => {
    const hostile = "Shop](javascript:alert(1)) [x](javascript:y) **b** # `c` \\";
    const parsed = parseRichText(`Welcome to ${escapeRichText(hostile)}`);
    expect(parsed.document.blocks).toEqual([
      { type: "paragraph", children: [t(`Welcome to ${hostile}`)] },
    ]);
    expect(parsed.unsafeLinkLines).toEqual([]);
  });
});

type Node = { tag: string; props: Record<string, unknown>; children: (Node | string)[] };
const h: CreateElement<Node> = (tag, props, ...children) => ({
  tag,
  props: { ...props },
  children,
});

describe("renderRichText (Ruling 10)", () => {
  it("maps blocks to the allowed tags, with dir=auto on text blocks and the caller's classes", () => {
    const out = renderRichText(
      parseRichText("## T\nx **b** *i* [s](https://s.example)\n- one\n1. two\n---").document,
      h,
      { p: "prose-p" },
    );
    expect(out.map((n) => n.tag)).toEqual(["h2", "p", "ul", "ol", "hr"]);
    expect(out[0]?.props).toMatchObject({ dir: "auto" });
    expect(out[1]?.props).toMatchObject({ dir: "auto", className: "prose-p" });
    const link = out[1]?.children.find((c): c is Node => typeof c !== "string" && c.tag === "a");
    expect(link?.props).toMatchObject({
      href: "https://s.example/",
      target: "_blank",
      rel: "noopener noreferrer nofollow",
    });
    expect(out[2]?.children.every((c) => typeof c !== "string" && c.tag === "li")).toBe(true);
  });

  it("an internal, mailto or tel link gets no target and no rel; sibling keys are unique", () => {
    const out = renderRichText(parseRichText("[a](/x) [b](mailto:a@b.example) c\nd").document, h);
    const links = out[0]!.children.filter((c): c is Node => typeof c !== "string" && c.tag === "a");
    for (const link of links) {
      expect(link.props["target"]).toBeUndefined();
      expect(link.props["rel"]).toBeUndefined();
    }
    const keys = out[0]!.children.flatMap((c) => (typeof c === "string" ? [] : [c.props["key"]]));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("renders the whole tree: headings, list items, breaks and nested emphasis", () => {
    const out = renderRichText(parseRichText("### H\n- **a *b***\n\nx\ny").document, h, {
      li: "item",
      br: "line",
    });
    expect(out).toEqual([
      { tag: "h3", props: { key: "0", dir: "auto" }, children: ["H"] },
      {
        tag: "ul",
        props: { key: "1", dir: "auto" },
        children: [
          {
            tag: "li",
            props: { key: "0", dir: "auto", className: "item" },
            children: [
              {
                tag: "strong",
                props: { key: "0" },
                children: ["a ", { tag: "em", props: { key: "1" }, children: ["b"] }],
              },
            ],
          },
        ],
      },
      {
        tag: "p",
        props: { key: "2", dir: "auto" },
        children: ["x", { tag: "br", props: { key: "1", className: "line" }, children: [] }, "y"],
      },
    ]);
  });

  it("re-checks every href it is handed: an unsafe one renders its label only", () => {
    const out = renderRichText(
      {
        blocks: [
          {
            type: "paragraph",
            children: [
              { type: "link", href: "javascript:alert(1)", external: false, children: [t("x")] },
              { type: "link", href: "https://ok.example", external: false, children: [t("y")] },
              { type: "link", href: "/a", external: true, children: [t("z")] },
            ],
          },
        ],
      },
      h,
    );
    expect(out[0]?.children).toEqual([
      "x",
      {
        tag: "a",
        props: {
          key: "1",
          href: "https://ok.example/",
          target: "_blank",
          rel: "noopener noreferrer nofollow",
        },
        children: ["y"],
      },
      { tag: "a", props: { key: "2", href: "/a" }, children: ["z"] },
    ]);
  });
});

describe("renderRichText — hostile sizes", () => {
  /** Calls `h` from deep in the stack, as a server render does. */
  const renderDeep = (text: string, depth: number): Node[] =>
    depth === 0 ? renderRichText(parseRichText(text).document, h) : renderDeep(text, depth - 1);

  it.each([
    ["50k short lines", "a\n".repeat(50_000)],
    ["25k list items", "- a\n".repeat(25_000)],
    ["25k emphasis", "*a* ".repeat(25_000)],
    ["14k links", "[a](/x)".repeat(14_000)],
    ["14k [**a**", "[**a** ".repeat(14_000)],
  ])("%s renders in under 400 ms without overflowing the call stack", (_name, text) => {
    const start = performance.now();
    expect(() => renderDeep(text, 2_000)).not.toThrow();
    expect(performance.now() - start).toBeLessThan(400);
  });
});
