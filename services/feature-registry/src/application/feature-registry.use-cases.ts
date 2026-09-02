import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import { CapabilityGraph } from "../domain/capability-graph";
import { FeatureBundle, type CreateBundleProps } from "../domain/feature-bundle";
import { FeatureDefinition, type RegisterFeatureProps } from "../domain/feature-definition";
import type { FeatureBundleRepository, FeatureDefinitionRepository } from "../domain/repositories";
import type {
  FeatureAiMetadata,
  FeatureAnalyticsMetadata,
  FeatureCompatibility,
  FeatureConstraints,
  FeatureCostProfile,
  FeatureDependency,
  FeatureDocumentation,
  FeatureLifecyclePolicy,
  FeatureRequirements,
  FeatureVisibility,
} from "../domain/value-objects/feature-spec";
import {
  FeatureRegistryValidator,
  type RegistryValidationReport,
} from "../domain/feature-registry-validator";

export interface FeatureRegistryDeps {
  readonly features: FeatureDefinitionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface FeatureOutput {
  readonly key: string;
  readonly name: string;
  readonly lifecycle: string;
  readonly category: string;
  readonly visibility: string;
  readonly publishedVersion: number | null;
  readonly versionCount: number;
  readonly hasDraft: boolean;
  readonly replacementKey: string | null;
  readonly requiredPlans: readonly string[];
  readonly requiredPermissions: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly dependencies: readonly FeatureDependency[];
  readonly groups: readonly string[];
  readonly compatibility: FeatureCompatibility;
  readonly ai: FeatureAiMetadata;
  readonly lifecyclePolicy: FeatureLifecyclePolicy;
  readonly constraints: FeatureConstraints;
  readonly cost: FeatureCostProfile;
  readonly documentation: FeatureDocumentation;
  readonly analytics: FeatureAnalyticsMetadata;
}

export function presentFeature(feature: FeatureDefinition): FeatureOutput {
  const spec = feature.effectiveSpec();
  return {
    key: feature.key,
    name: feature.name,
    lifecycle: feature.lifecycle,
    category: spec.category,
    visibility: spec.visibility,
    publishedVersion: feature.publishedVersionNumber,
    versionCount: feature.versions.length,
    hasDraft: feature.draft() !== null,
    replacementKey: feature.replacementKey,
    requiredPlans: spec.requirements.requiredPlans,
    requiredPermissions: spec.requirements.requiredPermissions,
    requiredCapabilities: spec.requirements.requiredCapabilities,
    dependencies: spec.dependencies,
    groups: spec.groups,
    compatibility: spec.compatibility,
    ai: spec.ai,
    lifecyclePolicy: spec.lifecyclePolicy,
    constraints: spec.constraints,
    cost: spec.cost,
    documentation: spec.documentation,
    analytics: spec.analytics,
  };
}

/** Registers a new feature definition with an initial draft (v1). Idempotent per key. */
export class RegisterFeature implements UseCase<RegisterFeatureProps, FeatureOutput, DomainError> {
  constructor(private readonly deps: FeatureRegistryDeps) {}
  async execute(input: RegisterFeatureProps): Promise<Result<FeatureOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<FeatureOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.features.findByKey(input.key.trim(), tx);
      if (existing !== null) return ok(presentFeature(existing));
      let feature: FeatureDefinition;
      try {
        feature = FeatureDefinition.register(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          input,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.features.save(feature, tx);
      return ok(presentFeature(feature));
    });
  }
}

async function withFeature(
  deps: FeatureRegistryDeps,
  key: string,
  apply: (f: FeatureDefinition) => void,
): Promise<Result<FeatureOutput, DomainError>> {
  return deps.unitOfWork.run<Result<FeatureOutput, DomainError>>(async (tx) => {
    const feature = await deps.features.findByKey(key.trim(), tx);
    if (feature === null) return err(new NotFoundError("Feature not found"));
    try {
      apply(feature);
    } catch (error) {
      if (isDomainError(error)) return err(error);
      throw error;
    }
    await deps.features.save(feature, tx);
    return ok(presentFeature(feature));
  });
}

