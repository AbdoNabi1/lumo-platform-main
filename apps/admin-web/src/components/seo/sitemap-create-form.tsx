"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { createSitemapAction } from "@/app/seo/sitemaps/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/** The Sitemaps create form (T5.9b). `urls` starts empty — populate it afterwards via the detail screen's Regenerate form. */
export function SitemapCreateForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(createSitemapAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.status === "error" && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground flex items-center gap-2 rounded-xl border px-4 py-3 text-sm"
        >
          <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-name`}>{t.sitemapCreate.name}</Label>
        <Input
          id={`${formId}-name`}
          name="name"
          aria-invalid={fieldErrors["name"] !== undefined || undefined}
        />
        {fieldErrors["name"] !== undefined && (
          <p className="text-destructive text-sm">{fieldErrors["name"]}</p>
        )}
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.sitemapCreate.submitting : t.sitemapCreate.submit}
        </Button>
      </div>
    </form>
  );
}
