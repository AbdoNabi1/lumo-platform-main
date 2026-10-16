/**
 * Dates in the store's time zone (Settings → General), as Shopify's discount form shows them. The
 * merchant's browser may sit in another zone than the store, so a typed date and time is converted
 * here, with the zone named explicitly — never with the machine's own zone.
 */

const FALLBACK_ZONE = "UTC";

/** The zone itself when `Intl` knows it, otherwise UTC. */
export function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_ZONE;
  }
}

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function wallClockOf(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
  };
}

/** How far the zone's wall clock is ahead of UTC at `instant`, in ms. */
function offsetAt(instant: number, timeZone: string): number {
  const wall = wallClockOf(new Date(instant), timeZone);
  const minuteFloor = Math.floor(instant / 60_000) * 60_000;
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - minuteFloor;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** "2026-10-16" + "14:30" on the zone's wall clock → an ISO instant; null when it is not a real date or time. */
export function zonedToIso(date: string, time: string, timeZone: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (dateMatch === null || timeMatch === null) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(wall).getUTCDate() !== day) return null;
  const zone = safeZone(timeZone);
  // Two passes settle the offset on either side of a daylight-saving change.
  let instant = wall - offsetAt(wall, zone);
  instant = wall - offsetAt(instant, zone);
  return new Date(instant).toISOString();
}

/** An ISO instant as the date and time the zone's wall clock shows ("2026-10-16", "14:30"). */
export function isoToZoned(
  iso: string,
  timeZone: string,
): { readonly date: string; readonly time: string } {
  const wall = wallClockOf(new Date(iso), safeZone(timeZone));
  return {
    date: `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`,
    time: `${pad(wall.hour)}:${pad(wall.minute)}`,
  };
}

/** The zone's short name for a label: "EET", "GMT+4", "UTC". */
export function zoneLabel(timeZone: string, locale: string, at: Date = new Date()): string {
  const zone = safeZone(timeZone);
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    timeZoneName: "short",
  }).formatToParts(at);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? zone;
}

/** "Oct 16, 2026" in the store's zone. */
export function formatZonedDate(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: safeZone(timeZone),
  }).format(new Date(iso));
}
