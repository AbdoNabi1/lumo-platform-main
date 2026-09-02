"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Card, CardContent } from "@platform/ui";
import { dictionaryFor, DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";

/**
 * Root error boundary (Phase A.34 — A.33 P1 #5). Before this, an uncaught throw (e.g. `/consent`'s
 * Hydra-rejection case) fell through to Next's unstyled default error UI, unlogged. Error
 * boundaries must be Client Components, so this can't call `readSession()`/`cookies()` the way
 * every other page does — it reads the locale cookie via `document.cookie` instead, same values
 * (`lib/i18n.ts`'s `dictionaryFor`/`isLocale` are plain functions, safe to import here) so Arabic/
 * English still works on the one page that can't use the server-side cookie read.
 *
 * Deliberately shows only a fixed, translated message — never `error.message` or `error.stack`,
 * which could carry a backend hostname, a stray token, or other internal detail.
 */
function readLocaleCookie(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  const value = match?.[1];
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export default function GlobalError({
  reset,
}: {
  readonly error: Error;
  readonly reset: () => void;
}) {
  const locale = readLocaleCookie();
  const t = dictionaryFor(locale);

  useEffect(() => {
    // Intentionally no console.error/telemetry call here yet — this app has zero observability
    // instrumentation (A.33 Task 16/P1 #4); see PHASE_A34_PRODUCTION_REMEDIATION_REPORT.md for
    // the documented follow-up (adopt @platform/observability, the pattern apps/runtime uses).
  }, []);

  return (
    <main
      dir={locale === "ar" ? "rtl" : "ltr"}
      className="lumo-canvas flex min-h-dvh items-center justify-center px-4"
    >
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <span
            className="bg-destructive-subtle text-destructive-subtle-foreground flex size-12 items-center justify-center rounded-2xl"
            aria-hidden="true"
          >
            <AlertTriangleIcon className="size-6" />
          </span>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">
            {t.errorPage.title}
          </h1>
          <p className="text-muted-foreground text-sm">{t.errorPage.body}</p>
          <div className="mt-2 flex gap-3">
            <Button type="button" onClick={reset}>
              {t.errorPage.retry}
            </Button>
            <Button variant="outline" asChild>
              <Link href="/">{t.errorPage.backToDashboard}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
