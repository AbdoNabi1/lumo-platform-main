import type { ReactNode } from "react";
import Link from "next/link";
import { BellIcon, MessageCircleIcon } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  Button,
  Separator,
  ThemeToggle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@platform/ui";
import { BrandMark } from "./brand-mark";
import { CreateMenu } from "./create-menu";
import { GlobalSearch } from "./global-search";
import { LocaleSwitch } from "./locale-switch";
import { MobileNav } from "./mobile-nav";
import { SidebarNav } from "./sidebar-nav";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

export interface CurrentUser {
  readonly name: string;
  readonly role: string;
  readonly initials: string;
}

interface AppShellProps {
  readonly children: ReactNode;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly activeNavId: string;
  readonly user: CurrentUser;
}

/**
 * The admin chrome: sidebar, topbar, content region, footer.
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
  const nav = <SidebarNav t={t} locale={locale} activeId={activeNavId} collapsible />;

  return (
    <div className="lumo-canvas flex min-h-dvh">
      {/* Sidebar — hidden below md, icon rail at md, full at lg */}
      <aside
        className={cn(
          "border-border/50 bg-card/90 sticky top-0 hidden h-dvh shrink-0 flex-col gap-8 border-e py-5 backdrop-blur-sm",
          "md:flex md:w-[76px] lg:w-[264px]",
        )}
      >
        <div className="flex items-center gap-2.5 px-5 max-lg:justify-center max-lg:px-2">
          <BrandMark />
          <span className="text-xl font-semibold tracking-tight max-lg:sr-only">{t.brand}</span>
        </div>

        {nav}

        <div className="mt-auto flex flex-col gap-3 px-3">
          <Separator className="opacity-60" />
          <div className="flex items-center gap-3 px-2 max-lg:justify-center max-lg:px-0">
            <Avatar>
              <AvatarFallback>{user.initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 max-lg:sr-only">
              <p className="text-foreground truncate font-medium">{user.name}</p>
              <p className="text-muted-foreground truncate text-xs">{user.role}</p>
            </div>
          </div>
          <ThemeToggle className="max-lg:hidden" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border/50 bg-card/80 sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b px-4 backdrop-blur-sm sm:px-6">
          <MobileNav
            openLabel={t.nav.openMenu}
            title={t.brand}
            description={t.nav.primary}
            footer={
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
            }
          >
            <SidebarNav t={t} locale={locale} activeId={activeNavId} />
          </MobileNav>

          <div className="flex items-center gap-2 md:hidden">
            <BrandMark className="size-5" />
            <span className="font-semibold">{t.brand}</span>
          </div>

          <GlobalSearch t={t} className="mx-auto hidden w-full max-w-md sm:flex" />

          <div className="ms-auto flex items-center gap-1 sm:gap-2">
            <div className="hidden sm:block">
              <CreateMenu t={t} />
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t.topbar.notifications}
                  className="relative"
                >
                  <BellIcon aria-hidden="true" />
                  <span
                    className="bg-primary ring-card absolute end-2 top-2 size-2 rounded-full ring-2"
                    aria-hidden="true"
                  />
                  <span className="sr-only">{t.topbar.unreadNotifications}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t.topbar.notifications}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t.topbar.messages}>
                  <MessageCircleIcon aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t.topbar.messages}</TooltipContent>
            </Tooltip>

            <LocaleSwitch locale={locale} label={t.topbar.language} />

            {/* Mirrors the sidebar's theme control at lg+ (matches the reference topbar), and is
                the only theme control below that, where the sidebar is a rail or gone. */}
            <ThemeToggle className="hidden sm:inline-flex" />

            <Avatar className="ms-1 size-8">
              <AvatarFallback>{user.initials}</AvatarFallback>
              <span className="sr-only">{user.name}</span>
            </Avatar>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>

        <footer className="border-border/50 text-muted-foreground flex flex-col gap-2 border-t px-4 py-4 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>{t.footer.copyright.replace("{year}", "2025")}</p>
          <nav aria-label={t.footer.navLabel} className="flex flex-wrap items-center gap-4">
            <Link href="/legal/privacy" className="hover:text-foreground">
              {t.footer.privacy}
            </Link>
            <Link href="/legal/terms" className="hover:text-foreground">
              {t.footer.terms}
            </Link>
            <Link href="/support" className="hover:text-foreground">
              {t.footer.support}
            </Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
