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
import { hasTag, splitTagInput } from "@/lib/orders/order-tags";
import type { Dictionary } from "@/messages/en";
import { TagInput } from "./tag-input";

/** The API takes at most 20 tags per bulk call (spec §2.3). */
const MAX_BULK_TAGS = 20;

/**
 * Shopify's "Add tags" / "Remove tags" dialog for the selected orders: the same tag input as the
 * order page (comma/Enter, suggestions), at most 20 tags, submitted to the bulk action. Text typed but
 * not yet committed with Enter/comma is added on submit (same split rules), never silently dropped; a
 * too-long piece blocks the submit with the tag input's message.
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
  const [typedText, setTypedText] = useState("");
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!open) {
      setTags([]);
      setTypedText("");
      setBlocked(false);
    }
  }, [open]);

  const typed = splitTagInput(typedText);
  const hasTyped = typed.tags.length > 0 || typed.tooLong.length > 0;

  const submit = () => {
    if (typed.tooLong.length > 0) {
      setBlocked(true);
      return;
    }
    const fresh = typed.tags.filter((tag) => !hasTag(tags, tag));
    onSubmit([...tags, ...fresh].slice(0, MAX_BULK_TAGS));
  };

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
          maxTags={MAX_BULK_TAGS}
          capHint={d.limit}
          onPendingChange={(next) => {
            setTypedText(next);
            setBlocked(false);
          }}
          t={t}
        />
        {blocked && (
          <p role="alert" className="text-destructive text-sm">
            {t.orderTags.tooLong}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {d.cancel}
          </Button>
          <Button
            type="button"
            loading={pending}
            disabled={pending || (tags.length === 0 && !hasTyped)}
            onClick={submit}
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
