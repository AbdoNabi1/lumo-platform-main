"use client";

import { useState } from "react";
import { Button } from "@platform/ui";
import { CheckIcon, CopyIcon } from "lucide-react";

/**
 * Copies `https://<hostname>` to the clipboard. A client component, so it takes no import from
 * `lib/api` or `lib/auth` — just the hostname and its two labels.
 */
export function CopyLinkButton({
  hostname,
  label,
  copiedLabel,
}: {
  readonly hostname: string;
  readonly label: string;
  readonly copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(`https://${hostname}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={() => void copy()}>
      {copied ? (
        <CheckIcon aria-hidden="true" className="size-4" />
      ) : (
        <CopyIcon aria-hidden="true" className="size-4" />
      )}
      {copied ? copiedLabel : label}
    </Button>
  );
}
