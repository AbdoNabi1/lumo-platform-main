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

/**
 * Linear-time check that does not depend on how fast the machine is. A wall-clock budget
 * (`< 400 ms`) fails on a shared CI runner that is 3-10x slower than a laptop and noisy, so this
 * asserts two things instead:
 *  1. The full input finishes under a generous ceiling. Every case here is tuned to the input cap
 *     (about 100k characters); a quadratic parser needs 10^10 steps for that and takes tens of
 *     seconds, so the ceiling catches it with an order of magnitude to spare.
 *  2. When the full run is long enough to measure (`MEASURABLE_MS`), it costs less than
 *     `MAX_SCALING` times the same work on an eighth of the input. Linear work gives about 8x,
 *     quadratic about 64x. Below that duration the ratio is timer, JIT and GC noise (a run that
 *     fits in the young generation is cheaper per item than one that does not), so it is not
 *     asserted.
 * Each side takes the fastest of several runs, which discards interference from other test files
 * running on the same machine.
 */
const SCALING_RUNS = 7;
const SIZE_DIVISOR = 8;
const MAX_SCALING = 32;
/** Timer resolution and GC noise below this are not a scaling signal. */
const NOISE_FLOOR_MS = 3;
const MEASURABLE_MS = 500;
const CEILING_MS = 5_000;

