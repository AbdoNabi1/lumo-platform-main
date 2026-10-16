import type { DashboardRange } from "@/lib/dashboard/ranges";
import type { Dictionary } from "@/messages/en";
import { RangePicker } from "./range-picker";

/** Home's header: the title and the date range, which lives in the URL (`/?range=…`). */
export function DashboardHeader({
  t,
  userName,
  range,
}: {
  readonly t: Dictionary;
  readonly userName: string;
  readonly range: DashboardRange;
}) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{t.header.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t.header.subtitle.replace("{name}", userName)}
        </p>
      </div>

      <RangePicker t={t} range={range} path="/" />
    </header>
  );
}
