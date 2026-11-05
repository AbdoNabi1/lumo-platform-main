import { safeHref } from "./links";

/**
 * Morbeh text (spec 2.1, Rulings 8 to 10): a restricted Markdown for policies, pages and section
 * bodies. It is parsed in one linear pass into a typed tree and rendered through an injected
 * `createElement`, so merchant text only ever becomes the allow-listed elements below, with text
 * as plain string children. It is never HTML, and nothing here produces markup as a string.
 */

export type RichInline =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "strong" | "em"; readonly children: readonly RichInline[] }
  | {
      readonly type: "link";
      readonly href: string;
      readonly external: boolean;
      readonly children: readonly RichInline[];
    }
  | { readonly type: "break" };

export type RichBlock =
  | { readonly type: "paragraph"; readonly children: readonly RichInline[] }
  | { readonly type: "heading"; readonly level: 2 | 3; readonly children: readonly RichInline[] }
  | {
      readonly type: "list";
      readonly ordered: boolean;
      readonly items: readonly (readonly RichInline[])[];
    }
  | { readonly type: "rule" };

export interface RichTextDocument {
  readonly blocks: readonly RichBlock[];
}

/** The longest Morbeh text per locale: policy and page bodies, and section bodies (Part 3). */
export const RICH_TEXT_MAX = { body: 100_000, section: 5_000 } as const;

export interface RichTextIssue {
  readonly code: "TOO_LONG" | "UNSAFE_LINK";
  /** 1-based; `0` for `TOO_LONG`. */
  readonly line: number;
}

/** The only elements the renderer ever creates. */
export const RICH_TEXT_TAGS = [
  "h2",
  "h3",
  "p",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
  "a",
  "hr",
  "br",
] as const;
export type RichTextTag = (typeof RICH_TEXT_TAGS)[number];

/** The only props the renderer ever passes. */
export interface RichTextProps {
  readonly key: string;
  readonly className?: string;
  readonly dir?: "auto";
  readonly href?: string;
  readonly target?: "_blank";
  readonly rel?: string;
}

export type CreateElement<E> = (
  tag: RichTextTag,
  props: RichTextProps,
  ...children: (E | string)[]
) => E;

/**
 * Bounds that keep every render small enough to pass as call arguments: the parser reads at most
 * `RICH_TEXT_MAX.body` characters (stored text is validated to that), and a paragraph or a list
 * holds at most this many lines before the next one starts.
 */
const MAX_BLOCK_LINES = 1_000;
/** Preflight 6: at most this many emphasis and link frames are open on one line. */
const MAX_OPEN_FRAMES = 16;

// The `s` flag matters: without it `.` stops at U+2028/U+2029, and ` +(.+)$` then backtracks over
// every space of the marker (quadratic). With it, `.+$` matches the rest of a trimmed line at once.
const RULE = /^-{3,}$/;
const HEADING = /^(#{2,3}) +(.+)$/s;
const UNORDERED_ITEM = /^- +(.+)$/s;
const ORDERED_ITEM = /^\d{1,9}\. +(.+)$/s;
const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;
const WHITESPACE = /^\s$/;

/**
 * Parses Morbeh text. Never throws. `unsafeLinkLines` lists, once each and in order, the 1-based
 * lines holding a link whose URL the link rules refuse; such a link renders as its label.
 */
export function parseRichText(text: string): {
  readonly document: RichTextDocument;
  readonly unsafeLinkLines: readonly number[];
} {
  const source = typeof text === "string" ? text.slice(0, RICH_TEXT_MAX.body) : "";
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: RichBlock[] = [];
  const unsafeLinkLines: number[] = [];
  let paragraph: { readonly children: RichInline[]; lines: number } | null = null;
  let list: { readonly ordered: boolean; readonly items: RichInline[][] } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const inline = (value: string) =>
      parseInline(value, () => {
        if (unsafeLinkLines[unsafeLinkLines.length - 1] !== lineNumber) {
          unsafeLinkLines.push(lineNumber);
        }
      });
    const trimmed = (lines[index] ?? "").trim();
    const heading = HEADING.exec(trimmed);
    const item = UNORDERED_ITEM.exec(trimmed) ?? ORDERED_ITEM.exec(trimmed);
    if (trimmed === "" || RULE.test(trimmed) || heading) {
      paragraph = null;
      list = null;
      if (heading) {
        const level = heading[1] === "###" ? 3 : 2;
        blocks.push({ type: "heading", level, children: inline(heading[2] ?? "") });
      } else if (trimmed !== "") {
        blocks.push({ type: "rule" });
      }
    } else if (item) {
      const ordered = !trimmed.startsWith("-");
      if (list === null || list.ordered !== ordered || list.items.length >= MAX_BLOCK_LINES) {
        paragraph = null;
        list = { ordered, items: [] };
        blocks.push({ type: "list", ordered, items: list.items });
      }
      list.items.push(inline(item[1] ?? ""));
    } else {
      const children = inline(trimmed);
      if (paragraph !== null && paragraph.lines < MAX_BLOCK_LINES) {
        paragraph.children.push({ type: "break" });
        for (const child of children) paragraph.children.push(child);
        paragraph.lines += 1;
      } else {
        list = null;
        paragraph = { children, lines: 1 };
        blocks.push({ type: "paragraph", children });
      }
    }
  }

  return { document: { blocks }, unsafeLinkLines };
}

