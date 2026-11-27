"use client";

import { useState } from "react";
import { CopyIcon, DownloadIcon } from "lucide-react";
import { Button } from "@platform/ui";

export interface BackupCodesLabels {
  readonly listLabel: string;
  readonly copyAll: string;
  readonly copied: string;
  readonly download: string;
  readonly fileHeading: string;
  readonly savedLabel: string;
  readonly done: string;
}

const DOWNLOAD_NAME = "morbeh-backup-codes.txt";

/**
 * The 10 backup codes, shown once: the list, Copy all, Download .txt, the required "I saved my backup
 * codes" checkbox, and the button that is disabled until it is ticked. Shared by the account page and
 * setup at sign-in; the caller decides what the button does. The codes exist only in the state of whoever
 * renders this: never a URL, a cookie or a log.
 */
export function BackupCodesBlock({
  codes,
  labels,
  onDone,
}: {
  readonly codes: readonly string[];
  readonly labels: BackupCodesLabels;
  readonly onDone: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      // Clipboard blocked: the codes are still on screen for the person to select.
    }
  }
  function download(): void {
    const text = `${labels.fileHeading}\n\n${codes.join("\n")}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = DOWNLOAD_NAME;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <ul aria-label={labels.listLabel} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {codes.map((code) => (
          <li key={code} className="bg-muted rounded-xl px-3 py-2 text-base tracking-wider">
            <bdi dir="ltr">{code}</bdi>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          <CopyIcon aria-hidden="true" />
          {copied ? labels.copied : labels.copyAll}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <DownloadIcon aria-hidden="true" />
          {labels.download}
        </Button>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
        />
        <span>{labels.savedLabel}</span>
      </label>
      <div>
        <Button type="button" disabled={!saved} onClick={onDone}>
          {labels.done}
        </Button>
      </div>
    </>
  );
}