function fastestMs(work: () => void): number {
  work(); // warm up the JIT, not counted
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < SCALING_RUNS; i += 1) {
    const start = performance.now();
    work();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

function expectLinearTime(work: (text: string) => void, make: (n: number) => string, n: number) {
  const small = make(Math.floor(n / SIZE_DIVISOR));
  const full = make(n);
  const smallMs = fastestMs(() => work(small));
  const fullMs = fastestMs(() => work(full));
  expect(fullMs).toBeLessThan(CEILING_MS);
  if (fullMs > MEASURABLE_MS) {
    expect(fullMs).toBeLessThan(MAX_SCALING * Math.max(smallMs, NOISE_FLOOR_MS));
  }
}

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
  const repeat = (unit: string) => (n: number) => unit.repeat(n);
  it.each<[string, (n: number) => string, number]>([
    ["100k unclosed **", repeat("**"), 50_000],
    ["100k [", repeat("["), 100_000],
    ["25k [a](", repeat("[a]("), 25_000],
    ["50k ](", repeat("]("), 50_000],
    ["alternating * and **", repeat("*a **b "), 14_000],
    ["one 100k line", repeat("x"), 100_000],
    ["50k lines", repeat("a\n"), 50_000],
    ["50k list items", repeat("- a\n1. b\n"), 12_500],
    // Preflight 6: nested link frames with element children.
    ["14k [**a**", repeat("[**a** "), 14_000],
    ["16k [*a*", repeat("[*a* "), 16_000],
    ["deep nesting", (n) => `${"[**[*".repeat(n)}x${"*](/a)**](/b)".repeat(n)}`, 5_000],
    ["100k *", repeat("*"), 100_000],
    ["100k \\", repeat("\\"), 100_000],
    ["100k ]", repeat("]"), 100_000],
    ["nested unsafe links", repeat("[[x](javascript:a)]("), 5_000],
    ["100k headings and rules", repeat("## a\n---\n"), 10_000],
    // `.` does not match a line separator: the block patterns must not backtrack over spaces.
    ["heading of 99k spaces", (n) => `## ${" ".repeat(n)}a${LINE_SEPARATOR}b`, 99_000],
    ["list item of 99k spaces", (n) => `- ${" ".repeat(n)}a${LINE_SEPARATOR}b`, 99_000],
    ["ordered item of 99k spaces", (n) => `1. ${" ".repeat(n)}a${LINE_SEPARATOR}b`, 99_000],
  ])("%s parses in linear time", (_name, make, n) => {
    expectLinearTime((text) => parseRichText(text), make, n);
  });

  it("reads at most RICH_TEXT_MAX.body characters", () => {
    const parsed = parseRichText(`${"a".repeat(RICH_TEXT_MAX.body)}[x](javascript:y)`);
    expect(parsed.document.blocks).toEqual([
      { type: "paragraph", children: [t("a".repeat(RICH_TEXT_MAX.body))] },
    ]);
    expect(parsed.unsafeLinkLines).toEqual([]);
    expectLinearTime(
      (text) => parseRichText(text),
      (n) => "[**a** ".repeat(n),
      100_000,
    );
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

  it.each<[string, (n: number) => string, number]>([
    ["50k short lines", (n) => "a\n".repeat(n), 50_000],
    ["25k list items", (n) => "- a\n".repeat(n), 25_000],
    ["25k emphasis", (n) => "*a* ".repeat(n), 25_000],
    ["14k links", (n) => "[a](/x)".repeat(n), 14_000],
    ["14k [**a**", (n) => "[**a** ".repeat(n), 14_000],
  ])("%s render in linear time without overflowing the call stack", (_name, make, n) => {
    expectLinearTime((text) => expect(() => renderDeep(text, 2_000)).not.toThrow(), make, n);
  });
});

describe("review fix round 1", () => {
  // Review M3: a value alone on a line never becomes a list, an ordered list or a rule.
  it.each(["- foo", "---", "1. foo", "  - x", "12. y", "-----", "a\n- b\n3. c\n---"])(
    "escapeRichText keeps %j plain text at the start of a line",
    (value) => {
      const parsed = parseRichText(escapeRichText(value));
      const lines = value.split("\n").map((line) => line.trim());
      const children: RichInline[] = [];
      lines.forEach((line, index) => {
        if (index > 0) children.push(br);
        children.push(t(line));
      });
      expect(parsed.document.blocks).toEqual([{ type: "paragraph", children }]);
    },
  );

  it("escapeRichText leaves a marker that is not at the start of a line alone", () => {
    expect(escapeRichText("a - b 1. c")).toBe("a - b 1. c");
  });

  it("escapeRichText runs in linear time on hostile values", () => {
    const hostile: [(n: number) => string, number][] = [
      [(n) => " ".repeat(n), 100_000],
      [(n) => "\n".repeat(n), 100_000],
      [(n) => "1".repeat(n), 100_000],
      [(n) => LINE_SEPARATOR.repeat(n), 100_000],
      [(n) => `\u00a0${LINE_SEPARATOR}`.repeat(n), 50_000],
    ];
    for (const [make, n] of hostile) {
      expectLinearTime((text) => escapeRichText(`${text}x`), make, n);
    }
  });

  // Review M4: the validator never skips text it would not parse.
  it("text over RICH_TEXT_MAX.body is TOO_LONG even when max is larger", () => {
    const text = `${"a".repeat(RICH_TEXT_MAX.body)}\n[x](javascript:y)`;
    expect(validateRichText(text, 200_000)).toEqual([{ code: "TOO_LONG", line: 0 }]);
    expect(validateRichText("[x](javascript:y)", 200_000)).toEqual([
      { code: "UNSAFE_LINK", line: 1 },
    ]);
  });

  // Review M5: a text node from anywhere but the parser is checked too.
  it("the renderer skips a text value that is not a string", () => {
    const out = renderRichText(
      {
        blocks: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: { $$typeof: "x" } as unknown as string },
              t("ok"),
              { type: "text", value: 42 as unknown as string },
            ],
          },
        ],
      },
      h,
    );
    expect(out[0]?.children).toEqual(["ok"]);
  });

  // Review M6: harmless raw Unicode in an internal link is a link, not UNSAFE_LINK.
  it("a raw-Unicode internal link renders with its encoded href and is not reported", () => {
    const query = "\u0639\u0631\u0628\u064a";
    const text = `[search](/search?q=${query}) [a](/a?)`;
    expect(validateRichText(text, RICH_TEXT_MAX.body)).toEqual([]);
    expect(inline(text)).toEqual([
      {
        type: "link",
        href: `/search?q=${encodeURIComponent(query)}`,
        external: false,
        children: [t("search")],
      },
      t(" "),
      { type: "link", href: "/a", external: false, children: [t("a")] },
    ]);
  });

  // Review M1: the validator reports what the renderer would drop.
  it("an IDN host the renderer would refuse is reported by the validator", () => {
    const text = "[shop](https://\u00dfxn--.example)";
    expect(validateRichText(text, RICH_TEXT_MAX.body)).toEqual([{ code: "UNSAFE_LINK", line: 1 }]);
    expect(renderRichText(parseRichText(text).document, h)[0]?.children).toEqual(["shop"]);
  });
});
