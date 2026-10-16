"use client";

import { useRouter } from "next/navigation";
import { RotateCwIcon } from "lucide-react";
import { Button } from "@platform/ui";

/**
 * "Try again" for a card that could not load: asks Next to render the page again, which fetches the
 * figures again on the server. Nothing is cached or replaced in the meantime, so a failed card never
 * shows numbers from anywhere.
 */
export function RetryButton({ label }: { readonly label: string }) {
  const router = useRouter();
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()}>
      <RotateCwIcon aria-hidden="true" />
      {label}
    </Button>
  );
}
