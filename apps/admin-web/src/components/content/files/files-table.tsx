"use client";

import Image from "next/image";
import { FileIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { MediaFileDto } from "@/lib/api/media";
import { formatFileDate, formatFileSize, formatFileType } from "@/lib/files/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { FILE_TILE_ATTRIBUTE, useFileDetails } from "./files-browser";

/**
 * The list view: file name, alt text, type, size and date added. Must sit inside `FilesBrowser`,
 * which owns the details dialog a row's name button opens.
 */
export function FilesTable({
  files,
  t,
  locale,
}: {
  readonly files: readonly MediaFileDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const c = t.files.columns;
  const { openFile } = useFileDetails();
  const ids = files.map((file) => file.id);
  return (
    <Table aria-label={t.files.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{c.name}</TableHead>
          <TableHead>{c.alt}</TableHead>
          <TableHead>{c.type}</TableHead>
          <TableHead className="text-end">{c.size}</TableHead>
          <TableHead>{c.added}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((file) => (
          <TableRow key={file.id}>
            <TableCell className="font-medium">
              <button
                type="button"
                {...{ [FILE_TILE_ATTRIBUTE]: file.id }}
                onClick={() => openFile(file, ids)}
                className="hover:text-primary flex items-center gap-3 text-start"
              >
                <span className="bg-muted text-muted-foreground relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                  {file.image !== null ? (
                    <Image
                      src={file.image.url}
                      alt=""
                      fill
                      sizes="40px"
                      unoptimized
                      loading="lazy"
                      className="object-cover"
                    />
                  ) : (
                    <FileIcon aria-hidden="true" className="size-4" />
                  )}
                </span>
                <bdi dir="auto">{file.name}</bdi>
              </button>
            </TableCell>
            <TableCell className="text-muted-foreground max-w-64 truncate">
              {(file.image?.alt ?? "").length > 0 ? (
                <bdi dir="auto">{file.image?.alt}</bdi>
              ) : (
                t.files.noAlt
              )}
            </TableCell>
            <TableCell>{formatFileType(file.contentType, t)}</TableCell>
            <TableCell className="text-end tabular-nums">
              {formatFileSize(file.byteSize, locale, t)}
            </TableCell>
            <TableCell>{formatFileDate(file.createdAt, locale, t)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
