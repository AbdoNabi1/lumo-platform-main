import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

/** Shopify's limits (order operations spec §2.1). Lengths count characters (code points). */
export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS_PER_ORDER = 250;
export const MAX_NOTE_LENGTH = 5000;
/** `GET /order-tags` answers at most this many suggestions. */
export const TAG_SUGGESTION_LIMIT = 50;

/** One tag as stored: the display spelling and its case-insensitive identity (`tag_key`). */
export interface OrderTag {
  readonly tag: string;
  readonly tagKey: string;
}

/** One distinct tag of a shop and how many orders carry it (suggestions). */
export interface TagUsage {
  readonly tag: string;
  readonly count: number;
}

/** Characters as a person counts them: an emoji or an Arabic letter is one. */
export function characterCount(text: string): number {
  return [...text].length;
}

/** The display spelling: NFC, every run of whitespace one space, trimmed. */
export function normalizeTag(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/gu, " ").trim();
}

/** The identity used for dedupe and filtering (`tag_key`): the normalized tag, lower-cased. */
export function tagKeyOf(raw: string): string {
  return normalizeTag(raw).toLowerCase();
}

/**
 * Typed tags → the distinct tags to store. A comma splits one entry into two (Shopify's input rule),
 * blanks are dropped, and tags that differ only in case or spacing collapse to the FIRST spelling.
 * A tag longer than {@link MAX_TAG_LENGTH} characters refuses the whole list (nothing half-applied).
 */
export function parseTags(raw: readonly string[]): Result<readonly OrderTag[], ValidationError> {
  const seen = new Map<string, OrderTag>();
  for (const entry of raw) {
    for (const part of entry.split(",")) {
      const tag = normalizeTag(part);
      if (tag.length === 0) continue;
      if (characterCount(tag) > MAX_TAG_LENGTH) {
        return err(
          new ValidationError(`A tag can have at most ${MAX_TAG_LENGTH} characters`, [
            { field: "tags", message: `must be at most ${MAX_TAG_LENGTH} characters each` },
          ]),
        );
      }
      const tagKey = tag.toLowerCase();
      if (!seen.has(tagKey)) seen.set(tagKey, { tag, tagKey });
    }
  }
  return ok([...seen.values()]);
}

/** A note as stored: ends trimmed, inner line breaks kept; blank → null ("No notes"); ≤ 5,000 characters. */
export function normalizeNote(raw: string | null): Result<string | null, ValidationError> {
  if (raw === null) return ok(null);
  const note = raw.normalize("NFC").trim();
  if (note.length === 0) return ok(null);
  if (characterCount(note) > MAX_NOTE_LENGTH) {
    return err(
      new ValidationError(`A note can have at most ${MAX_NOTE_LENGTH} characters`, [
        { field: "note", message: `must be at most ${MAX_NOTE_LENGTH} characters` },
      ]),
    );
  }
  return ok(note);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** An order's tags in display order: by key (case-insensitive), then by spelling. */
export function sortTags(tags: readonly string[]): string[] {
  return [...tags].sort((a, b) => compareText(tagKeyOf(a), tagKeyOf(b)) || compareText(a, b));
}

/** A requested suggestion count, kept within 1..{@link TAG_SUGGESTION_LIMIT}. */
export function clampSuggestionLimit(limit: number): number {
  if (!Number.isFinite(limit)) return TAG_SUGGESTION_LIMIT;
  return Math.max(1, Math.min(Math.trunc(limit), TAG_SUGGESTION_LIMIT));
}
