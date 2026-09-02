import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import {
  FeatureRegistryChanged,
  type FeatureRegistryEventName,
} from "./events/feature-registry-changed.event";
import {
  normalizeAiMetadata,
  normalizeAnalyticsMetadata,
  normalizeCompatibility,
  normalizeConstraints,
  normalizeCostProfile,
  normalizeDependencies,
  normalizeDocumentation,
  normalizeGroups,
  normalizeRequirements,
  normalizeSpec,
  type FeatureAiMetadata,
  type FeatureAnalyticsMetadata,
  type FeatureCompatibility,
  type FeatureConstraints,
  type FeatureCostProfile,
  type FeatureDependency,
  type FeatureDocumentation,
  type FeatureLifecycle,
  type FeatureLifecyclePolicy,
  type FeatureRequirements,
  type FeatureSpec,
  type FeatureVersion,
  type FeatureVisibility,
} from "./value-objects/feature-spec";

export interface RegisterFeatureProps {
  readonly key: string;
  readonly name: string;
  readonly category: string;
  readonly visibility?: FeatureVisibility;
  readonly description?: string;
  readonly dependencies?: readonly FeatureDependency[];
  readonly requirements?: Partial<FeatureRequirements>;
}

interface FeatureDefinitionProps {
  readonly key: string;
  name: string;
  lifecycle: FeatureLifecycle;
  publishedVersionNumber: number | null;
  replacementKey: string | null;
  readonly versions: FeatureVersion[];
}

const FEATURE_KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

/**
 * FeatureDefinition — the aggregate at the heart of the Feature Registry (ADR-0027): the single source of truth
 * for a platform capability. It owns the capability's identity, category, visibility, dependencies, requirements
 * (plans/permissions/capabilities), versioned immutable history, deprecation, replacement and soft removal.
 *
 * It **never** owns: feature *state* (that is the consuming context's), *subscriptions* (Licensing), or developer
 * *flags* (Feature Flags/Experimentation). Published versions are immutable — a consumer that pins a version is
 * unaffected by later edits (same discipline as `licensing.PlanVersion`).
 */
