/**
 * Browser-safe mirror of the Task 2 template rules (`services/outreach/src/domain/message-template.ts`), for instant
 * feedback in the template form. No server-only imports. The API stays authoritative: a 422 carries the same issue
 * codes, and `template-rules.parity.test.ts` feeds the SAME fixtures to this mirror and to the real domain validator
 * and deep-equals the results, so the two cannot drift silently.
 */

export type TemplateCategory = "UTILITY" | "MARKETING";

export interface TemplateButtonDraft {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  text: string;
  url?: string;
  phoneNumber?: string;
  example?: string;
}

export interface TemplateDraftInput {
  name: string;
  language: string;
  category: TemplateCategory | "AUTHENTICATION";
  header?: { format: "TEXT"; text: string; example?: string };
  body: { text: string; examples: readonly string[] };
  footer?: { text: string };
  buttons?: readonly TemplateButtonDraft[];
}

export interface TemplateIssueCode {
  field: string;
  code: string;
}

/** Every issue code the validator (and the API's 422 `fields[].message`) can produce. Copied from Task 2. */
export const TEMPLATE_ISSUE_CODES: readonly string[] = [
  "name_format",
  "language_unsupported",
  "category_unsupported",
  "header_length",
  "variable_malformed",
  "header_variables",
  "header_example_missing",
  "body_length",
  "variables_not_sequential",
  "variables_adjacent",
  "variable_at_edge",
  "examples_mismatch",
  "example_empty",
  "footer_length",
  "footer_variables",
  "buttons_count",
  "button_text_empty",
  "button_text_length",
  "url_invalid",
  "url_too_long",
  "url_example_missing",
  "phone_invalid",
  "url_buttons_count",
  "phone_buttons_count",
  "buttons_mixed_order",
];

const NAME_PATTERN = /^[a-z0-9_]{1,512}$/;
export const TEMPLATE_LANGUAGES: readonly string[] = ["ar", "en", "en_US", "en_GB"];
const BODY_MAX = 1024;
const HEADER_MAX = 60;
const FOOTER_MAX = 60;
const BUTTONS_MAX = 10;
const BUTTON_TEXT_MAX = 25;
const URL_MAX = 2000;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const URL_VARIABLE_SUFFIX = /\{\{1\}\}$/;

/** The limits the form enforces on top of Meta's (quick replies and URL buttons are capped lower in the UI). */
export const FORM_LIMITS = {
  quickReplies: 3,
  urlButtons: 2,
  body: BODY_MAX,
  header: HEADER_MAX,
  footer: FOOTER_MAX,
  buttonText: BUTTON_TEXT_MAX,
} as const;

export interface ParsedVariables {
  malformed: boolean;
  indices: number[];
  adjacent: boolean;
}

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

/** The next `{{n}}` an "Add variable" button inserts: one past the highest well-formed index (1 when there is none). */
export function nextVariableToken(text: string): string {
  const { indices } = parseVariables(text);
  const highest = indices.reduce((max, n) => (n > max ? n : max), 0);
  return `{{${highest + 1}}}`;
}

function validateButtons(
  buttons: readonly TemplateButtonDraft[],
  issues: TemplateIssueCode[],
): void {
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

  let switches = 0;
  for (let i = 1; i < buttons.length; i++) {
    if ((buttons[i]!.type === "QUICK_REPLY") !== (buttons[i - 1]!.type === "QUICK_REPLY"))
      switches++;
  }
  if (switches > 1) issues.push({ field: "buttons", code: "buttons_mixed_order" });
}

function validateUrlButton(b: TemplateButtonDraft, i: number, issues: TemplateIssueCode[]): void {
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

/** The browser mirror of `validateTemplateDraft`: same input, same `{field, code}` issues, same order. */
export function validateTemplateDraft(d: TemplateDraftInput): TemplateIssueCode[] {
  const issues: TemplateIssueCode[] = [];

  if (!NAME_PATTERN.test(d.name)) issues.push({ field: "name", code: "name_format" });
  if (!TEMPLATE_LANGUAGES.includes(d.language))
    issues.push({ field: "language", code: "language_unsupported" });
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

/**
 * The name a label becomes: lowercase, spaces → `_`, every other character outside `[a-z0-9_]` stripped. A label with
 * no Latin letters or digits (an Arabic one) gives an empty name, which the merchant then types.
 */
export function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 512);
}

/** Replaces each `{{n}}` with its example (an unfilled example leaves the placeholder visible). */
export function substituteExamples(text: string, examples: readonly string[]): string {
  return text.replace(/\{\{([1-9]\d*)\}\}/g, (whole, digits: string) => {
    const example = examples[Number(digits) - 1];
    return example !== undefined && example.trim().length > 0 ? example : whole;
  });
}
