import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import type { ExperimentDto } from "@/lib/api/experimentation";
import type { Dictionary } from "@/messages/en";
import { ExperimentStatusBadge } from "./experiment-status-badge";

export function ExperimentsTable({
  experiments,
  t,
}: {
  readonly experiments: readonly ExperimentDto[];
  readonly t: Dictionary;
}) {
  return (
    <Table aria-label={t.experimentsPage.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.experimentsPage.columns.name}</TableHead>
          <TableHead>{t.experimentsPage.columns.goalMetricRef}</TableHead>
          <TableHead>{t.experimentsPage.columns.audience}</TableHead>
          <TableHead>{t.experimentsPage.columns.status}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {experiments.map((experiment) => (
          <TableRow key={experiment.id}>
            <TableCell className="font-medium whitespace-nowrap">
              <Link href={`/experiments/${experiment.id}`} className="hover:text-primary">
                {experiment.name}
              </Link>
            </TableCell>
            <TableCell className="font-mono text-sm">{experiment.goalMetricRef}</TableCell>
            <TableCell className="text-muted-foreground whitespace-nowrap">
              {experiment.audiencePercentage}%
            </TableCell>
            <TableCell>
              <ExperimentStatusBadge status={experiment.status} t={t} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
