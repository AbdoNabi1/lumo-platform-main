/**
 * Builds the Meta `components` array for a template SEND and validates free-form (session) messages. Pure; no I/O.
 */

import { parseVariables, type TemplateIssue } from "./message-template";

export interface TemplateSendValues {
  /** One per distinct body variable index, in index order. */
  body: string[];
  /** Required iff the approved header has `{{1}}`. */
  header?: string;
  /** Button index -> suffix; required for each URL button whose url ends with `{{1}}`. */
  urlSuffixes?: Record<number, string>;
}

export interface StoredTemplateShape {
  bodyVariableCount: number;
  headerHasVariable: boolean;
  buttons: Array<{
    index: number;
    type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
    urlHasVariable: boolean;
  }>;
  /** False when the components contain anything Part 1 does not model (media header, OTP, catalog, flows, carousel...). */
  supported: boolean;
}

const UNSUPPORTED: StoredTemplateShape = {
  bodyVariableCount: 0,
  headerHasVariable: false,
  buttons: [],
  supported: false,
};

function unsupported(): StoredTemplateShape {
  return { ...UNSUPPORTED, buttons: [] };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Reads the stored (Meta-shaped) components and reports what a send must supply. Anything unrecognised is unsupported. */
export function shapeOfStoredTemplate(components: unknown): StoredTemplateShape {
  if (!Array.isArray(components)) return unsupported();

  let bodyVariableCount = 0;
  let headerHasVariable = false;
  let bodySeen = false;
  let headerSeen = false;
  const buttons: StoredTemplateShape["buttons"] = [];

  for (const c of components as unknown[]) {
    if (!isRecord(c) || typeof c.type !== "string") return unsupported();
    switch (c.type.toUpperCase()) {
      case "HEADER": {
        if (headerSeen) return unsupported();
        headerSeen = true;
        if (
          typeof c.format !== "string" ||
          c.format.toUpperCase() !== "TEXT" ||
          typeof c.text !== "string"
        ) {
          return unsupported();
        }
        const vars = parseVariables(c.text);
        if (
          vars.malformed ||
          vars.indices.length > 1 ||
          (vars.indices.length === 1 && vars.indices[0] !== 1)
        ) {
          return unsupported();
        }
        headerHasVariable = vars.indices.length === 1;
        break;
      }
      case "BODY": {
        if (bodySeen || typeof c.text !== "string") return unsupported();
        bodySeen = true;
        const vars = parseVariables(c.text);
        const distinct = [...new Set(vars.indices)].sort((a, b) => a - b);
        if (vars.malformed || !distinct.every((n, i) => n === i + 1)) return unsupported();
        bodyVariableCount = distinct.length;
        break;
      }
      case "FOOTER":
        break;
      case "BUTTONS": {
        if (!Array.isArray(c.buttons)) return unsupported();
        for (const b of c.buttons as unknown[]) {
          if (!isRecord(b) || typeof b.type !== "string") return unsupported();
          const type = b.type.toUpperCase();
          if (type !== "QUICK_REPLY" && type !== "URL" && type !== "PHONE_NUMBER")
            return unsupported();
          let urlHasVariable = false;
          if (type === "URL") {
            // Part 1 URL model: a static URL, or exactly one clean positional {{1}} at the very end.
            if (typeof b.url !== "string") return unsupported();
            const vars = parseVariables(b.url);
            if (vars.malformed || vars.indices.length > 1) return unsupported();
            if (vars.indices.length === 1) {
              if (vars.indices[0] !== 1 || !b.url.endsWith("{{1}}")) return unsupported();
              urlHasVariable = true;
            }
          }
          buttons.push({ index: buttons.length, type, urlHasVariable });
        }
        break;
      }
      default:
        return unsupported();
    }
  }

  if (!bodySeen) return unsupported();
  return { bodyVariableCount, headerHasVariable, buttons, supported: true };
}

const blank = (v: string | undefined): boolean => v === undefined || v.trim().length === 0;

/**
 * Builds the `components` of a template send message. Components appear in Meta's order: header, body, then one entry per
 * button that needs a parameter (URL with a variable, every quick reply) in button-index order.
 */
export function buildTemplateSendComponents(
  shape: StoredTemplateShape,
  values: TemplateSendValues,
  quickReplyPayloadFor: (buttonIndex: number) => string,
): { ok: true; components: unknown[] } | { ok: false; issues: TemplateIssue[] } {
  if (!shape.supported)
    return { ok: false, issues: [{ field: "template", code: "template_unsupported" }] };

  const issues: TemplateIssue[] = [];

  if (values.body.length !== shape.bodyVariableCount || values.body.some((v) => blank(v))) {
    issues.push({ field: "body", code: "send_values_mismatch" });
  }

  if (shape.headerHasVariable) {
    if (blank(values.header)) issues.push({ field: "header", code: "header_value_missing" });
  } else if (values.header !== undefined) {
    issues.push({ field: "header", code: "send_values_mismatch" });
  }

  const suffixes = values.urlSuffixes ?? {};
  for (const b of shape.buttons) {
    if (b.type === "URL" && b.urlHasVariable && blank(suffixes[b.index])) {
      issues.push({ field: `urlSuffixes[${b.index}]`, code: "url_suffix_missing" });
    }
  }
  const acceptsSuffix = new Set(
    shape.buttons.filter((b) => b.type === "URL" && b.urlHasVariable).map((b) => b.index),
  );
  for (const key of Object.keys(suffixes)) {
    if (!acceptsSuffix.has(Number(key)))
      issues.push({ field: `urlSuffixes[${key}]`, code: "send_values_mismatch" });
  }

  if (issues.length > 0) return { ok: false, issues };

  const components: unknown[] = [];
  if (shape.headerHasVariable) {
    components.push({ type: "header", parameters: [{ type: "text", text: values.header }] });
  }
  if (shape.bodyVariableCount > 0) {
    components.push({
      type: "body",
      parameters: values.body.map((text) => ({ type: "text", text })),
    });
  }
  for (const b of shape.buttons) {
    if (b.type === "URL" && b.urlHasVariable) {
      components.push({
        type: "button",
        sub_type: "url",
        index: String(b.index),
        parameters: [{ type: "text", text: suffixes[b.index] }],
      });
    } else if (b.type === "QUICK_REPLY") {
      components.push({
        type: "button",
        sub_type: "quick_reply",
        index: String(b.index),
        parameters: [{ type: "payload", payload: quickReplyPayloadFor(b.index) }],
      });
    }
  }
  return { ok: true, components };
}

const SESSION_TEXT_MAX = 4096;
const SESSION_BODY_WITH_BUTTONS_MAX = 1024;
const SESSION_BUTTONS_MAX = 3;
const SESSION_BUTTON_ID_MAX = 256;
const SESSION_BUTTON_TITLE_MAX = 20;

/** Validates a free-form message sent inside the 24h window (text, or text + 1-3 reply buttons). */
export function validateSessionInput(i: {
  text: string;
  buttons?: { id: string; title: string }[];
}): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const text = typeof i.text === "string" ? i.text : "";
  const hasButtons = i.buttons !== undefined;
  const buttons = i.buttons ?? [];

  if (text.trim().length === 0) {
    issues.push({ field: "text", code: "text_required" });
  } else if (text.length > (hasButtons ? SESSION_BODY_WITH_BUTTONS_MAX : SESSION_TEXT_MAX)) {
    issues.push({ field: "text", code: "text_length" });
  }

  if (hasButtons) {
    if (buttons.length < 1 || buttons.length > SESSION_BUTTONS_MAX)
      issues.push({ field: "buttons", code: "buttons_count" });
    const ids = new Set<string>();
    const titles = new Set<string>();
    buttons.forEach((b, idx) => {
      const id = b.id.trim();
      if (id.length === 0 || b.id.length > SESSION_BUTTON_ID_MAX) {
        issues.push({ field: `buttons[${idx}].id`, code: "button_id_invalid" });
      } else if (ids.has(id)) {
        issues.push({ field: `buttons[${idx}].id`, code: "button_id_duplicate" });
      } else ids.add(id);

      const title = b.title.trim();
      if (title.length === 0 || b.title.length > SESSION_BUTTON_TITLE_MAX) {
        issues.push({ field: `buttons[${idx}].title`, code: "button_title_length" });
      } else if (titles.has(title)) {
        issues.push({ field: `buttons[${idx}].title`, code: "button_title_duplicate" });
      } else titles.add(title);
    });
  }

  return issues;
}
