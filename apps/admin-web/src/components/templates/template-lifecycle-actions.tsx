"use client";

import { useActionState } from "react";
import { Button } from "@platform/ui";
import { archiveTemplateAction } from "@/app/templates/actions";
import type { FormState } from "@/lib/api/mutation";
import { templateCanArchive } from "@/lib/pages-lifecycle";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * The Template Detail archive button (T5.9a Part B). Template has no transition table on the
 * backend (`services/pages/src/domain/template.ts`) — `archive()` is its only lifecycle move, and
 * the aggregate itself rejects it once already archived — so this just gates on `status !==
 * "archived"` (`lib/pages-lifecycle.ts`'s `templateCanArchive`) rather than a table lookup.
 */
export function TemplateLifecycleActions({
  templateId,
  status,
  t,
}: {
  readonly templateId: string;
  readonly status: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(archiveTemplateAction, INITIAL_STATE);

  if (!templateCanArchive(status)) {
    return <p className="text-muted-foreground text-sm">{t.templateLifecycle.alreadyArchived}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t.templateLifecycle.title}</h2>
      <form
        action={formAction}
        onSubmit={(event) => {
          if (!window.confirm(t.templateLifecycle.confirmArchive)) {
            event.preventDefault();
          }
        }}
        className="flex flex-col items-start gap-1"
      >
        <input type="hidden" name="templateId" value={templateId} />
        <Button type="submit" size="sm" variant="destructive" loading={isPending} disabled={isPending}>
          {isPending ? t.templateLifecycle.archiving : t.templateLifecycle.archive}
        </Button>
        {state.status === "error" && (
          <p role="alert" className="text-destructive text-xs">
            {state.message}
          </p>
        )}
      </form>
    </div>
  );
}
