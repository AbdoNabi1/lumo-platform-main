"use client";

import { useEffect, useId, useState, useTransition } from "react";
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
  const [isSaving, startSaving] = useTransition();
  const [outcome, setOutcome] = useState<
    { readonly kind: "saved" } | { readonly kind: "error"; readonly message: string } | null
  >(null);
  const savedKey = tags.join("\u0000");

  // The page re-renders with the stored set after a save; start the draft from it.
  useEffect(() => {
    setDraft([...tags]);
  }, [savedKey]);

  const effective = mergeTags(draft, splitTags(pending));
  const changed = !sameTags(effective, tags);

  function save(): void {
    setOutcome(null);
    startSaving(async () => {
      try {
        const state = await setCustomerTagsAction(customerId, effective);
        if (state.status === "error") {
          setOutcome({ kind: "error", message: state.fieldErrors["tags"] ?? state.message });
          return;
        }
        setDraft(effective);
        setPending("");
        setEditorKey((key) => key + 1);
        setOutcome({ kind: "saved" });
      } catch {
        setOutcome({ kind: "error", message: t.formErrors.unexpected });
      }
    });
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
