"use client";

import Image from "next/image";
import { FileIcon } from "lucide-react";
import type { MediaFileDto } from "@/lib/api/media";
import { formatFileSize, formatFileType } from "@/lib/files/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { FileDetailsDialog } from "./file-details-dialog";

/** The grid view: a square thumbnail per file with its name, type and size underneath. */
export function FilesGrid({
  files,
  canEdit,
  t,
  locale,
}: {
  readonly files: readonly MediaFileDto[];
  readonly canEdit: boolean;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <ul
      aria-label={t.files.title}
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
    >
      {files.map((file) => (
        <li key={file.id}>
          <FileDetailsDialog file={file} canEdit={canEdit} t={t} locale={locale}>
            <button
              type="button"
              className="group flex w-full flex-col gap-2 text-start focus-visible:outline-none"
            >
              <span className="border-border bg-muted text-muted-foreground group-hover:border-foreground/40 group-focus-visible:ring-ring relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border group-focus-visible:ring-2">
                {file.image !== null ? (
                  <Image
                    src={file.image.url}
                    alt={file.image.alt ?? ""}
                    fill
                    sizes="(min-width: 1280px) 16vw, (min-width: 640px) 25vw, 50vw"
                    unoptimized
                    loading="lazy"
                    className="object-cover"
                  />
                ) : (
                  <FileIcon aria-hidden="true" className="size-8" />
                )}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="truncate text-sm font-medium">
                  <bdi dir="auto">{file.name}</bdi>
                </span>
                <span className="text-muted-foreground text-xs">
                  {formatFileType(file.contentType, t)} · {formatFileSize(file.byteSize, locale, t)}
                </span>
              </span>
            </button>
          </FileDetailsDialog>
        </li>
      ))}
    </ul>
  );
}
