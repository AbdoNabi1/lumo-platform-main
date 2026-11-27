"use client";

import Image from "next/image";
import { FileIcon } from "lucide-react";
import type { MediaFileDto } from "@/lib/api/media";
import { formatFileSize, formatFileType } from "@/lib/files/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { FILE_TILE_ATTRIBUTE, useFileDetails } from "./files-browser";

/**
 * The grid view: a square thumbnail per file with its name, type and size underneath. Must sit inside
 * `FilesBrowser`, which owns the details dialog a tile opens.
 */
export function FilesGrid({
  files,
  t,
  locale,
}: {
  readonly files: readonly MediaFileDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const { openFile } = useFileDetails();
  const ids = files.map((file) => file.id);
  return (
    <ul
      aria-label={t.files.title}
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
    >
      {files.map((file) => (
        <li key={file.id}>
          <button
            type="button"
            {...{ [FILE_TILE_ATTRIBUTE]: file.id }}
            onClick={() => openFile(file, ids)}
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
        </li>
      ))}
    </ul>
  );
}
