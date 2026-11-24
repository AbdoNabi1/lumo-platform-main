import type { TemplateDraftBody, WhatsAppTemplateRowDto } from "@/lib/api/outreach";
import type { Dictionary } from "@/messages/en";

/**
 * Pure helpers for Settings → WhatsApp → Templates, shared by the server actions and the client components (no
 * server-only imports). Everything a merchant reads comes from the dictionary: a status, a rejection reason or an
 * issue code that isn't on a list collapses to generic copy, never to the raw value.
 */

/** Rows the list never shows: a deleted or archived template is gone from the merchant's point of view. */
const HIDDEN_STATUSES: ReadonlySet<string> = new Set(["DELETED", "ARCHIVED"]);

export function visibleTemplates(
  rows: readonly WhatsAppTemplateRowDto[],
): readonly WhatsAppTemplateRowDto[] {
  return rows.filter((row) => !HIDDEN_STATUSES.has(row.status));
}

type Lookup = Readonly<Record<string, string>>;

function lookup(table: Lookup, key: string, fallbackKey: string): string {
  return Object.hasOwn(table, key) && key !== fallbackKey
    ? (table[key] ?? table[fallbackKey] ?? "")
    : (table[fallbackKey] ?? "");
}

/** The copy for a template issue code (a 422 `fields[].message`); an unknown code reads "Check this field.". */
export function templateIssueMessage(code: unknown, t: Dictionary): string {
  const issues: Lookup = t.whatsappTemplates.issues;
  return typeof code === "string" ? lookup(issues, code, "unknown") : (issues["unknown"] ?? "");
}

export function languageLabel(language: string, t: Dictionary): string {
  return lookup(t.whatsappTemplates.languages, language, "other");
}

export function categoryLabel(category: string, t: Dictionary): string {
  return lookup(t.whatsappTemplates.categories, category, "other");
}

export function reasonText(reason: string | null, t: Dictionary): string {
  return lookup(t.whatsappTemplates.reasons, reason ?? "other", "other");
}

export type StatusVariant = "success" | "warning" | "destructive" | "neutral" | "info";

/** The badge for a template status: Approved green, Pending amber, Rejected red, Paused / Disabled / the rest neutral. */
export function templateStatusBadge(
  status: string,
  t: Dictionary,
): { readonly label: string; readonly variant: StatusVariant } {
  const label = lookup(t.whatsappTemplates.statuses, status, "other");
  switch (status) {
    case "APPROVED":
      return { label, variant: "success" };
    case "PENDING":
    case "IN_APPEAL":
      return { label, variant: "warning" };
    case "REJECTED":
      return { label, variant: "destructive" };
    case "PAUSED":
    case "DISABLED":
      return { label, variant: "neutral" };
    default:
      return { label, variant: "neutral" };
  }
}

// ── Draft body (what the create action sends) ────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function optionalString(value: unknown, max: number): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length <= max ? value : null;
}

/**
 * Rebuilds a draft field by field with the API's abuse bounds, or `null` when it is malformed. The API is strict (an
 * unknown key is a 422), and the domain still owns the real rules (a 422 per issue code).
 */
export function toTemplateDraftBody(input: unknown): TemplateDraftBody | null {
  if (!isRecord(input)) return null;
  const { name, language, category, header, body, footer, buttons } = input;
  if (typeof name !== "string" || name.length < 1 || name.length > 512) return null;
  if (typeof language !== "string" || language.length < 1 || language.length > 16) return null;
  if (category !== "UTILITY" && category !== "MARKETING") return null;
  if (!isRecord(body) || typeof body["text"] !== "string" || body["text"].length > 2000)
    return null;
  const examples = body["examples"];
  if (
    !Array.isArray(examples) ||
    examples.length > 20 ||
    !examples.every((e: unknown) => typeof e === "string" && e.length <= 1024)
  ) {
    return null;
  }

  let headerOut: TemplateDraftBody["header"];
  if (header !== undefined) {
    if (!isRecord(header) || header["format"] !== "TEXT" || typeof header["text"] !== "string") {
      return null;
    }
    const example = optionalString(header["example"], 200);
    if (header["text"].length > 200 || example === null) return null;
    headerOut = {
      format: "TEXT",
      text: header["text"],
      ...(example === undefined ? {} : { example }),
    };
  }

  let footerOut: TemplateDraftBody["footer"];
  if (footer !== undefined) {
    if (!isRecord(footer) || typeof footer["text"] !== "string" || footer["text"].length > 200) {
      return null;
    }
    footerOut = { text: footer["text"] };
  }

  let buttonsOut: NonNullable<TemplateDraftBody["buttons"]>[number][] | undefined;
  if (buttons !== undefined) {
    if (!Array.isArray(buttons) || buttons.length > 20) return null;
    buttonsOut = [];
    for (const button of buttons as unknown[]) {
      if (!isRecord(button)) return null;
      const type = button["type"];
      const text = button["text"];
      if ((type !== "QUICK_REPLY" && type !== "URL") || typeof text !== "string") return null;
      const url = optionalString(button["url"], 2100);
      const example = optionalString(button["example"], 2100);
      if (text.length > 200 || url === null || example === null) return null;
      buttonsOut.push({
        type,
        text,
        ...(url === undefined ? {} : { url }),
        ...(example === undefined ? {} : { example }),
      });
    }
  }

  return {
    name,
    language,
    category,
    ...(headerOut === undefined ? {} : { header: headerOut }),
    body: { text: body["text"], examples: [...(examples as string[])] },
    ...(footerOut === undefined ? {} : { footer: footerOut }),
    ...(buttonsOut === undefined ? {} : { buttons: buttonsOut }),
  };
}
