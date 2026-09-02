import { AlertTriangleIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { ResolveFeatureResult, ResolvedFeatureDto } from "@/lib/api/feature-registry";
import type { Dictionary } from "@/messages/en";
import { InlineState } from "./state-panels";

/**
 * The resolution card shown above the tabs when `?key=` is set (T3.4) — the
 * `GET /feature-registry/features/:key/resolve` outcome (available / lifecycle / requirements /
 * dependencies), or one of its three non-`ok` outcomes rendered explicitly rather than an empty
 * card.
 */
export function ResolvePanel({
  result,
  keyParam,
  t,
}: {
  readonly result: ResolveFeatureResult;
  readonly keyParam: string;
  readonly t: Dictionary;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.featureRegistryPage.resolveTitle.replace("{key}", keyParam)}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResolveBody result={result} t={t} />
      </CardContent>
    </Card>
  );
}

function ResolveBody({
  result,
  t,
}: {
  readonly result: ResolveFeatureResult;
  readonly t: Dictionary;
}) {
  if (result.outcome === "unauthorized") {
    return (
      <InlineState
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.featureRegistryPage.resolveUnauthorized}
      />
    );
  }
  if (result.outcome === "not_found") {
    return (
      <InlineState
        icon={<SearchXIcon aria-hidden="true" className="size-5" />}
        message={t.featureRegistryPage.resolveNotFound}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <InlineState
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.featureRegistryPage.resolveError}
      />
    );
  }

  const feature: ResolvedFeatureDto = result.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={feature.available ? "success" : "destructive"}>
          {feature.available
            ? t.featureRegistryPage.resolveAvailable
            : t.featureRegistryPage.resolveUnavailable}
        </Badge>
        <span className="text-muted-foreground text-sm">{feature.name}</span>
        <Badge variant="neutral">{feature.lifecycle}</Badge>
      </div>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StringListStat
          label={t.featureRegistryPage.resolveRequiredPlans}
          values={feature.requiredPlans}
          none={t.featureRegistryPage.none}
        />
        <StringListStat
          label={t.featureRegistryPage.resolveRequiredPermissions}
          values={feature.requiredPermissions}
          none={t.featureRegistryPage.none}
        />
        <StringListStat
          label={t.featureRegistryPage.resolveRequiredCapabilities}
          values={feature.requiredCapabilities}
          none={t.featureRegistryPage.none}
        />
      </dl>
      <div>
        <p className="text-muted-foreground text-sm">{t.featureRegistryPage.resolveDependencies}</p>
        {feature.dependencies.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {feature.dependencies.map((dependency) => (
              <Badge key={dependency.featureKey} variant="outline">
                {dependency.featureKey}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground mt-1 text-sm">{t.featureRegistryPage.none}</p>
        )}
      </div>
    </div>
  );
}

function StringListStat({
  label,
  values,
  none,
}: {
  readonly label: string;
  readonly values: readonly string[];
  readonly none: string;
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{values.length > 0 ? values.join(", ") : none}</dd>
    </div>
  );
}
