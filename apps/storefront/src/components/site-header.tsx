import Link from "next/link";
import { SearchIcon, ShoppingCartIcon, UserIcon } from "lucide-react";
import { Button, Input, Label, ThemeToggle } from "@platform/ui";
import { LocaleSwitch } from "@/components/locale-switch";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * The storefront's single shared header — brand link, product search, cart link, theme toggle,
 * language switch. The search field is a plain `<form method="get" action="/search">` (no
 * "use client", no debounce) rather than the client-driven `?q=`-pushing pattern `admin-web`'s
 * `CustomersToolbar` uses — this header renders in a Server Component and the storefront's own
 * rule is to keep public reads simple (Server Components/Server Actions only, no browser-side
 * runtime-API calls), so submitting the built-in GET form to `/search` is sufficient and needs no
 * client JS at all.
 */
export function SiteHeader({ t, locale }: { readonly t: Dictionary; readonly locale: Locale }) {
  return (
    <header className="flex items-center justify-between gap-3">
      <Link href="/" className="shrink-0 text-sm font-medium">
        {t.brand}
      </Link>
      <form action="/search" method="get" role="search" className="min-w-0 flex-1">
        <Label htmlFor="site-search" className="sr-only">
          {t.nav.searchLabel}
        </Label>
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
          <Link href="/cart">
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
          <Link href="/account">
            <UserIcon aria-hidden="true" className="size-4" />
          </Link>
        </Button>
        <LocaleSwitch locale={locale} label={t.language.switch} />
        <ThemeToggle />
      </div>
    </header>
  );
}
