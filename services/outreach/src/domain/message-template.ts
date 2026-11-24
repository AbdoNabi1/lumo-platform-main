/**
 * WhatsApp message-template validation and Meta component serialisation. Pure; no I/O.
 *
 * Positional parameters only (`{{1}}`..`{{k}}`). Part 1 supports TEXT headers (or none); media headers and
 * AUTHENTICATION templates are deferred.
 */

export type TemplateCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";

export interface TemplateButton {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  text: string;
  url?: string;
  phoneNumber?: string;
  example?: string;
}

export interface TemplateDraft {
  name: string;
  language: string;
  category: TemplateCategory;
  header?: { format: "TEXT"; text: string; example?: string };
  body: { text: string; examples: string[] };
  footer?: { text: string };
  buttons?: TemplateButton[];
}

export interface TemplateIssue {
  field: string;
  code: string;
}

const NAME_PATTERN = /^[a-z0-9_]{1,512}$/;
const LANGUAGES: ReadonlySet<string> = new Set(["ar", "en", "en_US", "en_GB"]);
const BODY_MAX = 1024;
const HEADER_MAX = 60;
const FOOTER_MAX = 60;
const BUTTONS_MAX = 10;
const BUTTON_TEXT_MAX = 25;
const URL_MAX = 2000;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const URL_VARIABLE_SUFFIX = /\{\{1\}\}$/;

export interface ParsedVariables {
  /** True when the text has braces that are not a clean positional `{{n}}` parameter. */
  malformed: boolean;
  /** Every well-formed parameter index, in order of appearance (repeats included). */
  indices: number[];
  /** True when two parameters touch with nothing between them (`{{1}}{{2}}`). */
  adjacent: boolean;
}

/** Parses positional parameters. `{{ 1 }}`, `{{name}}`, `{{0}}`, `{{-1}}`, `{{01}}`, `{{{1}}}` and stray braces are malformed. */
export function parseVariables(text: string): ParsedVariables {
  const indices: number[] = [];
  let malformed = /\{{3,}|\}{3,}/.test(text);
  let adjacent = false;
  let lastEnd = -1;
  const token = /\{\{([^{}]*)\}\}/g;
  let rest = "";
  let cursor = 0;
  for (const m of text.matchAll(token)) {
    const start = m.index;
    const inner = m[1] ?? "";
    rest += text.slice(cursor, start);
    cursor = start + m[0].length;
    if (/^[1-9]\d*$/.test(inner)) {
      indices.push(Number(inner));
      if (start === lastEnd) adjacent = true;
    } else {
      malformed = true;
    }
    lastEnd = cursor;
  }
  rest += text.slice(cursor);
  if (/[{}]/.test(rest)) malformed = true;
  return { malformed, indices, adjacent };
}

function distinctSorted(indices: number[]): number[] {
  return [...new Set(indices)].sort((a, b) => a - b);
}

function isContiguousFromOne(sorted: number[]): boolean {
  return sorted.every((n, i) => n === i + 1);
}

/** Number of DISTINCT positional variables (a repeated `{{1}}` counts once). */
export function bodyVariableCount(text: string): number {
  return distinctSorted(parseVariables(text).indices).length;
}

function validateButtons(buttons: TemplateButton[], issues: TemplateIssue[]): void {
  if (buttons.length > BUTTONS_MAX) issues.push({ field: "buttons", code: "buttons_count" });

  buttons.forEach((b, i) => {
    const textField = `buttons[${i}].text`;
    if (b.text.trim().length === 0) issues.push({ field: textField, code: "button_text_empty" });
    else if (b.text.length > BUTTON_TEXT_MAX)
      issues.push({ field: textField, code: "button_text_length" });

    if (b.type === "URL") validateUrlButton(b, i, issues);
    if (
      b.type === "PHONE_NUMBER" &&
      !(typeof b.phoneNumber === "string" && E164_PATTERN.test(b.phoneNumber))
    ) {
      issues.push({ field: `buttons[${i}].phoneNumber`, code: "phone_invalid" });
    }
  });

  if (buttons.filter((b) => b.type === "URL").length > 2)
    issues.push({ field: "buttons", code: "url_buttons_count" });
  if (buttons.filter((b) => b.type === "PHONE_NUMBER").length > 1) {
    issues.push({ field: "buttons", code: "phone_buttons_count" });
  }

  // Quick replies must form one contiguous group; a switch between quick-reply and CTA more than once is interleaving.
  let switches = 0;
  for (let i = 1; i < buttons.length; i++) {
    if ((buttons[i]!.type === "QUICK_REPLY") !== (buttons[i - 1]!.type === "QUICK_REPLY"))
      switches++;
  }
  if (switches > 1) issues.push({ field: "buttons", code: "buttons_mixed_order" });
}

