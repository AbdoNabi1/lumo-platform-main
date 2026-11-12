import { SearchIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import type { AbandonedRecoveryStatus } from "@/lib/api/abandoned-checkouts";
import type { Dictionary } from "@/messages/en";

/**
 * Search ("Search by email, name or phone") and the Recovery status filter. A plain GET form: the URL
 * holds the state (shareable, back-button safe) and no client JavaScript is needed; submitting drops
 * the cursor, so a new search starts on page one.
 */
export function AbandonedCheckoutsFilters({
  q,
  recovery,
  t,
}: {
  readonly q: string | undefined;
  readonly recovery: AbandonedRecoveryStatus | undefined;
  readonly t: Dictionary;
}) {
  const a = t.abandonedCheckouts;
  return (
    <form
      role="search"
      method="get"
      action="/abandoned-checkouts"
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex min-w-60 flex-1 flex-col gap-1.5">
        <Label htmlFor="abandoned-search" className="sr-only">
          {a.searchLabel}
        </Label>
        <Input
          id="abandoned-search"
          type="search"
          name="q"
          dir="auto"
          maxLength={200}
          defaultValue={q ?? ""}
          placeholder={a.searchPlaceholder}
          aria-label={a.searchLabel}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="abandoned-recovery">{a.recoveryFilterLabel}</Label>
        <select
          id="abandoned-recovery"
          name="recovery"
          defaultValue={recovery ?? ""}
          className="border-input bg-card text-foreground h-9 rounded-xl border px-3.5 text-base"
        >
          <option value="">{a.recoveryFilterAll}</option>
          <option value="not_recovered">{a.notRecovered}</option>
          <option value="recovered">{a.recovered}</option>
        </select>
      </div>
      <Button type="submit" variant="outline">
        <SearchIcon aria-hidden="true" />
        {a.search}
      </Button>
    </form>
  );
}
