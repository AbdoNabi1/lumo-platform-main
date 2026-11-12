"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@platform/ui";

/**
 * The sign-up form's submit button. The form is a plain POST to `/auth/signup` (no client JS needed
 * to work), so `useFormStatus` alone never reports it pending; the button also locks itself on the
 * form's `submit` event (fired only once the browser's own validation passes) so a second click
 * cannot open a second store. A page restored from the back/forward cache unlocks it again.
 * Imports nothing from `lib/api` or `lib/auth` — it is browser code.
 */
export function SignupSubmitButton({
  children,
  pendingLabel,
}: {
  readonly children: ReactNode;
  readonly pendingLabel: ReactNode;
}) {
  const { pending } = useFormStatus();
  const [submitted, setSubmitted] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const form = ref.current?.form;
    if (form === null || form === undefined) return undefined;
    const onSubmit = (event: Event) => {
      if (!event.defaultPrevented) setSubmitted(true);
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setSubmitted(false);
    };
    form.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      form.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  const busy = pending || submitted;
  return (
    <Button ref={ref} type="submit" className="mt-2 w-full" loading={busy}>
      {busy ? pendingLabel : children}
    </Button>
  );
}