export interface EditFeatureDraftInput {
  readonly key: string;
  readonly name?: string;
  readonly category?: string;
  readonly visibility?: FeatureVisibility;
  readonly description?: string;
}

/** Edits the feature's metadata (name) and/or its open draft spec (category/visibility/description). */
export class EditFeatureDraft implements UseCase<
  EditFeatureDraftInput,
  FeatureOutput,
  DomainError
> {
  constructor(private readonly deps: FeatureRegistryDeps) {}
  async execute(input: EditFeatureDraftInput): Promise<Result<FeatureOutput, DomainError>> {
    return withFeature(this.deps, input.key, (f) => {
      const eventId = this.deps.idGenerator.generate();
      const now = this.deps.clock.now();
      if (input.name !== undefined) f.rename(input.name, eventId, now);
      if (
        input.category !== undefined ||
        input.visibility !== undefined ||
        input.description !== undefined
      ) {
        f.editDraft(
          {
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
          },
          this.deps.idGenerator.generate(),
          now,
        );
      }
    });
  }
}

export interface DeclareDependenciesInput {
  readonly key: string;
  readonly dependencies: readonly FeatureDependency[];
}

/** Declares the feature's dependencies on other features (open draft). */
export class DeclareDependencies implements UseCase<
  DeclareDependenciesInput,
  FeatureOutput,
  DomainError
> {
  constructor(private readonly deps: FeatureRegistryDeps) {}
  async execute(input: DeclareDependenciesInput): Promise<Result<FeatureOutput, DomainError>> {
    return withFeature(this.deps, input.key, (f) =>
      f.setDependencies(
        input.dependencies,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      ),
    );
  }
}

export interface SetRequirementsInput {
  readonly key: string;
  readonly requirements: Partial<FeatureRequirements>;
}

/** Sets the entitlement requirements (plans/permissions/capabilities) on the open draft. */
export class SetRequirements implements UseCase<SetRequirementsInput, FeatureOutput, DomainError> {
  constructor(private readonly deps: FeatureRegistryDeps) {}
  async execute(input: SetRequirementsInput): Promise<Result<FeatureOutput, DomainError>> {
    return withFeature(this.deps, input.key, (f) =>
      f.setRequirements(
        input.requirements,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      ),
    );
  }
}

export interface FeatureActionInput {
  readonly key: string;
  readonly to: "publish" | "revise" | "deprecate" | "remove";
}

/** Runs a lifecycle action on a feature (publish draft / open a revision / deprecate / soft-remove). */
export class AdvanceFeature implements UseCase<FeatureActionInput, FeatureOutput, DomainError> {
  constructor(private readonly deps: FeatureRegistryDeps) {}
  async execute(input: FeatureActionInput): Promise<Result<FeatureOutput, DomainError>> {
    return withFeature(this.deps, input.key, (f) => {
      const eventId = this.deps.idGenerator.generate();
      const now = this.deps.clock.now();
      if (input.to === "publish") f.publish(eventId, now);
      else if (input.to === "revise") f.revise(eventId, now);
      else if (input.to === "deprecate") f.deprecate(eventId, now);
      else f.softRemove(eventId, now);
    });
  }
}

export interface ReplaceFeatureInput {
  readonly key: string;
  readonly replacementKey: string;
}

/** Deprecates a feature and points it at a replacement (migration path). */
export class ReplaceFeature implements UseCase<ReplaceFeatureInput, FeatureOutput, DomainError> {
  constructor(private readonly deps: FeatureRegistryDeps) {}
  async execute(input: ReplaceFeatureInput): Promise<Result<FeatureOutput, DomainError>> {
    return withFeature(this.deps, input.key, (f) =>
      f.replaceWith(input.replacementKey, this.deps.idGenerator.generate(), this.deps.clock.now()),
    );
  }
}

