"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@platform/ui";
import { suggestOrderTagsAction } from "@/app/orders/annotation-actions";
import type { Dictionary } from "@/messages/en";
import { TagInput } from "./tag-input";

/** The API takes at most 20 tags per bulk call (spec §2.3). */
const MAX_BULK_TAGS = 20;

/**
 * Shopify's "Add tags" / "Remove tags" dialog for the selected orders: the same tag input as the
 * order page (comma/Enter, suggestions), at most 20 tags, submitted to the bulk action.
 */
export function OrdersBulkTagsDialog({
  open,
  title,
  submitLabel,
  pending,
  onOpenChange,
  onSubmit,
  t,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly submitLabel: string;
  readonly pending: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (tags: readonly string[]) => void;
  readonly t: Dictionary;
}) {
  const d = t.ordersPage.bulk.tagsDialog;
  const [tags, setTags] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!open) setTags([]);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <TagInput
          label={d.inputLabel}
          tags={tags}
          disabled={pending}
          onAdd={(added) => setTags((current) => [...current, ...added].slice(0, MAX_BULK_TAGS))}
          onRemove={(tag) => setTags((current) => current.filter((existing) => existing !== tag))}
          suggest={suggestOrderTagsAction}
          t={t}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {d.cancel}
          </Button>
          <Button
            type="button"
            loading={pending}
            disabled={pending || tags.length === 0}
            onClick={() => onSubmit(tags)}
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
