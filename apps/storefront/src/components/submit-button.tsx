"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@platform/ui";

/**
 * The submit button of a `<form action={serverAction}>`: while the action runs it is disabled and
 * shows `pendingLabel`, so a slow server step gives feedback and a second tap cannot start another.
 * `useFormStatus` reads the enclosing form, so this needs no state of its own.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
}: {
  readonly children: ReactNode;
  readonly pendingLabel: string;
  readonly className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className={className} disabled={pending} loading={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
