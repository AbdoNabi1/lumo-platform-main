import { UniqueEntityId } from "@platform/domain";
import { FeatureBundle, type FeatureBundleStatus } from "../domain/feature-bundle";
import { FeatureDefinition } from "../domain/feature-definition";
import {
  hydrateSpec,
  type FeatureLifecycle,
  type FeatureVersion,
  type FeatureVisibility,
} from "../domain/value-objects/feature-spec";

// Named interfaces do not satisfy Prisma's `InputJsonValue` (no index signature); this structural type does.
type JsonWritable = string | number | boolean | { [key: string]: JsonWritable } | JsonWritable[];

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export interface FeatureDefinitionRow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly lifecycle: string;
  readonly category: string;
  readonly visibility: string;
  readonly publishedVersionNumber: number | null;
  readonly replacementKey: string | null;
  readonly versions: unknown;
  readonly version: number;
}

function versionsToJson(feature: FeatureDefinition): JsonWritable {
  return feature.versions.map((v) => ({
    versionNumber: v.versionNumber,
    status: v.status,
    createdAt: v.createdAt,
    publishedAt: v.publishedAt,
    spec: {
      category: v.spec.category,
      visibility: v.spec.visibility,
      description: v.spec.description,
      dependencies: v.spec.dependencies.map((d) => ({
        featureKey: d.featureKey,
        minVersion: d.minVersion,
      })),
      requirements: {
        requiredPlans: [...v.spec.requirements.requiredPlans],
        requiredPermissions: [...v.spec.requirements.requiredPermissions],
        requiredCapabilities: [...v.spec.requirements.requiredCapabilities],
      },
      groups: [...v.spec.groups],
      compatibility: {
        compatibleWith: [...v.spec.compatibility.compatibleWith],
        requires: [...v.spec.compatibility.requires],
        conflictsWith: [...v.spec.compatibility.conflictsWith],
        replaces: [...v.spec.compatibility.replaces],
        deprecatedBy: v.spec.compatibility.deprecatedBy,
        migrationTarget: v.spec.compatibility.migrationTarget,
      },
      ai: {
        aiDescription: v.spec.ai.aiDescription,
        businessDescription: v.spec.ai.businessDescription,
        technicalDescription: v.spec.ai.technicalDescription,
        tags: [...v.spec.ai.tags],
        useCases: [...v.spec.ai.useCases],
        relatedFeatures: [...v.spec.ai.relatedFeatures],
        examples: [...v.spec.ai.examples],
      },
      lifecyclePolicy: v.spec.lifecyclePolicy,
      constraints: { ...v.spec.constraints },
      cost: { ...v.spec.cost },
      documentation: {
        documentationUrl: v.spec.documentation.documentationUrl,
        developerGuide: v.spec.documentation.developerGuide,
        sdkReference: v.spec.documentation.sdkReference,
        apiReference: v.spec.documentation.apiReference,
        examples: [...v.spec.documentation.examples],
        tutorials: [...v.spec.documentation.tutorials],
        changelog: v.spec.documentation.changelog,
        migrationGuide: v.spec.documentation.migrationGuide,
        releaseNotes: v.spec.documentation.releaseNotes,
        faq: v.spec.documentation.faq,
      },
      analytics: { ...v.spec.analytics },
    },
  }));
}

interface RawVersion {
  readonly versionNumber: number;
  readonly status: FeatureVersion["status"];
  readonly createdAt: string;
  readonly publishedAt: string;
  readonly spec: { category: string; visibility: FeatureVisibility } & Record<string, unknown>;
}

/** Rehydrates a stored version, filling any additive P1.1.1 spec fields absent from older rows. */
function versionFromRaw(raw: RawVersion): FeatureVersion {
  return {
    versionNumber: raw.versionNumber,
    status: raw.status,
    createdAt: raw.createdAt,
    publishedAt: raw.publishedAt,
    spec: hydrateSpec(raw.spec),
  };
}

export class FeatureDefinitionMapper {
  static toDomain(row: FeatureDefinitionRow): FeatureDefinition {
    const versions = toArray(row.versions).map((raw) => versionFromRaw(raw as RawVersion));
    return FeatureDefinition.reconstitute(
      UniqueEntityId.from(row.id),
      {
        key: row.key,
        name: row.name,
        lifecycle: row.lifecycle as FeatureLifecycle,
        publishedVersionNumber: row.publishedVersionNumber,
        replacementKey: row.replacementKey,
        version: row.version,
      },
      { versions },
    );
  }

  static toRow(feature: FeatureDefinition, tenantId: string) {
    return {
      id: feature.id.toString(),
      tenantId,
      version: 1,
      key: feature.key,
      ...FeatureDefinitionMapper.fields(feature),
    };
  }

  static toUpdate(feature: FeatureDefinition) {
    return FeatureDefinitionMapper.fields(feature);
  }

  private static fields(feature: FeatureDefinition) {
    const spec = feature.effectiveSpec();
    return {
      name: feature.name,
      lifecycle: feature.lifecycle,
      category: spec.category,
      visibility: spec.visibility,
      publishedVersionNumber: feature.publishedVersionNumber,
      replacementKey: feature.replacementKey,
      versions: versionsToJson(feature),
    };
  }
}

export interface FeatureBundleRow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly status: string;
  readonly featureKeys: unknown;
  readonly groups: unknown;
  readonly version: number;
}

function stringArray(value: unknown): string[] {
  return toArray(value).filter((v): v is string => typeof v === "string");
}

export class FeatureBundleMapper {
  static toDomain(row: FeatureBundleRow): FeatureBundle {
    return FeatureBundle.reconstitute(
      UniqueEntityId.from(row.id),
      {
        key: row.key,
        name: row.name,
        description: row.description,
        status: row.status as FeatureBundleStatus,
        version: row.version,
      },
      { featureKeys: stringArray(row.featureKeys), groups: stringArray(row.groups) },
    );
  }

  static toRow(bundle: FeatureBundle, tenantId: string) {
    return {
      id: bundle.id.toString(),
      tenantId,
      version: 1,
      key: bundle.key,
      ...FeatureBundleMapper.fields(bundle),
    };
  }

  static toUpdate(bundle: FeatureBundle) {
    return FeatureBundleMapper.fields(bundle);
  }

  private static fields(bundle: FeatureBundle) {
    const featureKeys: JsonWritable = [...bundle.featureKeys];
    const groups: JsonWritable = [...bundle.groups];
    return {
      name: bundle.name,
      description: bundle.description,
      status: bundle.status,
      featureKeys,
      groups,
    };
  }
}
