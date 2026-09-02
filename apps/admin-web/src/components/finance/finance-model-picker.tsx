"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Label } from "@platform/ui";
import { FINANCE_READ_MODELS } from "@/lib/api/finance";
import type { Dictionary } from "@/messages/en";

/**
 * The model picker for `/finance/read-models` (T3.2) — a fixed dropdown over
 * `FINANCE_READ_MODELS` (the three models `FinanceProjectionService` actually populates), not a
 * free-text field: the backend's `QueryReadModel` use case never 404s on an unrecognised model
 * name, it silently returns an empty page, so a free-text field could look broken with no
 * explanation. Selecting a new model drops `?key=` (a drill-in key from the old model's rows
 * would be meaningless against the new one), mirroring `OrdersToolbar`'s "changing a filter drops
 * paging state" convention.
 */
export function FinanceModelPicker({
  t,
  selected,
}: {
  readonly t: Dictionary;
  readonly selected: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("model", value);
    params.delete("key");
    router.push(`${pathname}?${params.toString()}`);
  };

  const modelLabels = t.financeReadModelsPage.models as Record<string, string>;

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="finance-model-select" className="text-muted-foreground text-sm">
        {t.financeReadModelsPage.modelLabel}
      </Label>
      <select
        id="finance-model-select"
        value={selected}
        onChange={(event) => handleChange(event.target.value)}
        className="border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-base transition-colors ease-out"
      >
        {FINANCE_READ_MODELS.map((model) => (
          <option key={model} value={model}>
            {modelLabels[model] ?? model}
          </option>
        ))}
      </select>
    </div>
  );
}
