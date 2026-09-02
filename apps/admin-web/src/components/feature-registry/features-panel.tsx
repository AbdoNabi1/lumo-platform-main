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
import type { FeatureOutputDto } from "@/lib/api/feature-registry";
import type { Dictionary } from "@/messages/en";
import { StatePanel } from "./state-panels";

export type FeaturesPanelResult =
  | { readonly outcome: "ok"; readonly data: readonly FeatureOutputDto[] }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** The feature catalog table (`GET /feature-registry/features`) — the Features tab. */
export function FeaturesPanel({
  result,
  t,
}: {
  readonly result: FeaturesPanelResult;
  readonly t: Dictionary;
}) {
  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.featureRegistryPage.featuresUnauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.featureRegistryPage.featuresError}
      />
    );
  }
  if (result.data.length === 0) {
    return (
      <StatePanel
        icon={<SearchXIcon aria-hidden="true" className="size-5" />}
        message={t.featureRegistryPage.featuresEmpty}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <Table aria-label={t.featureRegistryPage.tabs.features}>
          <TableHeader>
            <TableRow>
              <TableHead>{t.featureRegistryPage.featuresColumns.key}</TableHead>
              <TableHead>{t.featureRegistryPage.featuresColumns.name}</TableHead>
              <TableHead>{t.featureRegistryPage.featuresColumns.lifecycle}</TableHead>
              <TableHead>{t.featureRegistryPage.featuresColumns.category}</TableHead>
              <TableHead>{t.featureRegistryPage.featuresColumns.visibility}</TableHead>
              <TableHead className="text-end">
                {t.featureRegistryPage.featuresColumns.publishedVersion}
              </TableHead>
              <TableHead>{t.featureRegistryPage.featuresColumns.groups}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.data.map((feature) => (
              <TableRow key={feature.key}>
                <TableCell className="font-medium">{feature.key}</TableCell>
                <TableCell>{feature.name}</TableCell>
                <TableCell>
                  <Badge variant="neutral">{feature.lifecycle}</Badge>
                </TableCell>
                <TableCell>{feature.category}</TableCell>
                <TableCell>{feature.visibility}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {feature.publishedVersion ?? t.featureRegistryPage.none}
                </TableCell>
                <TableCell>
                  {feature.groups.length > 0 ? feature.groups.join(", ") : t.featureRegistryPage.none}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
