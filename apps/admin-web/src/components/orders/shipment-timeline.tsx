import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

export interface TimelineEvent {
  readonly description: string;
  readonly location: string | null;
  readonly occurredAt: string;
}

/** The carrier's own scans, newest first as the API sends them. Scan text is the carrier's, never translated. */
export function ShipmentTimeline({
  events,
  t,
  locale,
}: {
  readonly events: readonly TimelineEvent[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <section aria-label={t.carrierShipping.timelineTitle} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t.carrierShipping.timelineTitle}</h3>
      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.carrierShipping.noEvents}</p>
      ) : (
        <ol className="border-border ms-1 flex flex-col gap-3 border-s ps-4">
          {events.map((event, index) => (
            <li key={`${event.occurredAt}-${index}`} className="flex flex-col text-sm">
              <bdi dir="auto" className="font-medium">
                {event.description}
              </bdi>
              {event.location !== null && (
                <bdi dir="auto" className="text-muted-foreground text-xs">
                  {event.location}
                </bdi>
              )}
              <time dateTime={event.occurredAt} className="text-muted-foreground text-xs">
                {formatDateTime(locale, event.occurredAt)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
