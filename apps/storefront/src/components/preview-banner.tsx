"use client";

import { useSyncExternalStore } from "react";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const noSubscription = () => () => undefined;

/**
 * Ruling 16: the preview banner, with the link's expiry. The time is formatted in the BROWSER (the
 * owner's own clock and zone, not the server's): the server snapshot is `null`, so the first paint
 * and hydration agree, and the time appears right after.
 */
export function PreviewBanner({
  t,
  locale,
  expiresAt,
  expired,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly expiresAt: string | null;
  readonly expired: boolean;
}) {
  const time = useSyncExternalStore(
    noSubscription,
    () => formatTime(expiresAt, locale),
    () => null,
  );
  return (
    <div role="status" className="bg-foreground text-background px-4 py-1.5 text-center text-xs">
      {expired ? (
        t.preview.expired
      ) : (
        <>
          {t.preview.banner}
          {time === null || expiresAt === null ? null : (
            <>
              {" · "}
              <time dateTime={expiresAt}>{t.preview.expires.replace("{time}", time)}</time>
            </>
          )}
        </>
      )}
    </div>
  );
}

function formatTime(expiresAt: string | null, locale: Locale): string | null {
  if (expiresAt === null) return null;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
}
