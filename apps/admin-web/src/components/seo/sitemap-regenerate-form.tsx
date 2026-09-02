"use client";

import { useActionState, useId, useState } from "react";
import { AlertTriangleIcon, PlusIcon, XIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { regenerateSitemapAction } from "@/app/seo/sitemaps/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

interface UrlRow {
  readonly key: string;
}

let nextUrlRowKey = 0;
function newUrlRowKey(): string {
  nextUrlRowKey += 1;
  return `sitemap-url-row-${nextUrlRowKey}`;
}

/**
 * The Sitemap Detail screen's "Regenerate" form (T5.9b): a repeated-text-row array for the new
 * `urls` list — same technique `OrderLineItemsField`/`app/products/actions.ts`'s `parseVariants`
 * established, simplified to a single field per row.
 */
export function SitemapRegenerateForm({
  sitemapId,
  currentUrls,
  t,
}: {
  readonly sitemapId: string;
  readonly currentUrls: readonly string[];
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(regenerateSitemapAction, INITIAL_STATE);
  const formId = useId();
  const [rows, setRows] = useState<readonly UrlRow[]>(() =>
    currentUrls.length > 0 ? currentUrls.map(() => ({ key: newUrlRowKey() })) : [{ key: newUrlRowKey() }],
  );
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  function addRow(): void {
    setRows((current) => [...current, { key: newUrlRowKey() }]);
  }

  function removeRow(key: string): void {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.key !== key) : current));
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="sitemapId" value={sitemapId} />

      {state.status === "error" && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground flex items-center gap-2 rounded-xl border px-4 py-3 text-sm"
        >
          <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t.sitemapRegenerate.title}</h2>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <PlusIcon aria-hidden="true" />
          {t.sitemapRegenerate.addUrl}
        </Button>
      </div>

      {fieldErrors["urls"] !== undefined && (
        <p className="text-destructive text-sm">{fieldErrors["urls"]}</p>
      )}

      <div className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const id = `${formId}-url-${index}`;
          return (
            <div key={row.key} className="grid grid-cols-[1fr_2.5rem] items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={id} className={index > 0 ? "sr-only" : undefined}>
                  {t.sitemapRegenerate.urlField}
                </Label>
                <Input id={id} name="url" defaultValue={currentUrls[index]} placeholder="https://example.com/" />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={rows.length === 1}
                onClick={() => removeRow(row.key)}
                aria-label={t.sitemapRegenerate.removeUrl}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </div>
          );
        })}
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.sitemapRegenerate.submitting : t.sitemapRegenerate.submit}
        </Button>
      </div>
    </form>
  );
}