export interface ResolveFeatureInput {
  readonly key: string;
}

export interface ResolvedFeature extends FeatureOutput {
  /** True when the feature is usable (active or deprecated — not draft/removed). */
  readonly available: boolean;
}

/**
 * Read-only resolution of a feature definition and its requirements — the query the EntitlementGuard's adapter
 * uses to learn a feature's required plans/permissions/capabilities and whether it is available at all.
 */
export class ResolveFeature implements UseCase<ResolveFeatureInput, ResolvedFeature, DomainError> {
  constructor(private readonly deps: FeatureRegistryDeps) {}
  async execute(input: ResolveFeatureInput): Promise<Result<ResolvedFeature, DomainError>> {
    const feature = await this.deps.features.findByKey(input.key.trim());
    if (feature === null) return err(new NotFoundError("Feature not found"));
    const base = presentFeature(feature);
    const available =
      (feature.lifecycle === "active" || feature.lifecycle === "deprecated") &&
      feature.publishedVersionNumber !== null;
    return ok({ ...base, available });
  }
}

export interface ListFeaturesInput {
  readonly lifecycle?: string;
  readonly category?: string;
}

/** Discovery — the feature catalog (read model), optionally filtered. */
export class ListFeatures implements UseCase<
  ListFeaturesInput,
  { readonly features: readonly FeatureOutput[] },
  DomainError
> {
  constructor(private readonly deps: FeatureRegistryDeps) {}
  async execute(
    input: ListFeaturesInput,
  ): Promise<Result<{ readonly features: readonly FeatureOutput[] }, DomainError>> {
    const filter: { lifecycle?: string; category?: string } = {};
    if (input.lifecycle !== undefined) filter.lifecycle = input.lifecycle;
    if (input.category !== undefined) filter.category = input.category;
    const features = await this.deps.features.list(filter);
    return ok({ features: features.map(presentFeature) });
  }
}

export interface SetGroupsInput {
  readonly key: string;
  readonly groups: readonly string[];
}

/** Assigns the feature's open draft to logical groups (P1.1.1 §1). */
export class SetFeatureGroups implements UseCase<SetGroupsInput, FeatureOutput, DomainError> {
  constructor(private readonly deps: FeatureRegistryDeps) {}
  async execute(input: SetGroupsInput): Promise<Result<FeatureOutput, DomainError>> {
    return withFeature(this.deps, input.key, (f) =>
      f.setGroups(input.groups, this.deps.idGenerator.generate(), this.deps.clock.now()),
    );
  }
}

export interface SetCompatibilityInput {
  readonly key: string;
  readonly compatibility: Partial<FeatureCompatibility>;
}

/** Sets the feature's compatibility matrix on the open draft (P1.1.1 §9). */
export class SetFeatureCompatibility implements UseCase<
  SetCompatibilityInput,
  FeatureOutput,
  DomainError
> {
  constructor(private readonly deps: FeatureRegistryDeps) {}
  async execute(input: SetCompatibilityInput): Promise<Result<FeatureOutput, DomainError>> {
    return withFeature(this.deps, input.key, (f) =>
      f.setCompatibility(
        input.compatibility,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      ),
    );
  }
}

export interface SetAiMetadataInput {
  readonly key: string;
  readonly ai: Partial<FeatureAiMetadata>;
}

/** Sets the feature's AI-facing metadata on the open draft (P1.1.1 §10). */
export class SetFeatureAiMetadata implements UseCase<
  SetAiMetadataInput,
  FeatureOutput,
  DomainError
> {
  constructor(private readonly deps: FeatureRegistryDeps) {}
  async execute(input: SetAiMetadataInput): Promise<Result<FeatureOutput, DomainError>> {
    return withFeature(this.deps, input.key, (f) =>
      f.setAiMetadata(input.ai, this.deps.idGenerator.generate(), this.deps.clock.now()),
    );
  }
}