type FrameKind = "root" | "strong" | "em" | "link";

interface Frame {
  readonly kind: FrameKind;
  readonly opener: string;
  readonly children: RichInline[];
}

/** Appends a node, merging adjacent text and dropping empty text. */
function appendNode(target: RichInline[], node: RichInline): void {
  if (node.type === "text") {
    if (node.value === "") return;
    const last = target[target.length - 1];
    if (last !== undefined && last.type === "text") {
      target[target.length - 1] = { type: "text", value: last.value + node.value };
      return;
    }
  }
  target.push(node);
}

function appendText(target: RichInline[], value: string): void {
  appendNode(target, { type: "text", value });
}

/** A link's children with every nested link replaced by its own children (links never nest). */
function withoutLinks(nodes: readonly RichInline[]): RichInline[] {
  const out: RichInline[] = [];
  for (const node of nodes) {
    if (node.type === "link") {
      for (const child of withoutLinks(node.children)) appendNode(out, child);
    } else if (node.type === "strong" || node.type === "em") {
      appendNode(out, { type: node.type, children: withoutLinks(node.children) });
    } else {
      appendNode(out, node);
    }
  }
  return out;
}

/**
 * One line of inline markup. Every frame is pushed once and popped once, and a node moves into
 * at most `MAX_OPEN_FRAMES` enclosing frames, so the pass is linear in the line's length.
 */
