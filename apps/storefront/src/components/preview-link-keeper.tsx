"use client";

import { useEffect } from "react";
import { withPreview } from "@/lib/preview-href";

const fullPageLoad = (url: string) => window.location.assign(url);

/**
 * Ruling 16: in preview, a click on a same-origin link becomes a full navigation that keeps
 * `?preview=`. Capture phase on `document`, so it runs before React's own root listener (which would
 * otherwise client-navigate through <Link> and drop the parameter). A link to a spot on the same
 * page is left alone: the address already carries the token.
 */
export function PreviewLinkKeeper({
  token,
  navigate = fullPageLoad,
}: {
  readonly token: string;
  /** Test seam; the default is a full page load. */
  readonly navigate?: (url: string) => void;
}) {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        (anchor.target !== "" && anchor.target !== "_self") ||
        anchor.hasAttribute("download")
      )
        return;
      const here = new URL(window.location.href);
      const url = new URL(anchor.getAttribute("href") ?? "", here);
      if (url.origin !== here.origin) return;
      if (url.hash !== "" && url.pathname === here.pathname && url.search === here.search) return;
      event.preventDefault();
      event.stopPropagation();
      navigate(withPreview(`${url.pathname}${url.search}${url.hash}`, token));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [token, navigate]);
  return null;
}
