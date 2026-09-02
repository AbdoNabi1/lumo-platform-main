"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { createRedirectAction } from "@/app/seo/redirects/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

const SELECT_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out";

/** The Redirects create form (T5.9b). `statusCode` is a fixed 301/302 choice per `createRedirectBody`. */
export function RedirectCreateForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(createRedirectAction, INITIAL_STATE);
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-fromPath`}>{t.redirectCreate.fromPath}</Label>
          <Input
            id={`${formId}-fromPath`}
            name="fromPath"
            placeholder="/old-path"
            aria-invalid={fieldErrors["fromPath"] !== undefined || undefined}
          />
          {fieldErrors["fromPath"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["fromPath"]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-toPath`}>{t.redirectCreate.toPath}</Label>
          <Input
            id={`${formId}-toPath`}
            name="toPath"
            placeholder="/new-path"
            aria-invalid={fieldErrors["toPath"] !== undefined || undefined}
          />
          {fieldErrors["toPath"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["toPath"]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-statusCode`}>{t.redirectCreate.statusCode}</Label>
          <select id={`${formId}-statusCode`} name="statusCode" className={SELECT_CLASS} defaultValue="301">
            <option value="301">301 — {t.redirectCreate.permanent}</option>
            <option value="302">302 — {t.redirectCreate.temporary}</option>
          </select>
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.redirectCreate.submitting : t.redirectCreate.submit}
        </Button>
      </div>
    </form>
  );
}
