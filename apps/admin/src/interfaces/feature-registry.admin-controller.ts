import type { Principal } from "@platform/contracts";
import type { FeatureRegistryController } from "@platform/feature-registry";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface FeatureRegistryAdminControllerDeps {
  readonly featureRegistry: FeatureRegistryController;
  readonly guard: AdminGuard;
}

/** Wires the Feature Registry admin screen to the Feature Registry context (Sprint S1). Pure delegation; every action authorizes first (RBAC seam, ADR-0007). */
export class FeatureRegistryAdminController {
  private readonly featureRegistry: FeatureRegistryController;
  private readonly guard: AdminGuard;

  constructor(deps: FeatureRegistryAdminControllerDeps) {
    this.featureRegistry = deps.featureRegistry;
    this.guard = deps.guard;
  }

  async register(
    principal: Principal,
    input: Parameters<FeatureRegistryController["register"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_registry:register");
    if (denied) return denied;
    return this.featureRegistry.register(input);
  }

  async editDraft(
    principal: Principal,
    input: Parameters<FeatureRegistryController["editDraft"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_registry:edit_draft");
    if (denied) return denied;
    return this.featureRegistry.editDraft(input);
  }

  async declareDependencies(
    principal: Principal,
    input: Parameters<FeatureRegistryController["declareDependencies"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_registry:declare_dependencies");
    if (denied) return denied;
    return this.featureRegistry.declareDependencies(input);
  }

  async setRequirements(
    principal: Principal,
    input: Parameters<FeatureRegistryController["setRequirements"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_registry:set_requirements");
    if (denied) return denied;
    return this.featureRegistry.setRequirements(input);
  }

  async setGroups(
    principal: Principal,
    input: Parameters<FeatureRegistryController["setGroups"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_registry:set_groups");
    if (denied) return denied;
    return this.featureRegistry.setGroups(input);
  }

  async setCompatibility(
    principal: Principal,
    input: Parameters<FeatureRegistryController["setCompatibility"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_registry:set_compatibility");
    if (denied) return denied;
    return this.featureRegistry.setCompatibility(input);
  }

  async setAiMetadata(
    principal: Principal,
    input: Parameters<FeatureRegistryController["setAiMetadata"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_registry:set_ai_metadata");
    if (denied) return denied;
    return this.featureRegistry.setAiMetadata(input);
  }

  async setMetadata(
    principal: Principal,
    input: Parameters<FeatureRegistryController["setMetadata"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_registry:set_metadata");
    if (denied) return denied;
    return this.featureRegistry.setMetadata(input);
  }

  async validate(principal: Principal): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_registry:validate");
    if (denied) return denied;
    return this.featureRegistry.validate();
  }

  async analyzeGraph(
    principal: Principal,
    input: Parameters<FeatureRegistryController["analyzeGraph"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_registry:analyze_graph");
    if (denied) return denied;
    return this.featureRegistry.analyzeGraph(input);
  }

  async createBundle(
    principal: Principal,
    input: Parameters<FeatureRegistryController["createBundle"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_registry:create_bundle");
    if (denied) return denied;
    return this.featureRegistry.createBundle(input);
  }

  async updateBundle(
    principal: Principal,
    input: Parameters<FeatureRegistryController["updateBundle"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_registry:update_bundle");
    if (denied) return denied;
    return this.featureRegistry.updateBundle(input);
  }

  async listBundles(principal: Principal): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_registry:list_bundles");
    if (denied) return denied;
    return this.featureRegistry.listBundles();
  }

  async advance(
    principal: Principal,
    input: Parameters<FeatureRegistryController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_registry:advance");
    if (denied) return denied;
    return this.featureRegistry.advance(input);
  }

  async replace(
    principal: Principal,
    input: Parameters<FeatureRegistryController["replace"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_registry:replace");
    if (denied) return denied;
    return this.featureRegistry.replace(input);
  }

  async resolve(
    principal: Principal,
    input: Parameters<FeatureRegistryController["resolve"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_registry:resolve");
    if (denied) return denied;
    return this.featureRegistry.resolve(input);
  }

  async list(
    principal: Principal,
    input: Parameters<FeatureRegistryController["list"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "feature_registry:list");
    if (denied) return denied;
    return this.featureRegistry.list(input);
  }
}
