"use client";

import { useEffect, useRef } from "react";
import { clearCheckoutSession } from "@/app/checkout/actions";

/**
 * Fires the `clearCheckoutSession` Server Action once, after this render — the confirmation page
 * (a Server Component) can READ `lumo_checkout_session` but Next.js forbids a Server Component
 * from modifying a cookie itself (that's a Server Action's job), so the clear happens here, from a
 * tiny Client Component, exactly once on mount. Renders nothing.
 */
export function ClearCheckoutSessionCookie() {
  const cleared = useRef(false);

  useEffect(() => {
    if (cleared.current) return;
    cleared.current = true;
    void clearCheckoutSession();
  }, []);

  return null;
}