function validateUrlButton(b: TemplateButton, i: number, issues: TemplateIssue[]): void {
  const urlField = `buttons[${i}].url`;
  const exampleField = `buttons[${i}].example`;
  const value = b.url;
  if (typeof value !== "string" || value.length === 0) {
    issues.push({ field: urlField, code: "url_invalid" });
    return;
  }
  if (value.length > URL_MAX) {
    issues.push({ field: urlField, code: "url_too_long" });
    return;
  }
  const hasVariable = URL_VARIABLE_SUFFIX.test(value);
  const staticPart = hasVariable ? value.slice(0, -"{{1}}".length) : value;
  if (!isHttpsUrl(staticPart) || /[{}]/.test(staticPart)) {
    issues.push({ field: urlField, code: "url_invalid" });
    return;
  }
  if (hasVariable && (b.example === undefined || b.example.trim().length === 0)) {
    issues.push({ field: exampleField, code: "url_example_missing" });
  }
  if (b.example !== undefined && b.example.length > URL_MAX)
    issues.push({ field: exampleField, code: "url_too_long" });
}

function isHttpsUrl(value: string): boolean {
  if (!value.startsWith("https://") || /\s/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

export function validateTemplateDraft(d: TemplateDraft): TemplateIssue[] {
  const issues: TemplateIssue[] = [];

  if (!NAME_PATTERN.test(d.name)) issues.push({ field: "name", code: "name_format" });
  if (!LANGUAGES.has(d.language)) issues.push({ field: "language", code: "language_unsupported" });
  if (d.category !== "UTILITY" && d.category !== "MARKETING") {
    issues.push({ field: "category", code: "category_unsupported" });
  }

  if (d.header !== undefined) {
    const text = d.header.text;
    if (text.trim().length === 0 || text.length > HEADER_MAX)
      issues.push({ field: "header.text", code: "header_length" });
    const vars = parseVariables(text);
    if (vars.malformed) {
      issues.push({ field: "header.text", code: "variable_malformed" });
    } else if (vars.indices.length > 0) {
      if (vars.indices.length > 1 || vars.indices[0] !== 1) {
        issues.push({ field: "header.text", code: "header_variables" });
      } else if (d.header.example === undefined || d.header.example.trim().length === 0) {
        issues.push({ field: "header.example", code: "header_example_missing" });
      }
    }
  }

  const bodyText = d.body.text;
  if (bodyText.trim().length === 0 || bodyText.length > BODY_MAX)
    issues.push({ field: "body.text", code: "body_length" });
  const bodyVars = parseVariables(bodyText);
  if (bodyVars.malformed) {
    issues.push({ field: "body.text", code: "variable_malformed" });
  } else {
    const distinct = distinctSorted(bodyVars.indices);
    if (!isContiguousFromOne(distinct))
      issues.push({ field: "body.text", code: "variables_not_sequential" });
    if (bodyVars.adjacent) issues.push({ field: "body.text", code: "variables_adjacent" });
    const trimmed = bodyText.trim();
    if (distinct.length > 0 && (/^\{\{\d+\}\}/.test(trimmed) || /\{\{\d+\}\}$/.test(trimmed))) {
      issues.push({ field: "body.text", code: "variable_at_edge" });
    }
    if (d.body.examples.length !== distinct.length)
      issues.push({ field: "body.examples", code: "examples_mismatch" });
    if (d.body.examples.some((e) => e.trim().length === 0))
      issues.push({ field: "body.examples", code: "example_empty" });
  }

  if (d.footer !== undefined) {
    const text = d.footer.text;
    if (text.trim().length === 0 || text.length > FOOTER_MAX)
      issues.push({ field: "footer.text", code: "footer_length" });
    if (/\{\{|\}\}/.test(text)) issues.push({ field: "footer.text", code: "footer_variables" });
  }

  if (d.buttons !== undefined && d.buttons.length > 0) validateButtons(d.buttons, issues);

  return issues;
}

/** Serialises a (valid) draft to Meta's `components` array. Empty parts are omitted; `example` only when parameters exist. */
export function toMetaComponents(d: TemplateDraft): unknown[] {
  const components: unknown[] = [];

  if (d.header !== undefined) {
    const hasVariable = parseVariables(d.header.text).indices.length > 0;
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: d.header.text,
      ...(hasVariable ? { example: { header_text: [d.header.example ?? ""] } } : {}),
    });
  }

  components.push({
    type: "BODY",
    text: d.body.text,
    ...(bodyVariableCount(d.body.text) > 0 ? { example: { body_text: [d.body.examples] } } : {}),
  });

  if (d.footer !== undefined) components.push({ type: "FOOTER", text: d.footer.text });

  if (d.buttons !== undefined && d.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: d.buttons.map((b) => {
        if (b.type === "QUICK_REPLY") return { type: "QUICK_REPLY", text: b.text };
        if (b.type === "PHONE_NUMBER")
          return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phoneNumber };
        const hasVariable = URL_VARIABLE_SUFFIX.test(b.url ?? "");
        return {
          type: "URL",
          text: b.text,
          url: b.url,
          ...(hasVariable ? { example: [b.example ?? ""] } : {}),
        };
      }),
    });
  }

  return components;
}
