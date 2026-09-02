"use client";

import { useActionState, useId, useState } from "react";
import { AlertTriangleIcon, PlusIcon, XIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { setRobotsPolicyAction } from "@/app/seo/robots-policies/actions";
import type { RobotsRule } from "@/lib/api/seo";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

const SELECT_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out";

interface RuleRow {
  readonly key: string;
  readonly type: string;
  readonly path: string;
}

let nextRuleRowKey = 0;
function newRuleRow(type: string, path: string): RuleRow {
  nextRuleRowKey += 1;
  return { key: `robots-rule-row-${nextRuleRowKey}`, type, path };
}

/**
 * The Robots Policies create/set form (T5.9b). `POST /seo/robots-policies` create-or-updates keyed
 * by `userAgent`, so this same form doubles as the edit UI: the list page's row link pre-fills
 * `defaultUserAgent`/`defaultRules` from the resolved policy, and re-submitting updates it. `rules`
 * is the repeated `{type, path}` array — same technique `OrderLineItemsField`/`parseVariants`
 * established.
 */
export function RobotsPolicyForm({
  t,
  defaultUserAgent,
  defaultRules,
}: {
  readonly t: Dictionary;
  readonly defaultUserAgent?: string;
  readonly defaultRules?: readonly RobotsRule[];
}) {
  const [state, formAction, isPending] = useActionState(setRobotsPolicyAction, INITIAL_STATE);
  const formId = useId();
  const [rows, setRows] = useState<readonly RuleRow[]>(() =>
    defaultRules !== undefined && defaultRules.length > 0
      ? defaultRules.map((rule) => newRuleRow(rule.type, rule.path))
      : [newRuleRow("allow", "")],
  );
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  function addRow(): void {
    setRows((current) => [...current, newRuleRow("allow", "")]);
  }

  function removeRow(key: string): void {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.key !== key) : current));
  }

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
        <Label htmlFor={`${formId}-userAgent`}>{t.robotsPolicyForm.userAgent}</Label>
        <Input
          id={`${formId}-userAgent`}
          name="userAgent"
          defaultValue={defaultUserAgent}
          placeholder="*"
          aria-invalid={fieldErrors["userAgent"] !== undefined || undefined}
        />
        {fieldErrors["userAgent"] !== undefined && (
          <p className="text-destructive text-sm">{fieldErrors["userAgent"]}</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t.robotsPolicyForm.rulesTitle}</h2>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <PlusIcon aria-hidden="true" />
            {t.robotsPolicyForm.addRule}
          </Button>
        </div>

        {fieldErrors["rules"] !== undefined && (
          <p className="text-destructive text-sm">{fieldErrors["rules"]}</p>
        )}

        <div className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <div key={row.key} className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr_2.5rem]">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={`${formId}-ruleType-${index}`}
                  className={index > 0 ? "sr-only" : undefined}
                >
                  {t.robotsPolicyForm.ruleType}
                </Label>
                <select
                  id={`${formId}-ruleType-${index}`}
                  name="ruleType"
                  className={SELECT_CLASS}
                  defaultValue={row.type}
                >
                  <option value="allow">{t.robotsPolicyForm.allow}</option>
                  <option value="disallow">{t.robotsPolicyForm.disallow}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={`${formId}-rulePath-${index}`}
                  className={index > 0 ? "sr-only" : undefined}
                >
                  {t.robotsPolicyForm.rulePath}
                </Label>
                <Input
                  id={`${formId}-rulePath-${index}`}
                  name="rulePath"
                  defaultValue={row.path}
                  placeholder="/admin"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={index === 0 ? "mt-6" : undefined}
                disabled={rows.length === 1}
                onClick={() => removeRow(row.key)}
                aria-label={t.robotsPolicyForm.removeRule}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.robotsPolicyForm.submitting : t.robotsPolicyForm.submit}
        </Button>
      </div>
    </form>
  );
}