export interface SetMetadataInput {
  readonly key: string;
  readonly lifecyclePolicy?: FeatureLifecyclePolicy;
  readonly constraints?: FeatureConstraints;
  readonly cost?: Partial<FeatureCostProfile>;
  readonly documentation?: Partial<FeatureDocumentation>;
  readonly analytics?: Partial<FeatureAnalyticsMetadata>;
}

/** Sets the P1.1.2 metadata (lifecycle policy / constraints / cost / documentation / analytics) on the draft. */
export class SetFeatureMetadata implements UseCase<SetMetadataInput, FeatureOutput, DomainError> {
  constructor(private readonly deps: FeatureRegistryDeps) {}
  async execute(input: SetMetadataInput): Promise<Result<FeatureOutput, DomainError>> {
    return withFeature(this.deps, input.key, (f) =>
      f.setMetadata(
        {
          ...(input.lifecyclePolicy !== undefined
            ? { lifecyclePolicy: input.lifecyclePolicy }
            : {}),
          ...(input.constraints !== undefined ? { constraints: input.constraints } : {}),
          ...(input.cost !== undefined ? { cost: input.cost } : {}),
          ...(input.documentation !== undefined ? { documentation: input.documentation } : {}),
          ...(input.analytics !== undefined ? { analytics: input.analytics } : {}),
        },
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      ),
    );
  }
}

/* ------------------------------------- Capability graph -------------------------------------- */

export interface CapabilityGraphOutput {
  readonly nodes: readonly string[];
  readonly cycles: readonly (readonly string[])[];
  readonly acyclic: boolean;
  /** Present when the query targets a specific feature key. */
  readonly focus?: {
    readonly key: string;
    readonly dependencies: readonly string[];
    readonly transitiveDependencies: readonly string[];
    readonly dependents: readonly string[];
    readonly impact: readonly string[];
  };
}

export interface AnalyzeCapabilityGraphInput {
  /** Optional focus feature for reverse-lookup + impact analysis. */
  readonly key?: string;
}

/**
 * Read-only enterprise dependency-graph analysis (P1.1.1 §3): builds the {@link CapabilityGraph} from every
 * feature's dependencies + compatibility `requires`, then answers cycle detection, traversal, reverse lookup and
 * impact analysis deterministically.
 */
export class AnalyzeCapabilityGraph implements UseCase<
  AnalyzeCapabilityGraphInput,
  CapabilityGraphOutput,
  DomainError
> {
  constructor(private readonly deps: FeatureRegistryDeps) {}
  async execute(
    input: AnalyzeCapabilityGraphInput,
  ): Promise<Result<CapabilityGraphOutput, DomainError>> {
    const features = await this.deps.features.list();
    const graph = CapabilityGraph.fromFeatures(
      features.map((f) => {
        const s = f.effectiveSpec();
        return { key: f.key, dependencies: s.dependencies, requires: s.compatibility.requires };
      }),
    );
    const cycles = graph.detectCycles();
    const base: CapabilityGraphOutput = {
      nodes: graph.keys(),
      cycles,
      acyclic: cycles.length === 0,
    };
    if (input.key === undefined) return ok(base);
    return ok({
      ...base,
      focus: {
        key: input.key,
        dependencies: graph.dependenciesOf(input.key),
        transitiveDependencies: graph.transitiveDependencies(input.key),
        dependents: graph.dependents(input.key),
        impact: graph.impactOf(input.key),
      },
    });
  }
}

/* ---------------------------------------- Bundles -------------------------------------------- */

