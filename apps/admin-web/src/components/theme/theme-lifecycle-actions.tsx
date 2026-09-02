"use client";

import { useActionState, useId } from "react";
import { Button, Label } from "@platform/ui";
import { advanceThemeAction } from "@/app/theme/actions";
import type { FormState } from "@/lib/api/mutation";
import { themeAdvanceableStatusesFrom } from "@/lib/theme-lifecycle";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

const SELECT_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out";

/**
 * The Theme Detail "advance to…" control (T5.9c), gated by `lib/theme-lifecycle.ts`'s
 * `THEME_LIFECYCLE_TRANSITIONS` — same "no control at all for a terminal status" discipline as
 * `PageLifecycleActions`.
 */
export function ThemeLifecycleActions({
  themeId,
  status,
  t,
}: {
  readonly themeId: string;
  readonly status: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(advanceThemeAction, INITIAL_STATE);
  const formId = useId();
  const targets = themeAdvanceableStatusesFrom(status);

  if (targets.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t.themeLifecycle.title}</h2>
      <form action={formAction} className="flex flex-col items-start gap-1">
        <input type="hidden" name="themeId" value={themeId} />
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${formId}-toStatus`} className="text-muted-foreground text-xs">
              {t.themeLifecycle.advanceToLabel}
            </Label>
            <select id={`${formId}-toStatus`} name="toStatus" className={SELECT_CLASS}>
              {targets.map((target) => (
                <option key={target} value={target}>
                  {(t.themeStatus as Record<string, string>)[target] ?? target}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
            {isPending ? t.themeLifecycle.advancing : t.themeLifecycle.advance}
          </Button>
        </div>
        {state.status === "error" && (
          <p role="alert" className="text-destructive text-xs">
            {state.message}
          </p>
        )}
      </form>
    </div>
  );
}
