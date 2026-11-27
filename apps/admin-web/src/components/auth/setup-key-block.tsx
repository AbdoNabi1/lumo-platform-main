"use client";

import { useState } from "react";
import { CopyIcon, ExternalLinkIcon } from "lucide-react";
import { Button } from "@platform/ui";
import { groupManualKey, type TwoStepSetup } from "@/lib/staff/two-step";

export interface SetupKeyLabels {
  readonly keyLabel: string;
  readonly copy: string;
  readonly copied: string;
  readonly openInApp: string;
}

/**
 * The setup key as a person needs it: grouped in fours (read aloud, typed), a Copy button, and the
 * `otpauth://` link that opens an authenticator app. Shared by the account page and setup at sign-in.
 * The key exists only in the state of whoever renders this: never a URL, a cookie or a log.
 */
export function SetupKeyBlock({
  setup,
  labels,
}: {
  readonly setup: TwoStepSetup;
  readonly labels: SetupKeyLabels;
}) {
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(setup.manualKey);
      setCopied(true);
    } catch {
      // Clipboard blocked: the key is still on screen for the person to select.
    }
  }
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span id="two-step-key-label" className="text-sm font-medium">
          {labels.keyLabel}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <code
            dir="ltr"
            aria-labelledby="two-step-key-label"
            className="bg-muted break-all rounded-xl px-3 py-2 text-base tracking-wider"
          >
            {groupManualKey(setup.manualKey)}
          </code>
          <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
            <CopyIcon aria-hidden="true" />
            {copied ? labels.copied : labels.copy}
          </Button>
        </div>
      </div>
      <p className="text-sm">
        <a href={setup.provisioningUri} className="text-primary underline">
          <ExternalLinkIcon aria-hidden="true" className="me-1 inline size-4" />
          {labels.openInApp}
        </a>
      </p>
    </>
  );
}
