"use client";

import { useActionState, useId } from "react";
import { CheckIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import { createCategoryAction } from "@/app/categories/actions";
import type { CategoryDto } from "@/lib/api/categories";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * Inline create form for the Categories list screen (T5.7). `parentId` is a `<select>` populated
 * from the categories already on the current page — a full tree picker is explicitly out of scope
 * per the brief ("do not build a tree widget").
 */
export function CategoryCreateForm({
  categories,
  t,
}: {
  readonly categories: readonly CategoryDto[];
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(createCategoryAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.categoryCreateForm.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${formId}-name`}>{t.categoryCreateForm.name}</Label>
            <Input
              id={`${formId}-name`}
              name="name"
              className="h-9 w-48"
              aria-invalid={fieldErrors["name"] !== undefined || undefined}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${formId}-slug`}>{t.categoryCreateForm.slug}</Label>
            <Input
              id={`${formId}-slug`}
              name="slug"
              className="h-9 w-48"
              aria-invalid={fieldErrors["slug"] !== undefined || undefined}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${formId}-parentId`}>{t.categoryCreateForm.parentId}</Label>
            <select
              id={`${formId}-parentId`}
              name="parentId"
              className="border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out"
              defaultValue=""
            >
              <option value="">{t.categoryCreateForm.parentIdNone}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" loading={isPending} disabled={isPending}>
            {isPending ? t.categoryCreateForm.submitting : t.categoryCreateForm.submit}
          </Button>
          {state.status === "success" && (
            <p role="status" className="text-muted-foreground flex items-center gap-1 text-xs">
              <CheckIcon aria-hidden="true" className="size-3.5" />
              {t.categoryRowActions.saved}
            </p>
          )}
        </form>
        {state.status === "error" && (
          <p role="alert" className="text-destructive mt-2 text-xs">
            {state.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
