interface ZonedParts {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly hour: string;
  readonly minute: string;
  readonly second: string;
}

function partsIn(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** The shop's calendar day (`yyyy-mm-dd`) of an instant. */
export function zonedDay(instant: Date, timeZone: string): string {
  const p = partsIn(instant, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `yyyy-mm-dd HH:mm` in the shop's time zone — the CSV's Date column (spec §1.5). */
export function zonedDateTimeLabel(iso: string, timeZone: string): string {
  const p = partsIn(new Date(iso), timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** How far the zone's wall clock is ahead of UTC at `instant`, in ms. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const wall = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

function utcMidnight(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1);
}

/** The instant a shop-local day starts (offset re-read once, so a DST change at midnight lands right). */
export function startOfZonedDay(day: string, timeZone: string): Date {
  const midnight = utcMidnight(day);
  const guess = midnight - offsetMs(new Date(midnight), timeZone);
  return new Date(midnight - offsetMs(new Date(guess), timeZone));
}

export function nextDay(day: string): string {
  return new Date(utcMidnight(day) + 86_400_000).toISOString().slice(0, 10);
}

/** A real calendar day written `yyyy-mm-dd` (what `<input type="date">` submits). */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(utcMidnight(value)).toISOString().slice(0, 10) === value;
}
