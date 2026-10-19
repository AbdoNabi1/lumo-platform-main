import type { OrderHistoryEntryDto, TimelineEntryDto } from "@/lib/api/orders";
import type { Dictionary } from "@/messages/en";
import { zonedDay } from "./zoned-time";

/** One line of the merged timeline: a lifecycle event from `history`, or a staff entry. */
export type TimelineItem =
  | { readonly kind: "event"; readonly at: string; readonly event: OrderHistoryEntryDto }
  | { readonly kind: "entry"; readonly at: string; readonly entry: TimelineEntryDto };

/** The lines of one shop calendar day (`yyyy-mm-dd`), newest first. */
export interface TimelineDay {
  readonly day: string;
  readonly items: readonly TimelineItem[];
}

/**
 * Shopify's single timeline (spec §2.4): lifecycle history and staff entries as ONE list, newest first,
 * grouped by the shop's calendar day. At the same instant a staff line sits above the event it follows;
 * events keep their own newest-first order (the sort is stable over newest-first inputs).
 */
export function mergeTimeline(
  history: readonly OrderHistoryEntryDto[],
  entries: readonly TimelineEntryDto[],
  timeZone: string,
): readonly TimelineDay[] {
  const items: TimelineItem[] = [
    ...entries.map((entry): TimelineItem => ({ kind: "entry", at: entry.createdAt, entry })),
    ...[...history]
      .reverse()
      .map((event): TimelineItem => ({ kind: "event", at: event.occurredAt, event })),
  ];
  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const days: { day: string; items: TimelineItem[] }[] = [];
  for (const item of items) {
    const day = zonedDay(new Date(item.at), timeZone);
    const last = days[days.length - 1];
    if (last !== undefined && last.day === day) last.items.push(item);
    else days.push({ day, items: [item] });
  }
  return days;
}

/**
 * Fills `{name}` placeholders in ONE pass with a function replacer, so staff-written values (an author
 * name, a tag) go in literally: no `$&` pattern expansion and no re-scanning of inserted text.
 */
function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole: string, key: string) => values[key] ?? whole);
}

/** An activity line (or a deleted comment) in words: "Ahmed added tags VIP, urgent". */
export function activityLabel(entry: TimelineEntryDto, t: Dictionary): string {
  const words = t.orderTimeline;
  // Staff-written text keeps its own direction (FSI … PDI) so it cannot reorder the sentence around it.
  const author = isolateName(entry.authorName ?? words.staff);
  const tags = (entry.data.tags ?? []).map(isolateName).join(words.tagSeparator);
  switch (entry.kind) {
    case "archived":
      return fill(words.archived, { author });
    case "unarchived":
      return fill(words.unarchived, { author });
    case "note_changed":
      return fill(entry.data.cleared === true ? words.noteRemoved : words.noteChanged, { author });
    case "tags_added":
      return fill(words.tagsAdded, { author, tags });
    case "tags_removed":
      return fill(words.tagsRemoved, { author, tags });
    case "created_from_draft":
      return fill(words.createdFromDraft, { draft: entry.data.draftNumber ?? "" });
    case "comment":
      return entry.deleted ? words.commentDeleted : (entry.body ?? "");
    default:
      // A kind a newer API sends before this build has words for it: never a blank line.
      return words.staffActivity;
  }
}

/** Keeps a staff name's own direction from reordering the "name · time" line around it (FSI … PDI). */
export function isolateName(name: string): string {
  return `⁨${name}⁩`;
}
