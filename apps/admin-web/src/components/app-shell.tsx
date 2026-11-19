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
import { TrialBanner } from "./trial-banner";
import type { Locale } from "@/lib/i18n";
import { showPlatformTools as platformToolsOn } from "@/lib/platform-tools";
import { getStoreContext, storeUrlForSession, type StoreContext } from "@/lib/shell/store-context";
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

interface AppShellViewProps extends AppShellProps {
  /** The shop's name, own domain and billing notice; omitted → brand, STOREFRONT_URL, no banner. */
  readonly store?: StoreContext | undefined;
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
 *
 * An async server component: it reads the shop's name, primary domain and billing notice itself
 * (`getStoreContext`, memoised per request and never throwing), so no page has to pass them in.
 */
export async function AppShell(props: AppShellProps) {
  const store = await getStoreContext();
  return <AppShellView {...props} store={store} />;
}

/** The synchronous layout behind {@link AppShell}; tests render this with a `store` of their own. */
export function AppShellView({ children, t, locale, activeNavId, user, store }: AppShellViewProps) {
  // The shop's own domain wins; STOREFRONT_URL only for the default store — never another store's.
  const storefrontUrl = storeUrlForSession(store ?? { storeUrl: null, sessionTenantId: null });
  const storeName = store?.storeName?.trim() || t.brand;
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
          <span className="truncate text-xl font-semibold tracking-tight max-lg:sr-only">
            {storeName}
          </span>
        </div>

        {/* Who is signed in, and signing out, live in the topbar's account menu, as in Shopify. */}
        {nav}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border/50 bg-card/80 sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b px-4 backdrop-blur-sm sm:px-6">
          <MobileNav
            openLabel={t.nav.openMenu}
            title={storeName}
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
            <span className="truncate font-semibold">{storeName}</span>
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

        <TrialBanner
          banner={store?.banner ?? null}
          trialDaysLeft={store?.trialDaysLeft ?? null}
          t={t}
          locale={locale}
        />

        <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
