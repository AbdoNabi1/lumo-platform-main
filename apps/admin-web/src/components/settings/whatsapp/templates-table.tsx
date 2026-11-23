"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { InfoIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import type { WhatsAppActionState } from "@/app/settings/whatsapp/actions";
import {
  deleteTemplateAction,
  syncTemplatesAction,
} from "@/app/settings/whatsapp/templates/actions";
import type { WhatsAppTemplateRowDto } from "@/lib/api/outreach";
import {
  categoryLabel,
  languageLabel,
  reasonText,
  templateStatusBadge,
  visibleTemplates,
} from "@/lib/outreach/templates";
import type { Dictionary } from "@/messages/en";
import { BrandText } from "./brand-text";
import { ConfirmDialog } from "./confirm-dialog";

type Notice = { readonly tone: "info" | "error"; readonly text: string } | null;

const NEW_TEMPLATE_HREF = "/settings/whatsapp/templates/new";

/** The delete confirmation's description with the template name isolated (`<bdi dir="ltr">`) inside the sentence. */
function DeleteDescription({ name, t }: { readonly name: string; readonly t: Dictionary }) {
  const [before = "", after = ""] = t.whatsappTemplates.deleteDescription.split("{name}");
  return (
    <>
      <BrandText text={before} />
      <bdi dir="ltr">{name}</bdi>
      <BrandText text={after} />
    </>
  );
}

/**
 * The active account's templates: name, language, category and status (Approved green, Pending amber, Rejected red with
 * the reason in an expander, Paused/Disabled neutral), with Sync from Meta, New template and a confirmed Delete.
 *
 * The toolbar and each row's Delete trigger stay mounted across the post-delete refresh: while a confirmation is open
 * (and until focus has returned to its trigger) the rows it opened over are retained, so focus returns to a trigger
 * that is still in the document (A7) instead of being lost when the row disappears.
 */
export function TemplatesTable({
  rows: liveRows,
  t,
}: {
  readonly rows: readonly WhatsAppTemplateRowDto[];
  readonly t: Dictionary;
}) {
  const copy = t.whatsappTemplates;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [syncing, startSync] = useTransition();
  const [retained, setRetained] = useState<readonly WhatsAppTemplateRowDto[] | null>(null);
  const rows = visibleTemplates(retained ?? liveRows);

  function reportDelete(result: WhatsAppActionState) {
    setNotice(
      result.status === "error"
        ? { tone: "error", text: result.message }
        : { tone: "info", text: copy.deleted },
    );
  }

  const noticeLine = notice !== null && (
    <p
      role={notice.tone === "error" ? "alert" : "status"}
      className={
        notice.tone === "error" ? "text-destructive text-sm" : "text-muted-foreground text-sm"
      }
    >
      <BrandText text={notice.text} />
    </p>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={syncing}
          onClick={() =>
            startSync(async () => {
              const result = await syncTemplatesAction();
              setNotice(
                result.status === "error"
                  ? { tone: "error", text: result.message }
                  : { tone: "info", text: copy.synced },
              );
            })
          }
        >
          <RefreshCwIcon aria-hidden="true" />
          <BrandText text={syncing ? copy.syncing : copy.sync} />
        </Button>
        <Button asChild>
          <Link href={NEW_TEMPLATE_HREF}>
            <PlusIcon aria-hidden="true" />
            {copy.newTemplate}
          </Link>
        </Button>
      </div>
      {noticeLine}

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2" tabIndex={-1} ref={headingRef} className="outline-none">
              {copy.emptyTitle}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p role="note" className="text-muted-foreground flex items-start gap-2 text-sm">
              <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                <BrandText text={copy.emptyBody} />
              </span>
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <h2 tabIndex={-1} ref={headingRef} className="sr-only">
              {copy.listLabel}
            </h2>
            <Table aria-label={copy.listLabel}>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">{copy.columns.name}</TableHead>
                  <TableHead className="text-start">{copy.columns.language}</TableHead>
                  <TableHead className="text-start">{copy.columns.category}</TableHead>
                  <TableHead className="text-start">{copy.columns.status}</TableHead>
                  <TableHead className="text-end">{copy.columns.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const badge = templateStatusBadge(row.status, t);
                  return (
                    <TableRow key={`${row.name}::${row.language}`}>
                      <TableCell className="text-start font-medium">
                        <bdi dir="ltr">{row.name}</bdi>
                      </TableCell>
                      <TableCell className="text-start">
                        <BrandText text={languageLabel(row.language, t)} />
                      </TableCell>
                      <TableCell className="text-start">{categoryLabel(row.category, t)}</TableCell>
                      <TableCell className="text-start">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        {row.status === "REJECTED" && (
                          <details className="mt-1 text-sm">
                            <summary className="text-muted-foreground cursor-pointer">
                              {copy.reasonToggle}
                            </summary>
                            <p className="mt-1">
                              <BrandText text={reasonText(row.rejectedReason, t)} />
                            </p>
                          </details>
                        )}
                      </TableCell>
                      <TableCell className="text-end">
                        <ConfirmDialog
                          triggerLabel={copy.delete}
                          triggerAriaLabel={`${copy.delete} ${row.name}`}
                          title={copy.deleteTitle}
                          description={<DeleteDescription name={row.name} t={t} />}
                          cancelLabel={copy.cancel}
                          confirmLabel={copy.delete}
                          onConfirm={() => deleteTemplateAction(row.name)}
                          onResult={reportDelete}
                          fallbackFocus={headingRef}
                          onRetain={() => setRetained((current) => current ?? liveRows)}
                          onRelease={() => setRetained(null)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
