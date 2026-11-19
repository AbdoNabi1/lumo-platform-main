import type { ReactNode } from "react";
import Link from "next/link";
import { dictionaryFor, type Locale } from "@/lib/i18n";
import type { StorefrontShell } from "@/lib/online-store";

/**
 * Ruling 5: what a locked store's reachable pages (its policies, and a 404 there) render in for a
 * visitor without access: the store's name, the page, and the way in. Nothing else of the shop: no
 * menus, search, cart, language switch, footer or preview banner, so a locked store's collections
 * and products are never named to anonymous visitors.
 */
export function LockedFrame({
  shell,
  locale,
  children,
}: {
  readonly shell: StorefrontShell;
  readonly locale: Locale;
  readonly children: ReactNode;
}) {
  const t = dictionaryFor(locale);
  const name = shell.storeName.trim();
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="border-border border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <span className="min-w-0 truncate text-lg font-semibold">
            <bdi dir="auto">{name !== "" ? name : t.brand}</bdi>
          </span>
          <Link
            href="/password"
            className="text-primary shrink-0 text-sm font-medium underline-offset-4 hover:underline"
          >
            {t.locked.enter}
          </Link>
        </div>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