function parseInline(s: string, onUnsafeLink: () => void): RichInline[] {
  const length = s.length;
  // nextClose[i]: the next `)` at or after i (or -1); nextSpace[i]: the next whitespace (or length).
  const nextClose = new Int32Array(length + 1);
  const nextSpace = new Int32Array(length + 1);
  nextClose[length] = -1;
  nextSpace[length] = length;
  for (let i = length - 1; i >= 0; i -= 1) {
    const c = s[i] ?? "";
    nextClose[i] = c === ")" ? i : (nextClose[i + 1] ?? -1);
    nextSpace[i] = WHITESPACE.test(c) ? i : (nextSpace[i + 1] ?? length);
  }

  const stack: Frame[] = [{ kind: "root", opener: "", children: [] }];
  const openCount = { strong: 0, em: 0, link: 0 };
  const top = (): Frame => stack[stack.length - 1] as Frame;

  const openFrame = (kind: Exclude<FrameKind, "root">, opener: string) => {
    if (stack.length - 1 >= MAX_OPEN_FRAMES) {
      appendText(top().children, opener);
      return;
    }
    stack.push({ kind, opener, children: [] });
    openCount[kind] += 1;
  };

  /** Pops the top frame and puts it back into its parent as literal text. */
  const flattenTop = () => {
    const frame = stack.pop() as Frame;
    if (frame.kind !== "root") openCount[frame.kind] -= 1;
    const parent = top().children;
    appendText(parent, frame.opener);
    for (const child of frame.children) appendNode(parent, child);
  };

  /** Closes the nearest open frame of a kind, first flattening every frame above it. */
  const closeNearest = (kind: Exclude<FrameKind, "root">): Frame => {
    while (top().kind !== kind) flattenTop();
    const frame = stack.pop() as Frame;
    openCount[kind] -= 1;
    return frame;
  };

  const closeEmphasis = (kind: "strong" | "em", marker: string) => {
    const frame = closeNearest(kind);
    const parent = top().children;
    if (frame.children.length === 0) appendText(parent, frame.opener + marker);
    else appendNode(parent, { type: kind, children: frame.children });
  };

  const emphasisRun = (run: number) => {
    let n = run;
    while (n > 0) {
      const kind = top().kind;
      if (kind === "em" && n % 2 === 1) {
        closeEmphasis("em", "*");
        n -= 1;
      } else if (kind === "strong" && n >= 2) {
        closeEmphasis("strong", "**");
        n -= 2;
      } else if (n >= 2) {
        if (openCount.strong > 0) closeEmphasis("strong", "**");
        else openFrame("strong", "**");
        n -= 2;
      } else {
        if (openCount.em > 0) closeEmphasis("em", "*");
        else openFrame("em", "*");
        n -= 1;
      }
    }
  };

  const closeLink = (url: string) => {
    const frame = closeNearest("link");
    const parent = top().children;
    const safe = safeHref(url);
    if (safe === null) onUnsafeLink();
    if (frame.children.length === 0) {
      appendText(parent, `[](${url})`);
    } else if (safe === null) {
      for (const child of frame.children) appendNode(parent, child);
    } else {
      appendNode(parent, {
        type: "link",
        href: safe.href,
        external: safe.external,
        children: withoutLinks(frame.children),
      });
    }
  };

  let escapedAt = -1;
  let i = 0;
  while (i < length) {
    const c = s[i];
    if (c === "\\") {
      const next = s[i + 1];
      if (next !== undefined && ASCII_PUNCTUATION.test(next)) {
        appendText(top().children, next);
        escapedAt = i + 1;
        i += 2;
      } else {
        appendText(top().children, c);
        i += 1;
      }
    } else if (c === "*") {
      let end = i;
      while (end < length && s[end] === "*") end += 1;
      emphasisRun(end - i);
      i = end;
    } else if (c === "[") {
      if (i > 0 && s[i - 1] === "!" && escapedAt !== i - 1) appendText(top().children, c);
      else openFrame("link", c);
      i += 1;
    } else if (c === "]") {
      const close = nextClose[i + 2] ?? -1;
      if (
        openCount.link > 0 &&
        s[i + 1] === "(" &&
        close > i + 2 &&
        (nextSpace[i + 2] ?? length) > close
      ) {
        closeLink(s.slice(i + 2, close));
        i = close + 1;
      } else {
        appendText(top().children, c);
        i += 1;
      }
    } else {
      let end = i + 1;
      while (end < length && !isMarkup(s[end])) end += 1;
      appendText(top().children, s.slice(i, end));
      i = end;
    }
  }
  while (stack.length > 1) flattenTop();
  return top().children;
}

function isMarkup(c: string | undefined): boolean {
  return c === "\\" || c === "*" || c === "[" || c === "]";
}

/**
 * `TOO_LONG` (line 0, without parsing) when over `max`, else one `UNSAFE_LINK` per line holding an
 * unsafe link. `max` is one of `RICH_TEXT_MAX`; it is clamped to `RICH_TEXT_MAX.body`, the most the
 * parser reads, so no text is ever left unchecked (review M4).
 */
