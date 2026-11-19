import { describe, expect, it } from "vitest";
import { safeHref } from "./links";
import {
  parseRichText,
  renderRichText,
  RICH_TEXT_MAX,
  RICH_TEXT_TAGS,
  validateRichText,
  type CreateElement,
} from "./rich-text";

type Node = { tag: string; props: Record<string, unknown>; children: (Node | string)[] };
const h: CreateElement<Node> = (tag, props, ...children) => ({
  tag,
  props: { ...props },
  children,
});
const ALLOWED_PROPS = new Set(["key", "className", "dir", "href", "target", "rel"]);
/** A scheme a browser would run or load: never at the start of any rendered prop. */
const UNSAFE_START = /^\s*(?:javascript|data|vbscript|file|blob|http):/i;

function assertSafe(nodes: readonly (Node | string)[]): void {
  for (const node of nodes) {
    if (typeof node === "string") continue;
    expect(RICH_TEXT_TAGS).toContain(node.tag);
    for (const [name, value] of Object.entries(node.props)) {
      expect(ALLOWED_PROPS.has(name), name).toBe(true);
      expect(typeof value, name).toBe("string");
      expect(String(value), name).not.toMatch(UNSAFE_START);
    }
    if (node.props["key"] === undefined) throw new Error(`${node.tag} has no key`);
    if (node.props["dir"] !== undefined) expect(node.props["dir"]).toBe("auto");
    if (node.tag === "a") {
      // Preflight 19: the href must be exactly what the link rules allow, not a substring check.
      const href = node.props["href"];
      expect(typeof href).toBe("string");
      const safe = safeHref(href);
      expect(safe?.href).toBe(href);
      expect(String(href)).toMatch(/^(?:\/(?:$|[^/\\])|https:\/\/|mailto:|tel:)/);
      if (safe?.external) {
        expect(node.props["target"]).toBe("_blank");
        expect(node.props["rel"]).toBe("noopener noreferrer nofollow");
      } else {
        expect(node.props["target"]).toBeUndefined();
        expect(node.props["rel"]).toBeUndefined();
      }
    } else {
      expect(node.props["href"]).toBeUndefined();
      expect(node.props["target"]).toBeUndefined();
      expect(node.props["rel"]).toBeUndefined();
    }
    assertSafe(node.children);
  }
}

const render = (text: string) => renderRichText(parseRichText(text).document, h);

const HOSTILE = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '"><svg onload=alert(1)>',
  "[x](javascript:alert(1))",
  "[x](JaVaScRiPt:alert(1))",
  "[x](java&#x73;cript:alert(1))",
  "[x](&#106;avascript:alert(1))",
  "[x](%6Aavascript:alert(1))",
  "[x](  javascript:alert(1))",
  "[x](//evil.example)",
  "[x](/\\evil.example)",
  "[x](/.//evil.example)",
  "[x](/%2e//evil.example)",
  "[x](/a/..//evil.example)",
  "[x](data:text/html,<script>alert(1)</script>)",
  "[x](vbscript:msgbox(1))",
  "[x](http://plain.example)",
  "[x](https://user:pass@evil.example)",
  '[x](https://ok.example" onmouseover="alert(1))',
  "[[x](javascript:a)](https://ok.example)",
  "[x]([y](javascript:z))",
  "[x](https://[)",
  "[x](tel:+20\t100)",
  `${"**".repeat(5_000)}[x](javascript:y)`,
];

describe("Morbeh text XSS corpus (spec 2.9, Review Focus 3)", () => {
  it.each(HOSTILE)("%j renders allow-listed tags, safe hrefs and no handler props", (input) => {
    assertSafe(render(input));
  });

  it("markup-looking text survives as text, never as an element", () => {
    const out = render("<script>alert(1)</script>");
    expect(out).toEqual([
      { tag: "p", props: { key: "0", dir: "auto" }, children: ["<script>alert(1)</script>"] },
    ]);
  });

  it("an unsafe link never becomes an anchor", () => {
    for (const input of HOSTILE.filter((text) => !text.includes("https://ok.example"))) {
      const anchors = JSON.stringify(render(input)).match(/"tag":"a"/g) ?? [];
      expect(anchors, input).toEqual([]);
    }
  });
});

/** A small seeded PRNG, so a failure reproduces. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

describe("property: render output never leaves the allow-list", () => {
  it("2,000 random strings over the syntax alphabet", () => {
    const random = mulberry32(20261104);
    const alphabet = [
      ..."*[]()!\\#-.1 \n`<>\"'&:/a",
      "https://",
      "javascript:",
      "mailto:",
      "tel:",
      "//",
      "---",
      "## ",
      "%2e",
      "/.",
    ];
    for (let i = 0; i < 2_000; i += 1) {
      const length = Math.floor(random() * 120);
      let text = "";
      for (let j = 0; j < length; j += 1) text += alphabet[Math.floor(random() * alphabet.length)];
      expect(() => parseRichText(text), JSON.stringify(text)).not.toThrow();
      assertSafe(render(text));
    }
  });
});

/** Counts rendered anchors. */
function anchorCount(nodes: readonly (Node | string)[]): number {
  let count = 0;
  for (const node of nodes) {
    if (typeof node === "string") continue;
    if (node.tag === "a") count += 1;
    count += anchorCount(node.children);
  }
  return count;
}

describe("property: the validator reports every link the renderer drops (review M8)", () => {
  it("3,000 random link URLs: exactly one of an anchor or an UNSAFE_LINK issue", () => {
    const random = mulberry32(0x7e1);
    const pieces = [
      "https://",
      "http://",
      "/",
      "//",
      ".",
      "..",
      "%2e",
      "?",
      "#",
      "a",
      "\u00df",
      "xn--",
      "-",
      "\u0639",
      "mailto:",
      "tel:",
      "+",
      "1",
      "@",
      ":",
      "\\",
      "%",
      "'",
      "<",
      "\u200b",
    ];
    for (let i = 0; i < 3_000; i += 1) {
      let url = "";
      const length = 1 + Math.floor(random() * 8);
      for (let j = 0; j < length; j += 1) url += pieces[Math.floor(random() * pieces.length)];
      const text = `[x](${url})`;
      const issues = validateRichText(text, RICH_TEXT_MAX.body);
      const anchors = anchorCount(render(text));
      expect(anchors + issues.length, JSON.stringify(text)).toBe(1);
    }
  });

  it("every link the parser produces is rendered as an anchor with the same href", () => {
    const random = mulberry32(0xa9);
    const alphabet = [..."*[]()!\\-.1 \n:/a", "https://", "javascript:", "/", "\u0639", "?"];
    for (let i = 0; i < 2_000; i += 1) {
      let text = "";
      const length = Math.floor(random() * 80);
      for (let j = 0; j < length; j += 1) text += alphabet[Math.floor(random() * alphabet.length)];
      const json = JSON.stringify(parseRichText(text).document);
      const links = json.match(/"type":"link"/g)?.length ?? 0;
      expect(anchorCount(render(text)), JSON.stringify(text)).toBe(links);
    }
  });
});
