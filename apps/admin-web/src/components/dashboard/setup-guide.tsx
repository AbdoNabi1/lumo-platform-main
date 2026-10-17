"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { CheckCircle2Icon, CircleDashedIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { dismissSetupGuideAction } from "@/app/setup-guide-actions";
import type { FormState } from "@/lib/api/mutation";
import { setupProgress, type SetupStep, type SetupStepId } from "@/lib/dashboard/setup-guide";
import { formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * Home's "Set up your store" card, like Shopify's: a progress line and bar, then one expandable row
 * per step with a check once it is done (the theme step is never checked) and a button to the screen
 * that finishes it. "Dismiss" hides the guide for good through a server action.
 */
export function SetupGuide({
  steps,
  t,
  locale = "en",
}: {
  readonly steps: readonly SetupStep[];
  readonly t: Dictionary;
  readonly locale?: Locale;
}) {
  const copy = t.setupGuide;
  const { done, total } = setupProgress(steps);
  const [openId, setOpenId] = useState<SetupStepId | null>(
    () => steps.find((step) => step.done === false)?.id ?? null,
  );
  const [state, formAction, pending] = useActionState(dismissSetupGuideAction, INITIAL_STATE);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <CardTitle as="h2">{copy.title}</CardTitle>
          <p className="text-muted-foreground text-sm">
            {copy.progress
              .replace("{done}", formatNumber(locale, done))
              .replace("{total}", formatNumber(locale, total))}
          </p>
          <div
            role="progressbar"
            aria-label={copy.title}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            className="bg-secondary h-1.5 w-full max-w-xs overflow-hidden rounded-full"
          >
            <div
              className="bg-primary h-full rounded-full transition-[inline-size]"
              style={{ inlineSize: total === 0 ? "0%" : `${(done / total) * 100}%` }}
            />
          </div>
        </div>
        <form action={formAction} className="shrink-0">
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            disabled={pending}
            aria-label={copy.dismiss}
            title={pending ? copy.dismissing : copy.dismiss}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </form>
      </CardHeader>
      <CardContent className="px-0 sm:px-0">
        {state.status === "error" && (
          <p
            role="alert"
            className="bg-destructive-subtle text-destructive-subtle-foreground mx-4 mb-3 rounded-xl px-4 py-3 text-sm sm:mx-5"
          >
            {state.message}
          </p>
        )}
        <ul className="flex flex-col">
          {steps.map((step) => {
            const stepCopy = copy.steps[step.id];
            const open = openId === step.id;
            const panelId = `setup-step-${step.id}`;
            return (
              <li key={step.id} data-step={step.id} className="border-border/60 border-t">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setOpenId(open ? null : step.id)}
                  className="hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-3 px-4 py-3 text-start focus-visible:outline-none focus-visible:ring-2 sm:px-5"
                >
                  <StepMark done={step.done} t={t} />
                  <span
                    className={
                      step.done === true
                        ? "text-muted-foreground min-w-0 flex-1 text-base"
                        : "min-w-0 flex-1 text-base font-medium"
                    }
                  >
                    {stepCopy.title}
                  </span>
                  <ChevronDownIcon
                    aria-hidden="true"
                    className={`text-muted-foreground size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </button>
                {open && (
                  <div
                    id={panelId}
                    className="flex flex-col items-start gap-3 pb-4 pe-4 ps-11 sm:pe-5 sm:ps-12"
                  >
                    <p className="text-muted-foreground text-base">{stepCopy.body}</p>
                    <Button asChild size="sm" variant={step.done === true ? "outline" : "primary"}>
                      <Link href={step.href}>{stepCopy.action}</Link>
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/** A check for a finished step, an empty circle for an open one, nothing for an untracked step. */
function StepMark({ done, t }: { readonly done: boolean | null; readonly t: Dictionary }) {
  if (done === null) {
    return <span aria-hidden="true" className="size-5 shrink-0" />;
  }
  return (
    <span
      role="img"
      aria-label={done ? t.setupGuide.done : t.setupGuide.notDone}
      className="flex size-5 shrink-0 items-center justify-center"
    >
      {done ? (
        <CheckCircle2Icon
          aria-hidden="true"
          className="bg-success-subtle text-success-foreground size-5 rounded-full"
        />
      ) : (
        <CircleDashedIcon aria-hidden="true" className="text-muted-foreground size-5" />
      )}
    </span>
  );
}