export interface FeatureBundleDeps {
  readonly bundles: FeatureBundleRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface BundleOutput {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly status: string;
  readonly featureKeys: readonly string[];
  readonly groups: readonly string[];
}

function presentBundle(bundle: FeatureBundle): BundleOutput {
  return {
    key: bundle.key,
    name: bundle.name,
    description: bundle.description,
    status: bundle.status,
    featureKeys: bundle.featureKeys,
    groups: bundle.groups,
  };
}

/** Creates a reusable commercial bundle referencing features (P1.1.1 §2). Idempotent per key. */
export class CreateBundle implements UseCase<CreateBundleProps, BundleOutput, DomainError> {
  constructor(private readonly deps: FeatureBundleDeps) {}
  async execute(input: CreateBundleProps): Promise<Result<BundleOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<BundleOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.bundles.findByKey(input.key.trim(), tx);
      if (existing !== null) return ok(presentBundle(existing));
      let bundle: FeatureBundle;
      try {
        bundle = FeatureBundle.create(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          input,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.bundles.save(bundle, tx);
      return ok(presentBundle(bundle));
    });
  }
}

async function withBundle(
  deps: FeatureBundleDeps,
  key: string,
  apply: (b: FeatureBundle) => void,
): Promise<Result<BundleOutput, DomainError>> {
  return deps.unitOfWork.run<Result<BundleOutput, DomainError>>(async (tx) => {
    const bundle = await deps.bundles.findByKey(key.trim(), tx);
    if (bundle === null) return err(new NotFoundError("Bundle not found"));
    try {
      apply(bundle);
    } catch (error) {
      if (isDomainError(error)) return err(error);
      throw error;
    }
    await deps.bundles.save(bundle, tx);
    return ok(presentBundle(bundle));
  });
}

export interface UpdateBundleInput {
  readonly key: string;
  readonly name?: string;
  readonly description?: string;
  readonly featureKeys?: readonly string[];
  readonly groups?: readonly string[];
  readonly archive?: boolean;
}

/** Updates a bundle's features/metadata or archives it (P1.1.1 §2). */
export class UpdateBundle implements UseCase<UpdateBundleInput, BundleOutput, DomainError> {
  constructor(private readonly deps: FeatureBundleDeps) {}
  async execute(input: UpdateBundleInput): Promise<Result<BundleOutput, DomainError>> {
    return withBundle(this.deps, input.key, (b) => {
      const eventId = this.deps.idGenerator.generate();
      const now = this.deps.clock.now();
      if (input.archive === true) {
        b.archive(eventId, now);
        return;
      }
      if (input.featureKeys !== undefined)
        b.setFeatures(input.featureKeys, this.deps.idGenerator.generate(), now);
      if (
        input.name !== undefined ||
        input.description !== undefined ||
        input.groups !== undefined
      ) {
        b.update(
          {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.groups !== undefined ? { groups: input.groups } : {}),
          },
          this.deps.idGenerator.generate(),
          now,
        );
      }
    });
  }
}

export interface ListBundlesInput {
  readonly _?: never;
}

/** Discovery — the bundle catalog (read model). */
export class ListBundles implements UseCase<
  ListBundlesInput,
  { readonly bundles: readonly BundleOutput[] },
  DomainError
> {
  constructor(private readonly deps: FeatureBundleDeps) {}
  async execute(): Promise<Result<{ readonly bundles: readonly BundleOutput[] }, DomainError>> {
    const bundles = await this.deps.bundles.list();
    return ok({ bundles: bundles.map(presentBundle) });
  }
}

/* ---------------------------------------- Validation ----------------------------------------- */

export interface ValidateRegistryDeps {
  readonly features: FeatureDefinitionRepository;
  readonly bundles: FeatureBundleRepository;
}

export interface ValidateRegistryInput {
  readonly _?: never;
}

/** Deterministic whole-registry validation (P1.1.2 §7) — duplicates/cycles/compatibility/deps/constraints/docs. */
export class ValidateRegistry implements UseCase<
  ValidateRegistryInput,
  RegistryValidationReport,
  DomainError
> {
  private readonly validator = new FeatureRegistryValidator();
  constructor(private readonly deps: ValidateRegistryDeps) {}
  async execute(): Promise<Result<RegistryValidationReport, DomainError>> {
    const [features, bundles] = await Promise.all([
      this.deps.features.list(),
      this.deps.bundles.list(),
    ]);
    return ok(this.validator.validate(features, bundles));
  }
}
