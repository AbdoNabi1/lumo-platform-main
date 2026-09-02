"use client";

import { useActionState, useEffect, useId, useState } from "react";
import {
  Badge,
  Button,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import { advanceContentBlockAction, updateContentBlockBodyAction } from "@/app/content/actions";
import type { ContentBlockListItemDto } from "@/lib/api/content";
import type { FormState } from "@/lib/api/mutation";
import { contentAdvanceableStatusesFrom } from "@/lib/content-lifecycle";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

const STATUS_VARIANT: Readonly<Record<string, "neutral" | "warning" | "success" | "outline">> = {
  draft: "neutral",
  scheduled: "warning",
  published: "success",
  archived: "outline",
};

const SELECT_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-8 rounded-xl border px-2.5 text-xs transition-colors ease-out";

const TEXTAREA_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) min-h-32 w-full rounded-xl border px-3.5 py-2.5 text-xs transition-colors ease-out";

/**
 * The Content Blocks list's row actions (T5.9a Part A). No detail page exists — there is no
 * `GET /content-blocks/:id` route to back one — so "advance status" and "edit body" are inline row
 * actions/expanders directly on the list, mirroring how T5.1 put per-row edit directly on
 * `ProductVariantsCard`'s table rows (`editingId` state, one row open at a time).
 */
export function ContentBlocksTable({
  items,
  t,
}: {
  readonly items: readonly ContentBlockListItemDto[];
  readonly t: Dictionary;
}) {
  const [editingBodyId, setEditingBodyId] = useState<string | null>(null);

  return (
    <Table aria-label={t.contentPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.contentPage.columns.name}</TableHead>
          <TableHead>{t.contentPage.columns.type}</TableHead>
          <TableHead>{t.contentPage.columns.status}</TableHead>
          <TableHead>{t.contentPage.columns.locale}</TableHead>
          <TableHead className="text-end">{t.contentRowActions.actions}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((block) =>
          editingBodyId === block.id ? (
            <EditBodyRow key={block.id} block={block} t={t} onDone={() => setEditingBodyId(null)} />
          ) : (
            <TableRow key={block.id}>
              <TableCell className="font-medium">{block.name}</TableCell>
              <TableCell className="text-muted-foreground">{block.blockType}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[block.status] ?? "neutral"}>
                  {(t.contentStatus as Record<string, string>)[block.status] ?? block.status}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {block.locale ?? t.contentPage.noLocale}
              </TableCell>
              <TableCell className="text-end">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <AdvanceForm block={block} t={t} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingBodyId(block.id)}
                  >
                    {t.contentRowActions.editBody}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ),
        )}
      </TableBody>
    </Table>
  );
}

function AdvanceForm({
  block,
  t,
}: {
  readonly block: ContentBlockListItemDto;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(advanceContentBlockAction, INITIAL_STATE);
  const formId = useId();
  const targets = contentAdvanceableStatusesFrom(block.status);

  if (targets.length === 0) return null;

  return (
    <form action={formAction} className="flex items-center gap-1.5">
      <input type="hidden" name="contentBlockId" value={block.id} />
      <Label htmlFor={`${formId}-toStatus`} className="sr-only">
        {t.contentRowActions.advanceToLabel}
      </Label>
      <select id={`${formId}-toStatus`} name="toStatus" className={SELECT_CLASS}>
        {targets.map((status) => (
          <option key={status} value={status}>
            {(t.contentStatus as Record<string, string>)[status] ?? status}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
        {isPending ? t.contentRowActions.advancing : t.contentRowActions.advance}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

function EditBodyRow({
  block,
  t,
  onDone,
}: {
  readonly block: ContentBlockListItemDto;
  readonly t: Dictionary;
  readonly onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(updateContentBlockBodyAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  // A successful save closes the inline editor — same pattern as `ProductVariantsCard`'s
  // `VariantEditRow`: the refreshed row (via `revalidatePath` in the action) doesn't change what
  // this row shows (the list DTO has no body field), so this only needs to close the editor.
  useEffect(() => {
    if (state.status === "success") {
      onDone();
    }
  }, [state.status, onDone]);

  return (
    <TableRow>
      <TableCell colSpan={5}>
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="contentBlockId" value={block.id} />
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${formId}-format`} className="text-xs">
                {t.contentCreateForm.format}
              </Label>
              <select
                id={`${formId}-format`}
                name="format"
                defaultValue="html"
                aria-invalid={fieldErrors["format"] !== undefined || undefined}
                className={SELECT_CLASS}
              >
                <option value="html">{t.contentCreateForm.formatHtml}</option>
                <option value="markdown">{t.contentCreateForm.formatMarkdown}</option>
                <option value="json">{t.contentCreateForm.formatJson}</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${formId}-content`} className="text-xs">
              {t.contentCreateForm.content}
            </Label>
            <textarea
              id={`${formId}-content`}
              name="content"
              rows={6}
              aria-invalid={fieldErrors["content"] !== undefined || undefined}
              className={TEXTAREA_CLASS}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
              {isPending ? t.contentRowActions.saving : t.contentRowActions.save}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onDone}>
              {t.contentRowActions.cancel}
            </Button>
          </div>
          {state.status === "error" && (
            <p role="alert" className="text-destructive text-xs">
              {state.message}
            </p>
          )}
        </form>
      </TableCell>
    </TableRow>
  );
}
