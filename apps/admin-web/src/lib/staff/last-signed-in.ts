import type { Locale } from "@/lib/i18n";
import { formatMediumDate } from "@/lib/format";
import type { Dictionary } from "@/messages/en";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * "Last signed in": a relative phrase for the last month ("3 days ago", "٣ أيام"), a plain date
 * after that, "Never" when the person has not signed in yet. `nowIso` comes from the server render
 * so the same text is produced on every pass.
 */
export function formatLastSignedIn(
  iso: string | null,
  nowIso: string,
  locale: Locale,
  t: Dictionary,
): string {
  if (iso === null) return t.users.never;
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(then) || Number.isNaN(now)) return t.users.never;
  const elapsed = Math.max(0, now - then);
  if (elapsed < MINUTE_MS) return t.users.justNow;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (elapsed < HOUR_MS) return rtf.format(-Math.floor(elapsed / MINUTE_MS), "minute");
  if (elapsed < DAY_MS) return rtf.format(-Math.floor(elapsed / HOUR_MS), "hour");
  if (elapsed < 30 * DAY_MS) return rtf.format(-Math.floor(elapsed / DAY_MS), "day");
  return formatMediumDate(locale, iso);
}
