"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { CheckIcon } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Label } from "@platform/ui";
import { setCustomerTagsAction } from "@/app/customers/actions";
import { mergeTags, sameTags, splitTags } from "@/lib/customers/tags";
import type { Dictionary } from "@/messages/en";
import { CustomerTagsEditor } from "./customer-tags-editor";

/**
 * The customer's tags. Viewers see chips. Operators and up add and remove chips, and Save replaces
 * the whole set (the API trims, de-duplicates case-insensitively and sorts; the page then shows what
 * it stored). A refusal keeps the draft so nothing typed is lost.
 */
export function CustomerTagsCard({
  customerId,
  tags,
  canEdit,
  t,
}: {
  readonly customerId: string;
  readonly tags: readonly string[];
  readonly canEdit: boolean;
  readonly t: Dictionary;
}) {
  const c = t.customerDetail.tagsCard;
  const inputId = useId();
  const [draft, setDraft] = useState<string[]>([...tags]);
  const [pending, setPending] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  // Plain state, not a transition: a transition's pending flag clears in its own later render, so
  // the "Saved" note and a "Saving…" button could be on screen together. Here the note, the new
  // draft and the re-enabled Save button all land in one commit.
  const [isSaving, setIsSaving] = useState(false);
  const [outcome, setOutcome] = useState<
    { readonly kind: "saved" } | { readonly kind: "error"; readonly message: string } | null
  >(null);
  const savedKey = tags.join("\u0000");

  // The latest stored set, readable from the save continuation (which closes over old props).
  // Updated in a layout effect so it is current the moment a refreshed set commits; a passive
  // effect could still be queued when the action resolves and the continuation would read the
  // set from before the refresh.
  const latest = useRef({ tags, savedKey });
  useLayoutEffect(() => {
    latest.current = { tags, savedKey };
  }, [tags, savedKey]);

  // The page re-renders with the stored set after a save; start the draft from it (state adjusted
  // while rendering, the documented alternative to an effect that copies props into state).
  const [seenKey, setSeenKey] = useState(savedKey);
  if (seenKey !== savedKey) {
    setSeenKey(savedKey);
    setDraft([...tags]);
  }

  const effective = mergeTags(draft, splitTags(pending));
  const changed = !sameTags(effective, tags);

  function save(): void {
    setOutcome(null);
    const startedFrom = savedKey;
    setIsSaving(true);
    void (async () => {
      try {
        const state = await setCustomerTagsAction(customerId, effective);
        if (state.status === "error") {
          setOutcome({ kind: "error", message: state.fieldErrors["tags"] ?? state.message });
          return;
        }
        // Reconcile to what was stored. Identity normalizes exactly as the editor does, so the
        // canonical set is the submitted one up to order; prefer the page's own spelling when it
        // already agrees. If the page refreshed to a different set while the save ran, that set
        // already replaced the draft — never write the submitted draft over it.
        const current = latest.current;
        if (current.savedKey === startedFrom) {
          setDraft(sameTags(effective, current.tags) ? [...current.tags] : effective);
        }
        setPending("");
        setEditorKey((key) => key + 1);
        setOutcome({ kind: "saved" });
      } catch {
        setOutcome({ kind: "error", message: t.formErrors.unexpected });
      } finally {
        setIsSaving(false);
      }
    })();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{c.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!canEdit ? (
          tags.length === 0 ? (
            <p className="text-muted-foreground text-sm">{c.empty}</p>
          ) : (
            <ul aria-label={c.title} className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <li key={tag}>
                  <Badge variant="neutral">
                    <bdi dir="auto">{tag}</bdi>
                  </Badge>
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={inputId}>{c.addLabel}</Label>
              <CustomerTagsEditor
                key={editorKey}
                tags={draft}
                onChange={setDraft}
                inputId={inputId}
                describedBy={`${inputId}-hint`}
                disabled={isSaving}
                onPendingChange={setPending}
                t={t}
              />
              <p id={`${inputId}-hint`} className="text-muted-foreground text-sm">
                {c.addHint}
              </p>
              {draft.length === 0 && pending.trim() === "" && (
                <p className="text-muted-foreground text-sm">{c.empty}</p>
              )}
            </div>
            {outcome?.kind === "error" && (
              <p role="alert" className="text-destructive text-sm">
                {outcome.message}
              </p>
            )}
            <div className="flex items-center justify-end gap-3">
              {outcome?.kind === "saved" && (
                <p role="status" className="text-muted-foreground flex items-center gap-1 text-sm">
                  <CheckIcon aria-hidden="true" className="size-3.5" />
                  {c.saved}
                </p>
              )}
              <Button
                type="button"
                size="sm"
                loading={isSaving}
                disabled={isSaving || !changed}
                onClick={save}
              >
                {isSaving ? c.saving : c.save}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
