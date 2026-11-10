import Link from "next/link";
import { SearchIcon, ShoppingCartIcon, UserIcon } from "lucide-react";
import { Button, Input, Label, ThemeToggle } from "@platform/ui";
import { LocaleSwitch } from "@/components/locale-switch";
import { MobileMenu } from "@/components/mobile-menu";
import { SiteNav } from "@/components/site-nav";
import type { Locale } from "@/lib/i18n";
import type { StorefrontShell } from "@/lib/online-store";
import { withPreview } from "@/lib/preview-href";
import { menuEntries } from "@/lib/shell-menus";
import { logoSize } from "@/lib/shell-presentation";
import type { Dictionary } from "@/messages/en";

/**
 * Spec 1.12: the shop's header. Logo at the inline start (right in RTL), never mirrored, height
 * capped at 40 px (mobile) / 48 px (desktop), width from `widthPx`; else the store name; else the
 * platform brand. `ThemeToggle` only for an unbranded shop (Decision 16).
 *
 * The search field is a plain `<form method="get" action="/search">` (no "use client", no
 * debounce) rather than the client-driven `?q=`-pushing pattern `admin-web`'s `CustomersToolbar`
 * uses — this header renders in a Server Component and the storefront's own rule is to keep public
 * reads simple (Server Components/Server Actions only, no browser-side runtime-API calls), so
 * submitting the built-in GET form to `/search` is sufficient and needs no client JS at all.
 *
 * Spec 2.8: the shop's header menu. Below `md` a drawer trigger sits at the inline start of the top
 * row, before the logo; from `md` the menu is its own row under it. Neither renders for an empty
 * menu.
 */
export function SiteHeader({
  t,
  locale,
  shell,
  previewToken,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly shell: StorefrontShell;
  readonly previewToken: string | null;
}) {
  const name = shell.storeName.trim();
  const logo = shell.brand.logo.image;
  // A logo is the shop's own mark: without a name it reads as "Home", never as the platform brand.
  const label = name !== "" ? name : logo === null ? t.brand : t.nav.home;
  const size = logo === null ? null : logoSize(logo, shell.brand.logo.widthPx);
  const entries = menuEntries(shell.header.menu, locale);
  return (
    <>
      {/* Below sm the search takes its own full-width row and the logo is capped, so a 375 px
          screen never scrolls sideways (review I-1). */}
      <header className="flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap">
        <MobileMenu
          entries={entries}
          previewToken={previewToken}
          openLabel={t.nav.openMenu}
          closeLabel={t.nav.closeMenu}
          title={t.nav.menu}
        />
        <Link
          href={withPreview("/", previewToken)}
          className="me-auto min-w-0 max-w-[45vw] shrink sm:me-0"
          aria-label={logo === null ? undefined : label}
        >
          {logo !== null && size !== null ? (
            // <picture>: the lint-accepted plain <img> (no @next disable; the root hook config lacks it).
            <picture>
              <img
                src={logo.url}
                alt={label}
                width={size.width}
                {...(size.height === undefined ? {} : { height: size.height })}
                style={{ width: `${size.width}px` }}
                className="block h-auto max-h-10 max-w-full object-contain md:max-h-12 ltr:object-left rtl:object-right"
              />
            </picture>
          ) : (
            <bdi dir="auto" className="block truncate text-sm font-medium">
              {label}
            </bdi>
          )}
        </Link>
        <form
          action="/search"
          method="get"
          role="search"
          className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1"
        >
          <Label htmlFor="site-search" className="sr-only">
            {t.nav.searchLabel}
          </Label>
          {previewToken === null ? null : (
            <input type="hidden" name="preview" value={previewToken} />
          )}
          <div className="relative">
            <SearchIcon
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
            />
            <Input
              id="site-search"
              type="search"
              name="q"
              placeholder={t.nav.searchPlaceholder}
              className="ps-9"
            />
            <button type="submit" className="sr-only">
              {t.nav.searchSubmit}
            </button>
          </div>
        </form>
        <div className="flex shrink-0 items-center gap-1">
          <Button asChild variant="ghost" size="icon" aria-label={t.nav.cart}>
            <Link href={withPreview("/cart", previewToken)}>
              <ShoppingCartIcon aria-hidden="true" className="size-4" />
            </Link>
          </Button>
          {/*
           * Always points at `/account` regardless of sign-in state (T5.17). The header renders in a
           * Server Component on every page, and branching the icon on session state would mean an
           * extra `GET /public/auth/me` round trip on every page view — including pages that have
           * nothing to do with the account. `/account` itself redirects a signed-out visitor to
           * `/account/login`, so the destination is correct either way and is decided by a real
           * server-side session check rather than by a guessed cookie-presence test in the header.
           */}
          <Button asChild variant="ghost" size="icon" aria-label={t.nav.account}>
            <Link href={withPreview("/account", previewToken)}>
              <UserIcon aria-hidden="true" className="size-4" />
            </Link>
          </Button>
          <LocaleSwitch
            locale={locale}
            label={t.language.switch}
            disabled={previewToken !== null}
          />
          {shell.branded ? null : <ThemeToggle />}
        </div>
      </header>
      <SiteNav entries={entries} previewToken={previewToken} label={t.nav.menu} />
    </>
  );
}
