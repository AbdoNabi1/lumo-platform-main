import type { ReactNode } from "react";
import { cn } from "@platform/ui";
import { dictionaryFor, type Locale } from "@/lib/i18n";
import type { StorefrontShell } from "@/lib/online-store";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/** The one shell around every store page (and the root not-found page, Ruling 23). */
export function StoreChrome({
  shell,
  locale,
  previewToken,
  children,
}: {
  readonly shell: StorefrontShell;
  readonly locale: Locale;
  readonly previewToken: string | null;
  readonly children: ReactNode;
}) {
  const t = dictionaryFor(locale);
  return (
    <div className="flex min-h-dvh flex-col">
      <div
        className={cn(
          "bg-background/95 border-border z-30 border-b backdrop-blur-sm",
          shell.header.sticky && "sticky top-0",
        )}
      >
        <div className="mx-auto max-w-5xl px-4 py-3">
          <SiteHeader t={t} locale={locale} shell={shell} previewToken={previewToken} />
        </div>
      </div>
      <div className="flex-1">{children}</div>
      <SiteFooter t={t} locale={locale} shell={shell} />
    </div>
  );
}
