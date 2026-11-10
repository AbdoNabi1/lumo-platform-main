import type { ReactNode } from "react";
import { cn } from "@platform/ui";
import { dictionaryFor, type Locale } from "@/lib/i18n";
import type { StorefrontShell } from "@/lib/online-store";
import { PreviewBanner } from "./preview-banner";
import { PreviewLinkKeeper } from "./preview-link-keeper";
import { PreviewModeProvider } from "./preview-mode";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/**
 * The one shell around every store page (and the root not-found page, Ruling 23). `previewToken` is
 * set only for a shell the Runtime itself called a preview; `previewExpired` when a token was sent
 * but refused (the live shell renders, with the expired banner).
 */
export function StoreChrome({
  shell,
  locale,
  previewToken,
  previewExpired,
  children,
}: {
  readonly shell: StorefrontShell;
  readonly locale: Locale;
  readonly previewToken: string | null;
  readonly previewExpired: boolean;
  readonly children: ReactNode;
}) {
  const t = dictionaryFor(locale);
  return (
    <PreviewModeProvider token={previewToken}>
      <div className="flex min-h-dvh flex-col">
        {previewToken !== null || previewExpired ? (
          <PreviewBanner
            t={t}
            locale={locale}
            expiresAt={shell.previewExpiresAt}
            expired={previewToken === null}
          />
        ) : null}
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
        <SiteFooter t={t} locale={locale} shell={shell} previewToken={previewToken} />
      </div>
      {previewToken === null ? null : <PreviewLinkKeeper token={previewToken} />}
    </PreviewModeProvider>
  );
}
