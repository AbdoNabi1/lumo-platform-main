import { CompassIcon } from "lucide-react";
import { StatePanel } from "@/components/state-panel";
import { LockedFrame } from "@/components/locked-frame";
import { StoreChrome } from "@/components/store-chrome";
import { getAccountLinkVisible } from "@/lib/checkout-settings";
import { dictionaryFor } from "@/lib/i18n";
import {
  getLockedView,
  getPreviewToken,
  getRequestLocale,
  getRequestShell,
} from "@/lib/request-locale";
import { holdsValidUnlock } from "@/lib/unlock-proof";

/**
 * Ruling 23: unmatched URLs render here (outside any group), inside the same store chrome. A
 * locked store's 404 never does (Ruling 5): under a reachable path (the locked view), and wherever
 * the live shell says locked, such as `/favicon.ico` on a deployment without host routing, which
 * the middleware never sees (preflight 7). Only the owner's preview keeps the chrome there, and a
 * visitor whose unlock cookie the server itself verifies against the current access version (task
 * 9 review, minor 1): never a request header, which a client can send where the middleware is
 * skipped. The locked view stays the frame whatever the cookie says.
 */
export default async function NotFound() {
  const [lockedView, shell, locale, token] = await Promise.all([
    getLockedView(),
    getRequestShell(),
    getRequestLocale(),
    getPreviewToken(),
  ]);
  const t = dictionaryFor(locale);
  const panel = (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <StatePanel
        icon={<CompassIcon className="size-6" />}
        title={t.notFound.title}
        body={t.notFound.body}
        action={{ href: "/", label: t.notFound.backHome }}
      />
    </main>
  );
  const frame =
    lockedView || (shell.locked && shell.mode === "live" && !(await holdsValidUnlock()));
  if (frame) {
    return (
      <LockedFrame shell={shell} locale={locale}>
        {panel}
      </LockedFrame>
    );
  }
  // A 404 in a preview keeps ?preview= on the shell links (review M-2); only an honoured token.
  const previewToken = token !== null && shell.mode === "preview" ? token : null;
  return (
    <StoreChrome
      shell={shell}
      locale={locale}
      previewToken={previewToken}
      previewExpired={token !== null && shell.previewExpired}
      showAccountLink={await getAccountLinkVisible()}
    >
      {panel}
    </StoreChrome>
  );
}
