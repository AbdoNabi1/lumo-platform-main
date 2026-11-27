"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { UploadIcon } from "lucide-react";
import { Button } from "@platform/ui";
import { uploadFileAction } from "@/app/content/files/actions";
import { prepareImage } from "@/lib/media/prepare-image";
import type { Dictionary } from "@/messages/en";

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

type Reason = "too_large" | "unsupported" | "unavailable" | "failed";

interface Failure {
  readonly id: number;
  readonly name: string;
  readonly reason: Reason;
}

function withFile(file: File): FormData {
  const data = new FormData();
  data.append("file", file);
  return data;
}

/** Where `{name}` sits in a message, with the name isolated so it cannot reorder the sentence. */
function Named({ template, name }: { readonly template: string; readonly name: string }) {
  const [before = "", after = ""] = template.split("{name}");
  return (
    <>
      {before}
      <bdi dir="auto">{name}</bdi>
      {after}
    </>
  );
}

/**
 * "Upload files" — a hidden multi-file input behind a primary button. Each picked file is scaled and
 * re-encoded in the browser (`prepareImage`) and then sent through its own `uploadFileAction` call,
 * one after another, so every file has its own idempotency key and its own outcome. A failure names
 * the file and the reason; the rest of the batch carries on. The action revalidates the page, so
 * stored files appear without a reload.
 */
export function FilesUploadButton({
  t,
  variant = "primary",
}: {
  readonly t: Dictionary;
  readonly variant?: "primary" | "outline";
}) {
  const f = t.files;
  const m = t.productMedia;
  const inputRef = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [failures, setFailures] = useState<readonly Failure[]>([]);
  const [uploaded, setUploaded] = useState(0);

  const reasonText: Record<Reason, string> = {
    too_large: m.errorTooLarge,
    unsupported: m.errorUnsupported,
    unavailable: m.storageNotSetUp,
    failed: m.errorFailed,
  };

  async function uploadAll(files: readonly File[]): Promise<void> {
    setFailures([]);
    setUploaded(0);
    let stored = 0;
    for (const file of files) {
      setBusyName(file.name);
      let reason: Reason | null = null;
      try {
        const prepared = await prepareImage(file);
        if (!prepared.ok) {
          reason = prepared.reason;
        } else {
          const result = await uploadFileAction(withFile(prepared.file));
          if (result.status === "ok") stored += 1;
          else reason = result.reason;
        }
      } catch {
        reason = "failed";
      }
      if (reason !== null) {
        counter.current += 1;
        const failure: Failure = { id: counter.current, name: file.name, reason };
        setFailures((current) => [...current, failure]);
      }
    }
    setBusyName(null);
    setUploaded(stored);
  }

  function onPick(event: ChangeEvent<HTMLInputElement>): void {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length > 0) void uploadAll(files);
  }

  const busy = busyName !== null;

  return (
    <div className="flex flex-col items-start gap-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="files-upload-input"
        onChange={onPick}
      />
      <Button
        type="button"
        variant={variant}
        loading={busy}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <UploadIcon aria-hidden="true" />
        {f.upload}
      </Button>
      <div role="status" aria-live="polite" className="text-muted-foreground text-sm">
        {busyName !== null ? <Named template={f.uploading} name={busyName} /> : null}
        {busyName === null && uploaded > 0
          ? f.uploadedCount.replace("{count}", String(uploaded))
          : null}
      </div>
      {failures.length > 0 ? (
        <ul role="alert" className="text-destructive flex flex-col gap-1 text-sm">
          {failures.map((failure) => (
            <li key={failure.id}>
              <Named
                template={f.uploadFailed.replace("{reason}", reasonText[failure.reason])}
                name={failure.name}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
