"use client";

import Image from "next/image";
import { FileIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { MediaFileDto } from "@/lib/api/media";
import { formatFileDate, formatFileSize, formatFileType } from "@/lib/files/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { FileDetailsDialog } from "./file-details-dialog";

/** The list view: file name, alt text, type, size and date added. */
export function FilesTable({
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
  const c = t.files.columns;
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
              <FileDetailsDialog file={file} canEdit={canEdit} t={t} locale={locale}>
                <button
                  type="button"
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
              </FileDetailsDialog>
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
