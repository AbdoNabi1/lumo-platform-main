"use client";

import { useEffect } from "react";
import { PREVIEW_READY_MESSAGE, focusTargetOf } from "@/lib/section-focus";

/**
 * Preview only. Tells the editor (the parent window, at the admin origin and never `*`) that the
 * page is ready, then scrolls to and marks the section the editor names. Messages are accepted only
 * from the admin origin, sent by the parent, with a uuid section id.
 */
export function SectionFocusListener({ adminOrigin }: { readonly adminOrigin: string }) {
  useEffect(() => {
    if (window.parent !== window) {
      window.parent.postMessage({ type: PREVIEW_READY_MESSAGE }, adminOrigin);
    }
    const onMessage = (event: MessageEvent) => {
      const id = focusTargetOf(event, adminOrigin, window.parent);
      if (id === null) return;
      const target = document.querySelector(`[data-section-id="${id}"]`);
      if (target === null) return;
      document.querySelectorAll("[data-section-focused]").forEach((previous) => {
        if (previous !== target) previous.removeAttribute("data-section-focused");
      });
      target.setAttribute("data-section-focused", "true");
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
      target.scrollIntoView?.({ block: "center", behavior: reduced ? "auto" : "smooth" });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [adminOrigin]);
  return null;
}
