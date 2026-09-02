import { AlertTriangleIcon, LockIcon, SearchXIcon } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import {
  deriveCapabilityEdges,
  type FeatureOutputDto,
  type FetchCapabilityGraphResult,
} from "@/lib/api/feature-registry";
import type { Dictionary } from "@/messages/en";
import { StatePanel } from "./state-panels";

/**
 * The capability graph tab (T3.4 brief): a cycle/acyclic summary from
 * `GET /feature-registry/capability-graph`, plus a **plain from/to/relationship edge table**
 * derived from the feature catalog (`deriveCapabilityEdges`) — deliberately not a drawn graph, and
 * no graph-drawing dependency was added to build one. See `lib/api/feature-registry.ts`'s module
 * doc for why the backend endpoint alone can't supply the edge list.
 */
export function CapabilityGraphPanel({
  graphResult,
  features,
  t,
}: {
  readonly graphResult: FetchCapabilityGraphResult;
  readonly features: readonly FeatureOutputDto[];
  readonly t: Dictionary;
}) {
  if (graphResult.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.featureRegistryPage.graphUnauthorized}
      />
    );
  }
  if (graphResult.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.featureRegistryPage.graphError}
      />
    );
  }

  const graph = graphResult.data;
  const edges = deriveCapabilityEdges(features);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-4">
          <span className="text-sm">
            {t.featureRegistryPage.graphSummaryNodes}:{" "}
            <span className="font-medium tabular-nums">{graph.nodes.length}</span>
          </span>
          <Badge variant={graph.acyclic ? "success" : "destructive"}>
            {graph.acyclic
              ? t.featureRegistryPage.graphSummaryAcyclic
              : t.featureRegistryPage.graphSummaryCyclic}
          </Badge>
          {graph.cycles.length > 0 ? (
            <span className="text-muted-foreground text-sm">
              {t.featureRegistryPage.graphCyclesLabel}:{" "}
              {graph.cycles.map((cycle) => cycle.join(" → ")).join(", ")}
            </span>
          ) : null}
        </CardContent>
      </Card>

      {edges.length === 0 ? (
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={t.featureRegistryPage.graphEdgesEmpty}
        />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <Table aria-label={t.featureRegistryPage.tabs.graph}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.featureRegistryPage.graphEdgesColumns.from}</TableHead>
                  <TableHead>{t.featureRegistryPage.graphEdgesColumns.to}</TableHead>
                  <TableHead>{t.featureRegistryPage.graphEdgesColumns.relationship}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {edges.map((edge, index) => (
                  <TableRow key={`${edge.from}-${edge.to}-${edge.relationship}-${index}`}>
                    <TableCell className="font-medium">{edge.from}</TableCell>
                    <TableCell>{edge.to}</TableCell>
                    <TableCell>
                      {edge.relationship === "dependency"
                        ? t.featureRegistryPage.relationshipDependency
                        : t.featureRegistryPage.relationshipRequires}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
