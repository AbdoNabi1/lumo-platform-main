import { UniqueEntityId } from "@platform/domain";
import { FeatureFlag } from "../domain/feature-flag";
import { FlagChange, type FlagChangeAction } from "../domain/flag-change";
import { FeatureEnvironment } from "../domain/value-objects/feature-environment";
import { FeatureRule, type FeatureRuleType } from "../domain/value-objects/feature-rule";
import { FlagStatus, type FlagStatusValue } from "../domain/value-objects/flag-status";

export interface FeatureEnvironmentJson {
  readonly environment: string;
  readonly enabled: boolean;
  readonly rolloutPercentage?: number;
}
export interface FeatureRuleJson {
  readonly type: FeatureRuleType;
  readonly attribute?: string;
  readonly values: readonly string[];
  readonly enabled: boolean;
}
export interface FlagChangeJson {
  readonly id: string;
  readonly action: FlagChangeAction;
  readonly changedBy: string;
  readonly details?: string;
  readonly occurredAt: string;
}

export interface FeatureFlagRow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly environments: readonly FeatureEnvironmentJson[];
  readonly rules: readonly FeatureRuleJson[];
  readonly rolloutPercentage: number;
  readonly changes: readonly FlagChangeJson[];
  readonly version: number;
}

/** Persistence ↔ aggregate mapping for {@link FeatureFlag}. Mapping only — no I/O. */
export class FeatureFlagMapper {
  static toDomain(row: FeatureFlagRow): FeatureFlag {
    return FeatureFlag.reconstitute(
      UniqueEntityId.from(row.id),
      row.key,
      row.name,
      FlagStatus.from(row.status as FlagStatusValue),
      row.rolloutPercentage,
      row.version,
      {
        description: row.description ?? undefined,
        environments: row.environments.map((e) =>
          FeatureEnvironment.create(e.environment, e.enabled, e.rolloutPercentage),
        ),
        rules: row.rules.map((r) => FeatureRule.create(r.type, r.values, r.enabled, r.attribute)),
        changes: row.changes.map((c) =>
          FlagChange.create(
            UniqueEntityId.from(c.id),
            c.action,
            c.changedBy,
            new Date(c.occurredAt),
            c.details,
          ),
        ),
      },
    );
  }

  static toRow(flag: FeatureFlag, tenantId: string) {
    return {
      id: flag.id.toString(),
      tenantId,
      key: flag.key,
      name: flag.name,
      description: flag.description ?? null,
      status: flag.status.value,
      environments: flag.environments.map((e) => ({
        environment: e.environment,
        enabled: e.enabled,
        rolloutPercentage: e.rolloutPercentage,
      })),
      rules: flag.rules.map((r) => ({
        type: r.type,
        attribute: r.attribute,
        values: r.values,
        enabled: r.enabled,
      })),
      rolloutPercentage: flag.rolloutPercentage,
      changes: flag.changes.map((c) => ({
        id: c.id.toString(),
        action: c.action,
        changedBy: c.changedBy,
        details: c.details,
        occurredAt: c.occurredAt.toISOString(),
      })),
      version: 1,
    };
  }
}