export function validateRichText(text: string, max: number): readonly RichTextIssue[] {
  if (text.length > Math.min(max, RICH_TEXT_MAX.body)) return [{ code: "TOO_LONG", line: 0 }];
  return parseRichText(text).unsafeLinkLines.map((line) => ({ code: "UNSAFE_LINK", line }));
}

/** A list or rule marker at the start of a line: `-` (items, `---`) or the digits of `1.`. */
const LINE_START_MARKER = /^([^\S\r\n]*)(-|\d{1,9}(?=\.))/gm;

/**
 * Makes a value plain text inside Morbeh text (template substitution, spec 2.3): inline markup is
 * escaped, and so is a block marker at the start of any line of the value (review M3), so `- x`,
 * `1. x` and `---` stay text wherever the value lands. `#` is escaped everywhere already.
 */
export function escapeRichText(value: string): string {
  return value
    .replace(/[\\*[\]#`]/g, "\\$&")
    .replace(LINE_START_MARKER, (_match, space: string, marker: string) =>
      marker === "-" ? `${space}\\-` : `${space}${marker}\\`,
    );
}

const EXTERNAL_REL = "noopener noreferrer nofollow";

/**
 * Renders a document through `h` (Ruling 10): only `RICH_TEXT_TAGS` and `RichTextProps`, text as
 * string children, `dir="auto"` on text blocks, and every href checked again by the link rules
 * (an unsafe one renders its label only). External links open in a new tab without an opener.
 */
export function renderRichText<E>(
  document: RichTextDocument,
  h: CreateElement<E>,
  classes: Partial<Readonly<Record<RichTextTag, string>>> = {},
): E[] {
  const propsFor = (
    tag: RichTextTag,
    key: string,
    textBlock: boolean,
    link?: { readonly href: string; readonly external: boolean },
  ): RichTextProps => {
    const props: {
      key: string;
      className?: string;
      dir?: "auto";
      href?: string;
      target?: "_blank";
      rel?: string;
    } = { key };
    const className = classes[tag];
    if (typeof className === "string" && className !== "") props.className = className;
    if (textBlock) props.dir = "auto";
    if (link) {
      props.href = link.href;
      if (link.external) {
        props.target = "_blank";
        props.rel = EXTERNAL_REL;
      }
    }
    return props;
  };

  const renderInlines = (nodes: readonly RichInline[], keyPrefix: string): (E | string)[] => {
    const out: (E | string)[] = [];
    nodes.forEach((node, index) => {
      const key = `${keyPrefix}${index}`;
      switch (node.type) {
        case "text":
          // A document from anywhere but the parser could carry a non-string (review M5).
          if (typeof node.value === "string") out.push(node.value);
          break;
        case "break":
          out.push(h("br", propsFor("br", key, false)));
          break;
        case "strong":
        case "em":
          out.push(
            h(node.type, propsFor(node.type, key, false), ...renderInlines(node.children, "")),
          );
          break;
        case "link": {
          const safe = safeHref(node.href);
          const children = renderInlines(node.children, safe === null ? `${key}.` : "");
          if (safe === null) for (const child of children) out.push(child);
          else out.push(h("a", propsFor("a", key, false, safe), ...children));
          break;
        }
      }
    });
    return out;
  };

  const out: E[] = [];
  document.blocks.forEach((block, index) => {
    const key = String(index);
    switch (block.type) {
      case "paragraph":
        out.push(h("p", propsFor("p", key, true), ...renderInlines(block.children, "")));
        break;
      case "heading": {
        const tag = block.level === 3 ? "h3" : "h2";
        out.push(h(tag, propsFor(tag, key, true), ...renderInlines(block.children, "")));
        break;
      }
      case "list": {
        const tag = block.ordered ? "ol" : "ul";
        const items = block.items.map((item, itemIndex) =>
          h("li", propsFor("li", String(itemIndex), true), ...renderInlines(item, "")),
        );
        out.push(h(tag, propsFor(tag, key, true), ...items));
        break;
      }
      case "rule":
        out.push(h("hr", propsFor("hr", key, false)));
        break;
    }
  });
  return out;
}
