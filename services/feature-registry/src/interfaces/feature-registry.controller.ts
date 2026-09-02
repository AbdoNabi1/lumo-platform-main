import type {
  AdvanceFeature,
  AnalyzeCapabilityGraph,
  AnalyzeCapabilityGraphInput,
  CreateBundle,
  DeclareDependencies,
  DeclareDependenciesInput,
  EditFeatureDraft,
  EditFeatureDraftInput,
  FeatureActionInput,
  ListBundles,
  ListFeatures,
  ListFeaturesInput,
  RegisterFeature,
  ReplaceFeature,
  ReplaceFeatureInput,
  ResolveFeature,
  ResolveFeatureInput,
  SetAiMetadataInput,
  SetCompatibilityInput,
  SetFeatureAiMetadata,
  SetFeatureCompatibility,
  SetFeatureGroups,
  SetFeatureMetadata,
  SetGroupsInput,
  SetMetadataInput,
  SetRequirements,
  SetRequirementsInput,
  UpdateBundle,
  UpdateBundleInput,
  ValidateRegistry,
} from "../application/feature-registry.use-cases";
import type { CreateBundleProps } from "../domain/feature-bundle";
import type { RegisterFeatureProps } from "../domain/feature-definition";
import { present, type ControllerResponse } from "./presenter";

export interface FeatureRegistryUseCases {
  readonly registerFeature: RegisterFeature;
  readonly editFeatureDraft: EditFeatureDraft;
  readonly declareDependencies: DeclareDependencies;
  readonly setRequirements: SetRequirements;
  readonly setFeatureGroups: SetFeatureGroups;
  readonly setFeatureCompatibility: SetFeatureCompatibility;
  readonly setFeatureAiMetadata: SetFeatureAiMetadata;
  readonly setFeatureMetadata: SetFeatureMetadata;
  readonly advanceFeature: AdvanceFeature;
  readonly replaceFeature: ReplaceFeature;
  readonly resolveFeature: ResolveFeature;
  readonly listFeatures: ListFeatures;
  readonly analyzeCapabilityGraph: AnalyzeCapabilityGraph;
  readonly createBundle: CreateBundle;
  readonly updateBundle: UpdateBundle;
  readonly listBundles: ListBundles;
  readonly validateRegistry: ValidateRegistry;
}

/**
 * Transport-neutral controller for the Feature Registry (ADR-0007 RBAC seam is applied at the admin edge). Every
 * method returns a {@link ControllerResponse}. Reads (`resolve`/`list`) power discovery + the EntitlementGuard.
 */
export class FeatureRegistryController {
  constructor(private readonly useCases: FeatureRegistryUseCases) {}

  async register(input: RegisterFeatureProps): Promise<ControllerResponse> {
    return present(await this.useCases.registerFeature.execute(input), 201);
  }

  async editDraft(input: EditFeatureDraftInput): Promise<ControllerResponse> {
    return present(await this.useCases.editFeatureDraft.execute(input), 200);
  }

  async declareDependencies(input: DeclareDependenciesInput): Promise<ControllerResponse> {
    return present(await this.useCases.declareDependencies.execute(input), 200);
  }

  async setRequirements(input: SetRequirementsInput): Promise<ControllerResponse> {
    return present(await this.useCases.setRequirements.execute(input), 200);
  }

  async setGroups(input: SetGroupsInput): Promise<ControllerResponse> {
    return present(await this.useCases.setFeatureGroups.execute(input), 200);
  }

  async setCompatibility(input: SetCompatibilityInput): Promise<ControllerResponse> {
    return present(await this.useCases.setFeatureCompatibility.execute(input), 200);
  }

  async setAiMetadata(input: SetAiMetadataInput): Promise<ControllerResponse> {
    return present(await this.useCases.setFeatureAiMetadata.execute(input), 200);
  }

  async setMetadata(input: SetMetadataInput): Promise<ControllerResponse> {
    return present(await this.useCases.setFeatureMetadata.execute(input), 200);
  }

  async validate(): Promise<ControllerResponse> {
    return present(await this.useCases.validateRegistry.execute(), 200);
  }

  async analyzeGraph(input: AnalyzeCapabilityGraphInput): Promise<ControllerResponse> {
    return present(await this.useCases.analyzeCapabilityGraph.execute(input), 200);
  }

  async createBundle(input: CreateBundleProps): Promise<ControllerResponse> {
    return present(await this.useCases.createBundle.execute(input), 201);
  }

  async updateBundle(input: UpdateBundleInput): Promise<ControllerResponse> {
    return present(await this.useCases.updateBundle.execute(input), 200);
  }

  async listBundles(): Promise<ControllerResponse> {
    return present(await this.useCases.listBundles.execute(), 200);
  }

  async advance(input: FeatureActionInput): Promise<ControllerResponse> {
    return present(await this.useCases.advanceFeature.execute(input), 200);
  }

  async replace(input: ReplaceFeatureInput): Promise<ControllerResponse> {
    return present(await this.useCases.replaceFeature.execute(input), 200);
  }

  async resolve(input: ResolveFeatureInput): Promise<ControllerResponse> {
    return present(await this.useCases.resolveFeature.execute(input), 200);
  }

  async list(input: ListFeaturesInput): Promise<ControllerResponse> {
    return present(await this.useCases.listFeatures.execute(input), 200);
  }
}
