"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@platform/ui";

/** How long "Copied" stays up before the button goes back to "Copy". */
const COPIED_FOR_MS = 2000;

/**
 * Copies `text` to the clipboard (`navigator.clipboard.writeText`) and says so for two seconds. The
 * visible word is short ("Copy" / "Copied"); `ariaLabel` says WHAT is copied ("Copy email address"),
 * so a screen reader hears more than a bare "Copy" three times down the page. A refused clipboard
 * (no permission, insecure context) changes nothing — it never claims a copy that did not happen.
 */
export function CopyButton({
  text,
  label,
  copiedLabel,
  ariaLabel,
}: {
  readonly text: string;
  readonly label: string;
  readonly copiedLabel: string;
  readonly ariaLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function copy(): void {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_FOR_MS);
      },
      // Refused (no permission, insecure context): say nothing happened, because nothing did.
      () => undefined,
    );
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" aria-label={ariaLabel} onClick={copy}>
        {copied ? (
          <CheckIcon aria-hidden="true" className="size-3.5" />
        ) : (
          <CopyIcon aria-hidden="true" className="size-3.5" />
        )}
        {copied ? copiedLabel : label}
      </Button>
      <span role="status" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
    </>
  );
}
