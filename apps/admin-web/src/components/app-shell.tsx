import type { ReactNode } from "react";
import { Avatar, AvatarFallback, ThemeToggle, cn } from "@platform/ui";
import { AccountMenu } from "./account-menu";
import { BrandMark } from "./brand-mark";
import { CreateMenu } from "./create-menu";
import { GlobalSearch } from "./global-search";
import { LocaleSwitch } from "./locale-switch";
import { MobileNav } from "./mobile-nav";
import { SidebarNav } from "./sidebar-nav";
import { SignOutLink } from "./sign-out-link";
import type { Locale } from "@/lib/i18n";
import { showPlatformTools as platformToolsOn } from "@/lib/platform-tools";
import type { Dictionary } from "@/messages/en";

export interface CurrentUser {
  readonly name: string;
  readonly role: string;
  readonly initials: string;
  /** Plan 1C: true under native sign-in, the only mode where the staff member owns a password here. */
  readonly canChangePassword?: boolean;
}

interface AppShellProps {
  readonly children: ReactNode;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly activeNavId: string;
  readonly user: CurrentUser;
}

/**
 * The admin chrome: sidebar, topbar and content region, laid out like Shopify's admin — a grey
 * sidebar whose current page is a white row, and no footer.
 *
 * Responsive contract
 *   ≥1024px  full sidebar with labels
 *   768px    sidebar collapses to an icon rail, labels move to tooltips/`sr-only`
 *   <768px   sidebar leaves the layout entirely; the same nav opens as a drawer
 *
 * The layout is expressed with logical properties (`border-e`, `ms-*`, `text-start`), so
 * RTL is a direction change on `<html dir>` rather than a second stylesheet.
 */
export function AppShell({ children, t, locale, activeNavId, user }: AppShellProps) {
  // Read per request, on the server: NEXT_PUBLIC_* would be frozen at build time (Plan 3C).
  const storefrontUrl = process.env["STOREFRONT_URL"]?.trim() || null;
  const showPlatformTools = platformToolsOn();
  const nav = (
    <SidebarNav
      t={t}
      locale={locale}
      activeId={activeNavId}
      collapsible
      storefrontUrl={storefrontUrl}
      showPlatformTools={showPlatformTools}
    />
  );

  return (
    <div className="lumo-canvas flex min-h-dvh">
      {/* Sidebar — hidden below md, icon rail at md, full at lg */}
      <aside
        className={cn(
          "border-border/50 bg-surface sticky top-0 hidden h-dvh shrink-0 flex-col gap-5 border-e py-4",
          "md:flex md:w-[76px] lg:w-[240px]",
        )}
      >
        <div className="flex items-center gap-2.5 px-5 max-lg:justify-center max-lg:px-2">
          <BrandMark />
          <span className="text-xl font-semibold tracking-tight max-lg:sr-only">{t.brand}</span>
        </div>

        {/* Who is signed in, and signing out, live in the topbar's account menu, as in Shopify. */}
        {nav}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border/50 bg-card/80 sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b px-4 backdrop-blur-sm sm:px-6">
          <MobileNav
            openLabel={t.nav.openMenu}
            title={t.brand}
            description={t.nav.primary}
            footer={
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar>
                      <AvatarFallback>{user.initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{user.name}</p>
                      <p className="text-muted-foreground truncate text-xs">{user.role}</p>
                    </div>
                  </div>
                  <ThemeToggle />
                </div>
                <SignOutLink label={t.topbar.signOut} />
              </div>
            }
          >
            <SidebarNav
              t={t}
              locale={locale}
              activeId={activeNavId}
              storefrontUrl={storefrontUrl}
              showPlatformTools={showPlatformTools}
            />
          </MobileNav>

          <div className="flex items-center gap-2 md:hidden">
            <BrandMark className="size-5" />
            <span className="font-semibold">{t.brand}</span>
          </div>

          <GlobalSearch
            t={t}
            className="mx-auto hidden w-full max-w-md sm:flex"
            storefrontUrl={storefrontUrl}
            showPlatformTools={showPlatformTools}
          />

          <div className="ms-auto flex items-center gap-1 sm:gap-2">
            <div className="hidden sm:block">
              <CreateMenu t={t} />
            </div>

            {/* No bell or messages button until there is a real feed behind them: an always-on
                "unread" dot over nothing misleads the merchant. */}
            <LocaleSwitch locale={locale} label={t.topbar.language} />

            {/* The only theme control at sm+; below that it sits in the drawer's footer. */}
            <ThemeToggle className="hidden sm:inline-flex" />

            <AccountMenu t={t} user={user} />
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
