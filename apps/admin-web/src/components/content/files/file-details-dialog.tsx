"use client";

import { useId, useState, type ReactNode } from "react";
import Image from "next/image";
import { CopyIcon, DownloadIcon, FileIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Label,
  Textarea,
} from "@platform/ui";
import { getFileDownloadUrlAction, updateFileAltAction } from "@/app/content/files/actions";
import type { MediaFileDto } from "@/lib/api/media";
import { formatFileDate, formatFileSize, formatFileType } from "@/lib/files/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { FileDeleteDialog } from "./file-delete-dialog";

const MAX_ALT_LENGTH = 512;

/**
 * A file's details: preview, name, type, size, date added, editable alt text, copy link, download
 * and delete. `children` is the tile or row button that opens it (the dialog's trigger, so focus
 * returns to it on close). Without `canEdit` (a viewer) the alt text is read-only and there is no
 * Download or Delete — those need permissions a viewer lacks, and the API refuses them anyway.
 * "Copy link" stays: the public image URL is already on the page.
 */
export function FileDetailsDialog({
  file,
  canEdit,
  t,
  locale,
  children,
}: {
  readonly file: MediaFileDto;
  readonly canEdit: boolean;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <bdi dir="auto">{file.name}</bdi>
          </DialogTitle>
          <DialogDescription>
            {[
              formatFileType(file.contentType, t),
              formatFileSize(file.byteSize, locale, t),
              formatFileDate(file.createdAt, locale, t),
            ].join(" · ")}
          </DialogDescription>
        </DialogHeader>
        <DetailsBody file={file} canEdit={canEdit} t={t} onDeleted={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function DetailsBody({
  file,
  canEdit,
  t,
  onDeleted,
}: {
  readonly file: MediaFileDto;
  readonly canEdit: boolean;
  readonly t: Dictionary;
  readonly onDeleted: () => void;
}) {
  const d = t.files.details;
  const image = file.image;
  const initialAlt = image?.alt ?? "";
  const altId = useId();
  const [draft, setDraft] = useState(initialAlt);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [altError, setAltError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    readonly kind: "ok" | "error";
    readonly text: string;
  } | null>(null);

  const tooLong = draft.trim().length > MAX_ALT_LENGTH;
  const changed = draft.trim() !== initialAlt.trim();

  async function saveAlt(): Promise<void> {
    if (tooLong) {
      setAltError(d.altTooLong);
      return;
    }
    setSaving(true);
    setAltError(null);
    setNotice(null);
    try {
      const state = await updateFileAltAction(file.id, draft);
      if (state.status === "error") setAltError(state.fieldErrors["alt"] ?? state.message);
      else setNotice({ kind: "ok", text: d.saved });
    } catch {
      setAltError(t.formErrors.unexpected);
    } finally {
      setSaving(false);
    }
  }

  async function copyLink(): Promise<void> {
    if (image === null) return;
    setNotice(null);
    try {
      await navigator.clipboard.writeText(image.url);
      setNotice({ kind: "ok", text: d.copied });
    } catch {
      setNotice({ kind: "error", text: d.copyFailed });
    }
  }

  async function download(): Promise<void> {
    setDownloading(true);
    setNotice(null);
    try {
      const result = await getFileDownloadUrlAction(file.id);
      if (result.status === "ok") window.open(result.url, "_blank", "noopener,noreferrer");
      else setNotice({ kind: "error", text: result.message });
    } catch {
      setNotice({ kind: "error", text: d.downloadFailed });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-muted relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg">
        {image !== null ? (
          <Image
            src={image.url}
            alt={image.alt ?? file.name}
            fill
            sizes="(min-width: 640px) 32rem, 100vw"
            unoptimized
            loading="lazy"
            className="object-contain"
          />
        ) : (
          <div className="text-muted-foreground flex flex-col items-center gap-2 text-sm">
            <FileIcon aria-hidden="true" className="size-10" />
            {d.noPreview}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={altId}>{d.altLabel}</Label>
        {canEdit ? (
          <>
            <Textarea
              id={altId}
              dir="auto"
              value={draft}
              aria-invalid={altError !== null || tooLong}
              aria-describedby={`${altId}-hint`}
              onChange={(event) => {
                setDraft(event.target.value);
                setAltError(null);
                setNotice(null);
              }}
            />
            <p id={`${altId}-hint`} className="text-muted-foreground text-xs">
              {d.altHint}
            </p>
            {tooLong || altError !== null ? (
              <p role="alert" className="text-destructive text-sm">
                {altError ?? d.altTooLong}
              </p>
            ) : null}
            <div>
              <Button
                type="button"
                size="sm"
                loading={saving}
                disabled={saving || !changed}
                onClick={() => void saveAlt()}
              >
                {saving ? d.saving : d.save}
              </Button>
            </div>
          </>
        ) : (
          <p id={altId} dir="auto" className="text-sm">
            {initialAlt.length > 0 ? initialAlt : t.files.noAlt}
          </p>
        )}
      </div>

      {notice !== null ? (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={
            notice.kind === "error" ? "text-destructive text-sm" : "text-muted-foreground text-sm"
          }
        >
          {notice.text}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {image !== null ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void copyLink()}>
            <CopyIcon aria-hidden="true" />
            {d.copyLink}
          </Button>
        ) : null}
        {canEdit ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={downloading}
              disabled={downloading}
              onClick={() => void download()}
            >
              <DownloadIcon aria-hidden="true" />
              {d.download}
            </Button>
            <FileDeleteDialog mediaAssetId={file.id} name={file.name} t={t} onDeleted={onDeleted} />
          </>
        ) : null}
      </div>
    </div>
  );
}