export class FeatureDefinition extends AggregateRoot<FeatureDefinitionProps> {
  static register(
    id: UniqueEntityId,
    input: RegisterFeatureProps,
    eventId: string,
    occurredAt: Date,
  ): FeatureDefinition {
    const key = input.key.trim();
    if (!FEATURE_KEY.test(key))
      throw new BusinessRuleError(
        `"${input.key}" is not a valid feature key (use dotted lowercase, e.g. ai.copywriter)`,
      );
    if (input.name.trim().length === 0) throw new BusinessRuleError("A feature needs a name");
    if (input.category.trim().length === 0)
      throw new BusinessRuleError("A feature needs a category");
    const spec = normalizeSpec({
      category: input.category,
      visibility: input.visibility ?? "internal",
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.dependencies !== undefined ? { dependencies: input.dependencies } : {}),
      ...(input.requirements !== undefined ? { requirements: input.requirements } : {}),
    });
    const version: FeatureVersion = {
      versionNumber: 1,
      status: "draft",
      spec,
      createdAt: occurredAt.toISOString(),
      publishedAt: "",
    };
    const feature = new FeatureDefinition(
      {
        key,
        name: input.name.trim(),
        lifecycle: "draft",
        publishedVersionNumber: null,
        replacementKey: null,
        versions: [version],
      },
      id,
    );
    feature.emit("feature_registry.feature.registered", eventId, occurredAt);
    return feature;
  }

  static reconstitute(
    id: UniqueEntityId,
    base: {
      readonly key: string;
      readonly name: string;
      readonly lifecycle: FeatureLifecycle;
      readonly publishedVersionNumber: number | null;
      readonly replacementKey: string | null;
      readonly version: number;
    },
    extras: { readonly versions?: readonly FeatureVersion[] } = {},
  ): FeatureDefinition {
    return new FeatureDefinition(
      {
        key: base.key,
        name: base.name,
        lifecycle: base.lifecycle,
        publishedVersionNumber: base.publishedVersionNumber,
        replacementKey: base.replacementKey,
        versions: [...(extras.versions ?? [])],
      },
      id,
      base.version,
    );
  }

  /** The single mutable draft version, if one exists. */
  draft(): FeatureVersion | null {
    return this.props.versions.find((v) => v.status === "draft") ?? null;
  }

  publishedVersion(): FeatureVersion | null {
    return this.props.publishedVersionNumber === null
      ? null
      : this.versionAt(this.props.publishedVersionNumber);
  }

  versionAt(n: number): FeatureVersion | null {
    return this.props.versions.find((v) => v.versionNumber === n) ?? null;
  }

  /** The spec that currently governs the feature: the published version's, else the draft's. */
  effectiveSpec(): FeatureSpec {
    const published = this.publishedVersion();
    if (published !== null) return published.spec;
    const draft = this.draft();
    if (draft !== null) return draft.spec;
    // A reconstituted-but-empty aggregate should never occur; guard defensively.
    throw new BusinessRuleError("Feature has no version");
  }

  private requireDraft(): FeatureVersion {
    const draft = this.draft();
    if (draft === null)
      throw new BusinessRuleError("No open draft — call revise() to start a new version");
    if (this.props.lifecycle === "removed")
      throw new BusinessRuleError("A removed feature cannot be edited");
    return draft;
  }

  private replaceDraft(next: FeatureVersion): void {
    const idx = this.props.versions.findIndex((v) => v.versionNumber === next.versionNumber);
    if (idx >= 0) this.props.versions[idx] = next;
  }

  /** Rename the feature (metadata only, not versioned). */
  rename(name: string, eventId: string, occurredAt: Date): void {
    if (name.trim().length === 0) throw new BusinessRuleError("A feature needs a name");
    this.props.name = name.trim();
    this.emit("feature_registry.feature.draft_updated", eventId, occurredAt);
  }

  /** Edit the open draft's spec (visibility/category/description). */
  editDraft(
    patch: { category?: string; visibility?: FeatureVisibility; description?: string },
    eventId: string,
    occurredAt: Date,
  ): void {
    const draft = this.requireDraft();
    const spec: FeatureSpec = {
      ...draft.spec,
      category: patch.category !== undefined ? patch.category.trim() : draft.spec.category,
      visibility: patch.visibility ?? draft.spec.visibility,
      description:
        patch.description !== undefined ? patch.description.trim() : draft.spec.description,
    };
    if (spec.category.length === 0) throw new BusinessRuleError("A feature needs a category");
    this.replaceDraft({ ...draft, spec });
    this.emit("feature_registry.feature.draft_updated", eventId, occurredAt);
  }

  /** Assign the open draft to one or more logical groups (P1.1.1 §1). Metadata only — no runtime effect. */
  setGroups(groups: readonly string[], eventId: string, occurredAt: Date): void {
    const draft = this.requireDraft();
    this.replaceDraft({ ...draft, spec: { ...draft.spec, groups: normalizeGroups(groups) } });
    this.emit("feature_registry.feature.group_changed", eventId, occurredAt);
  }

  /** Set the open draft's compatibility matrix (P1.1.1 §9). Self-reference in requires/conflicts rejected. */
  setCompatibility(
    compatibility: Partial<FeatureCompatibility>,
    eventId: string,
    occurredAt: Date,
  ): void {
    const draft = this.requireDraft();
    const next = normalizeCompatibility(compatibility);
    if ([...next.requires, ...next.conflictsWith].includes(this.props.key))
      throw new BusinessRuleError("A feature cannot require or conflict with itself");
    this.replaceDraft({ ...draft, spec: { ...draft.spec, compatibility: next } });
    this.emit("feature_registry.feature.dependency_changed", eventId, occurredAt);
  }

  /** Set the open draft's AI-facing metadata (P1.1.1 §10). Metadata only — no AI logic. */
  setAiMetadata(ai: Partial<FeatureAiMetadata>, eventId: string, occurredAt: Date): void {
    const draft = this.requireDraft();
    this.replaceDraft({ ...draft, spec: { ...draft.spec, ai: normalizeAiMetadata(ai) } });
    this.emit("feature_registry.feature.draft_updated", eventId, occurredAt);
  }

  /**
   * Patch the open draft's P1.1.2 metadata (lifecycle policy / constraints / cost profile / documentation /
   * analytics). All are definitions/metadata — none change runtime behavior directly; other contexts consume them.
   */
  setMetadata(
    patch: {
      lifecyclePolicy?: FeatureLifecyclePolicy;
      constraints?: FeatureConstraints;
      cost?: Partial<FeatureCostProfile>;
      documentation?: Partial<FeatureDocumentation>;
      analytics?: Partial<FeatureAnalyticsMetadata>;
    },
    eventId: string,
    occurredAt: Date,
  ): void {
    const draft = this.requireDraft();
    this.replaceDraft({
      ...draft,
      spec: {
        ...draft.spec,
        lifecyclePolicy: patch.lifecyclePolicy ?? draft.spec.lifecyclePolicy,
        constraints:
          patch.constraints !== undefined
            ? normalizeConstraints(patch.constraints)
            : draft.spec.constraints,
        cost: patch.cost !== undefined ? normalizeCostProfile(patch.cost) : draft.spec.cost,
        documentation:
          patch.documentation !== undefined
            ? normalizeDocumentation(patch.documentation)
            : draft.spec.documentation,
        analytics:
          patch.analytics !== undefined
            ? normalizeAnalyticsMetadata(patch.analytics)
            : draft.spec.analytics,
      },
    });
    this.emit("feature_registry.feature.draft_updated", eventId, occurredAt);
  }

  /** Declare/replace the open draft's dependencies (self-dependency rejected). */
  setDependencies(
    dependencies: readonly FeatureDependency[],
    eventId: string,
    occurredAt: Date,
  ): void {
    const draft = this.requireDraft();
    const normalized = normalizeDependencies(dependencies);
    if (normalized.some((d) => d.featureKey === this.props.key))
      throw new BusinessRuleError("A feature cannot depend on itself");
    this.replaceDraft({ ...draft, spec: { ...draft.spec, dependencies: normalized } });
    this.emit("feature_registry.feature.dependency_changed", eventId, occurredAt);
  }

  /** Set the open draft's entitlement requirements (plans/permissions/capabilities). */
  setRequirements(
    requirements: Partial<FeatureRequirements>,
    eventId: string,
    occurredAt: Date,
  ): void {
    const draft = this.requireDraft();
    this.replaceDraft({
      ...draft,
      spec: { ...draft.spec, requirements: normalizeRequirements(requirements) },
    });
    this.emit("feature_registry.feature.draft_updated", eventId, occurredAt);
  }

  /** Publish the open draft → immutable published version; the feature becomes `active`. */
  publish(eventId: string, occurredAt: Date): void {
    const draft = this.requireDraft();
    this.replaceDraft({ ...draft, status: "published", publishedAt: occurredAt.toISOString() });
    this.props.publishedVersionNumber = draft.versionNumber;
    if (this.props.lifecycle === "draft" || this.props.lifecycle === "deprecated")
      this.props.lifecycle = "active";
    this.emit("feature_registry.feature.version_published", eventId, occurredAt);
  }

  /** Start a new draft cloned from the published spec (enables a next immutable version). */
  revise(eventId: string, occurredAt: Date): void {
    if (this.props.lifecycle === "removed")
      throw new BusinessRuleError("A removed feature cannot be revised");
    if (this.draft() !== null) throw new BusinessRuleError("A draft is already open");
    const base = this.publishedVersion();
    if (base === null) throw new BusinessRuleError("Nothing published to revise");
    const next = Math.max(...this.props.versions.map((v) => v.versionNumber)) + 1;
    this.props.versions.push({
      versionNumber: next,
      status: "draft",
      spec: base.spec,
      createdAt: occurredAt.toISOString(),
      publishedAt: "",
    });
    this.emit("feature_registry.feature.revised", eventId, occurredAt);
  }

  /** Mark the feature deprecated (must be active). Existing consumers keep working; it is hidden from new adopters. */
  deprecate(eventId: string, occurredAt: Date): void {
    if (this.props.lifecycle !== "active")
      throw new BusinessRuleError(
        `Only an active feature can be deprecated (is ${this.props.lifecycle})`,
      );
    this.props.lifecycle = "deprecated";
    this.emit("feature_registry.feature.deprecated", eventId, occurredAt);
  }

  /** Deprecate + point to a replacement feature key (migration path). */
  replaceWith(replacementKey: string, eventId: string, occurredAt: Date): void {
    const key = replacementKey.trim();
    if (key.length === 0) throw new BusinessRuleError("A replacement key is required");
    if (key === this.props.key) throw new BusinessRuleError("A feature cannot replace itself");
    if (this.props.lifecycle === "removed")
      throw new BusinessRuleError("A removed feature cannot be replaced");
    this.props.replacementKey = key;
    if (this.props.lifecycle === "active") this.props.lifecycle = "deprecated";
    this.emit("feature_registry.feature.replaced", eventId, occurredAt);
  }

  /** Soft-remove the feature (record + history retained). Terminal. */
  softRemove(eventId: string, occurredAt: Date): void {
    if (this.props.lifecycle === "removed")
      throw new BusinessRuleError("Feature is already removed");
    this.props.lifecycle = "removed";
    this.emit("feature_registry.feature.removed", eventId, occurredAt);
  }

  get key(): string {
    return this.props.key;
  }
  get name(): string {
    return this.props.name;
  }
  get lifecycle(): FeatureLifecycle {
    return this.props.lifecycle;
  }
  get publishedVersionNumber(): number | null {
    return this.props.publishedVersionNumber;
  }
  get replacementKey(): string | null {
    return this.props.replacementKey;
  }
  get versions(): readonly FeatureVersion[] {
    return this.props.versions;
  }

  private emit(event: FeatureRegistryEventName, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new FeatureRegistryChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          aggregateId: this.id.toString(),
          aggregate: "feature",
          key: this.props.key,
          event,
          lifecycle: this.props.lifecycle,
          publishedVersion: this.props.publishedVersionNumber,
        },
      ),
    );
  }
}
