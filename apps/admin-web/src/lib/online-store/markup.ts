import {
  normalizePlainText,
  RICH_TEXT_MAX,
  safeHref,
  validateRichText,
  type RichTextIssue,
} from "@platform/storefront-content";

/**
 * The Morbeh text toolbar (spec 2.7) as pure text edits: each tool rewrites the textarea's text
 * around its selection and says what to select afterwards. Inline markup never spans lines
 * (Ruling 8), so a multi-line selection is wrapped line by line.
 */
export type MarkupKind = "h2" | "h3" | "bold" | "italic" | "bullets" | "numbers" | "link";

export interface TextSelection {
  readonly start: number;
  readonly end: number;
}

export interface MarkupResult {
  readonly text: string;
  readonly selection: TextSelection;
}

/** What the link tool puts where the address goes; selected so the merchant types over it. */
const URL_PLACEHOLDER = "https://";
const HEADING_PREFIX = /^#{2,3} +/;
const BULLET_PREFIX = /^- +/;
const NUMBER_PREFIX = /^\d{1,9}\. +/;
const LIST_PREFIX = /^(?:- +|\d{1,9}\. +)/;

/** The start and end of the lines the selection covers (a selection ending at a line's start leaves it out). */
function lineRange(text: string, start: number, end: number): { from: number; to: number } {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const last = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const newline = text.indexOf("\n", last);
  return { from, to: newline === -1 ? text.length : newline };
}

function splice(text: string, from: number, to: number, insert: string): string {
  return `${text.slice(0, from)}${insert}${text.slice(to)}`;
}

function heading(text: string, at: TextSelection, level: 2 | 3): MarkupResult {
  const { from } = lineRange(text, at.start, at.start);
  const lineEnd = text.indexOf("\n", from) === -1 ? text.length : text.indexOf("\n", from);
  const line = text.slice(from, lineEnd);
  const existing = HEADING_PREFIX.exec(line)?.[0] ?? "";
  const target = `${"#".repeat(level)} `;
  const sameLevel = existing.trimEnd() === target.trimEnd();
  const prefix = sameLevel ? "" : target;
  const next = splice(text, from, from + existing.length, prefix);
  const shift = (position: number) =>
    Math.max(from + prefix.length, position - existing.length + prefix.length);
  return { text: next, selection: { start: shift(at.start), end: shift(at.end) } };
}

function list(text: string, at: TextSelection, ordered: boolean): MarkupResult {
  const { from, to } = lineRange(text, at.start, at.end);
  const lines = text.slice(from, to).split("\n");
  const own = ordered ? NUMBER_PREFIX : BULLET_PREFIX;
  const filled = lines.filter((line) => line.trim() !== "");
  const already = filled.length > 0 && filled.every((line) => own.test(line));
  let number = 0;
  const rewritten = lines.map((line) => {
    const bare = line.replace(LIST_PREFIX, "");
    if (already || bare.trim() === "") return bare;
    number += 1;
    return `${ordered ? `${number}.` : "-"} ${bare}`;
  });
  const region = rewritten.join("\n");
  const next = splice(text, from, to, region);
  const selection =
    at.start === at.end
      ? { start: from + region.length, end: from + region.length }
      : { start: from, end: from + region.length };
  return { text: next, selection };
}

/** `**x**` / `*x*` around the selection's text, its edge spaces left outside the markers. */
function wrapInline(text: string, at: TextSelection, marker: string): MarkupResult {
  if (at.start === at.end) {
    const next = splice(text, at.start, at.end, `${marker}${marker}`);
    const caret = at.start + marker.length;
    return { text: next, selection: { start: caret, end: caret } };
  }
  const selected = text.slice(at.start, at.end);
  const wrapLine = (line: string) => {
    const core = line.trim();
    if (core === "") return { out: line, coreStart: -1 };
    const lead = line.slice(0, line.length - line.trimStart().length);
    const trail = line.slice(line.trimEnd().length);
    return { out: `${lead}${marker}${core}${marker}${trail}`, coreStart: lead.length };
  };
  if (!selected.includes("\n")) {
    const { out, coreStart } = wrapLine(selected);
    const next = splice(text, at.start, at.end, out);
    if (coreStart === -1) return { text: next, selection: at };
    const start = at.start + coreStart + marker.length;
    return { text: next, selection: { start, end: start + selected.trim().length } };
  }
  const out = selected
    .split("\n")
    .map((line) => wrapLine(line).out)
    .join("\n");
  return {
    text: splice(text, at.start, at.end, out),
    selection: { start: at.start, end: at.start + out.length },
  };
}

/**
 * `[label](https://)` with the placeholder selected. A selection that is itself a link the shared
 * rules accept becomes both label and address, the address in its canonical form (a path is
 * percent-encoded, which is what the storefront and the API store).
 */
function link(text: string, at: TextSelection): MarkupResult {
  const newline = text.indexOf("\n", at.start);
  const end = newline !== -1 && newline < at.end ? newline : at.end;
  const selected = text.slice(at.start, end);
  const label = selected.trim();
  const lead = selected.slice(0, selected.length - selected.trimStart().length);
  const trail = selected.slice(selected.trimEnd().length);
  const asHref = label === "" ? null : safeHref(label);
  if (asHref !== null) {
    const insert = `${lead}[${label}](${asHref.href})${trail}`;
    const start = at.start + lead.length + 1;
    return {
      text: splice(text, at.start, end, insert),
      selection: { start, end: start + label.length },
    };
  }
  const insert = `${lead}[${label}](${URL_PLACEHOLDER})${trail}`;
  if (label === "") {
    const caret = at.start + lead.length + 1;
    return { text: splice(text, at.start, end, insert), selection: { start: caret, end: caret } };
  }
  const start = at.start + lead.length + label.length + 3;
  return {
    text: splice(text, at.start, end, insert),
    selection: { start, end: start + URL_PLACEHOLDER.length },
  };
}

/** Applies one toolbar tool to `text` at `selection` (clamped to the text). */
export function applyMarkup(
  text: string,
  selection: TextSelection,
  kind: MarkupKind,
): MarkupResult {
  const clamp = (n: number) => Math.min(Math.max(0, Math.trunc(n)), text.length);
  const a = clamp(selection.start);
  const b = clamp(selection.end);
  const at = { start: Math.min(a, b), end: Math.max(a, b) };
  switch (kind) {
    case "h2":
      return heading(text, at, 2);
    case "h3":
      return heading(text, at, 3);
    case "bullets":
      return list(text, at, false);
    case "numbers":
      return list(text, at, true);
    case "bold":
      return wrapInline(text, at, "**");
    case "italic":
      return wrapInline(text, at, "*");
    case "link":
      return link(text, at);
  }
}

/** The text's length as it will be stored: the API normalises (trims, drops controls) first. */
export function richTextLength(text: string): number {
  return normalizePlainText(text, { multiline: true }).length;
}

/**
 * The shared validator's issues for what the API will check (the normalised text), with line
 * numbers as the textarea shows them: normalising trims leading blank lines, which are added back.
 */
export function richTextIssues(text: string, max: number): readonly RichTextIssue[] {
  const normalized = normalizePlainText(text, { multiline: true });
  const leadingLines = (/^\s*/.exec(text)?.[0].match(/\n/g) ?? []).length;
  return validateRichText(normalized, Math.min(max, RICH_TEXT_MAX.body)).map((issue) =>
    issue.code === "UNSAFE_LINK" ? { code: issue.code, line: issue.line + leadingLines } : issue,
  );
}
