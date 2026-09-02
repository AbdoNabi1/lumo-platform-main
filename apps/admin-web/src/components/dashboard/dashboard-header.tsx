import { CalendarIcon, ChevronDownIcon, SlidersHorizontalIcon } from "lucide-react";
import { Badge, Button } from "@platform/ui";
import type { PageProvenance } from "@/data/dashboard";
import type { Dictionary } from "@/messages/en";

/**
 * Page header: title, greeting, and the period/filter controls.
 *
 * `provenance` is the page-level summary (`summarizePageProvenance` in `data/dashboard.ts`) —
 * "live" only when every section below is live, "demo" only when every section is demo, "mixed"
 * otherwise (today's actual state: Revenue live, the rest demo). The header says so next to the
 * title rather than letting a partly-sample page pass as either fully real or fully fake; the
 * per-section badges on each card carry the precise, per-tile truth.
 */
export function DashboardHeader({
  t,
  userName,
  rangeLabel,
  provenance,
}: {
  readonly t: Dictionary;
  readonly userName: string;
  readonly rangeLabel: string;
  readonly provenance: PageProvenance;
}) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-4xl font-semibold tracking-tight">{t.header.title}</h1>
          {provenance === "demo" && <Badge variant="warning">{t.data.demoBadge}</Badge>}
          {provenance === "mixed" && <Badge variant="info">{t.data.partialBadge}</Badge>}
        </div>
        <p className="text-md text-muted-foreground mt-1">
          {t.header.subtitle.replace("{name}", userName)}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button variant="outline" size="md" aria-label={t.header.dateRange}>
          <CalendarIcon aria-hidden="true" />
          <span className="tabular-nums">{rangeLabel}</span>
          <ChevronDownIcon aria-hidden="true" />
        </Button>
        <Button variant="outline" size="md">
          <SlidersHorizontalIcon aria-hidden="true" />
          {t.header.filters}
        </Button>
      </div>
    </header>
  );
}
