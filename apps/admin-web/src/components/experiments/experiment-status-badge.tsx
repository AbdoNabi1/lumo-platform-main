import { Badge } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

/**
 * Experiment status -> badge variant (`lib/experiment-lifecycle.ts`'s
 * `EXPERIMENT_LIFECYCLE_TRANSITIONS`). `draft` hasn't started, `running` is live, `paused` needs
 * attention, `completed` is the terminal success state, `archived` is the terminal retired state.
 */
const EXPERIMENT_STATUS_VARIANT: Readonly<
  Record<string, "neutral" | "info" | "success" | "warning" | "destructive" | "outline">
> = {
  draft: "neutral",
  running: "info",
  paused: "warning",
  completed: "success",
  archived: "outline",
};

export function ExperimentStatusBadge({
  status,
  t,
}: {
  readonly status: string;
  readonly t: Dictionary;
}) {
  const variant = EXPERIMENT_STATUS_VARIANT[status] ?? "neutral";
  const label = (t.experimentStatus as Record<string, string>)[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}
