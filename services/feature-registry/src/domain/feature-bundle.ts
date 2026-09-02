import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import {
  FeatureRegistryChanged,
  type FeatureRegistryEventName,
} from "./events/feature-registry-changed.event";

export type FeatureBundleStatus = "active" | "archived";

const BUNDLE_KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}

export interface CreateBundleProps {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly featureKeys?: readonly string[];
  readonly groups?: readonly string[];
}

interface FeatureBundleProps {
  readonly key: string;
  name: string;
  description: string;
  status: FeatureBundleStatus;
  featureKeys: string[];
  groups: string[];
}

/**
 * FeatureBundle (P1.1.1 §2) — a reusable **commercial** collection of features (AI Pack, Growth Pack, Enterprise
 * Pack, …). A bundle **references** features by key and **owns no business logic** — Licensing references bundles to
 * compose plan entitlements. It lives in the Feature Registry because it is definition metadata, not entitlement
 * state (which Licensing owns). Tenant-aware, versioned (optimistic lock), outbox.
 */
export class FeatureBundle extends AggregateRoot<FeatureBundleProps> {
  static create(
    id: UniqueEntityId,
    input: CreateBundleProps,
    eventId: string,
    occurredAt: Date,
  ): FeatureBundle {
    const key = input.key.trim();
    if (!BUNDLE_KEY.test(key))
      throw new BusinessRuleError(
        `"${input.key}" is not a valid bundle key (use dotted lowercase, e.g. ai.pack)`,
      );
    if (input.name.trim().length === 0) throw new BusinessRuleError("A bundle needs a name");
    const bundle = new FeatureBundle(
      {
        key,
        name: input.name.trim(),
        description: (input.description ?? "").trim(),
        status: "active",
        featureKeys: dedupe(input.featureKeys ?? []),
        groups: dedupe(input.groups ?? []),
      },
      id,
    );
    bundle.emit("feature_registry.bundle.created", eventId, occurredAt);
    return bundle;
  }

  static reconstitute(
    id: UniqueEntityId,
    base: {
      readonly key: string;
      readonly name: string;
      readonly description: string;
      readonly status: FeatureBundleStatus;
      readonly version: number;
    },
    extras: { readonly featureKeys?: readonly string[]; readonly groups?: readonly string[] } = {},
  ): FeatureBundle {
    return new FeatureBundle(
      {
        key: base.key,
        name: base.name,
        description: base.description,
        status: base.status,
        featureKeys: [...(extras.featureKeys ?? [])],
        groups: [...(extras.groups ?? [])],
      },
      id,
      base.version,
    );
  }

  private requireActive(): void {
    if (this.props.status !== "active")
      throw new BusinessRuleError("An archived bundle cannot be modified");
  }

  setFeatures(featureKeys: readonly string[], eventId: string, occurredAt: Date): void {
    this.requireActive();
    this.props.featureKeys = dedupe(featureKeys);
    this.emit("feature_registry.bundle.updated", eventId, occurredAt);
  }

  update(
    patch: { name?: string; description?: string; groups?: readonly string[] },
    eventId: string,
    occurredAt: Date,
  ): void {
    this.requireActive();
    if (patch.name !== undefined) {
      if (patch.name.trim().length === 0) throw new BusinessRuleError("A bundle needs a name");
      this.props.name = patch.name.trim();
    }
    if (patch.description !== undefined) this.props.description = patch.description.trim();
    if (patch.groups !== undefined) this.props.groups = dedupe(patch.groups);
    this.emit("feature_registry.bundle.updated", eventId, occurredAt);
  }

  archive(eventId: string, occurredAt: Date): void {
    if (this.props.status === "archived") throw new BusinessRuleError("Bundle is already archived");
    this.props.status = "archived";
    this.emit("feature_registry.bundle.archived", eventId, occurredAt);
  }

  get key(): string {
    return this.props.key;
  }
  get name(): string {
    return this.props.name;
  }
  get description(): string {
    return this.props.description;
  }
  get status(): FeatureBundleStatus {
    return this.props.status;
  }
  get featureKeys(): readonly string[] {
    return this.props.featureKeys;
  }
  get groups(): readonly string[] {
    return this.props.groups;
  }

  private emit(event: FeatureRegistryEventName, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new FeatureRegistryChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          aggregateId: this.id.toString(),
          aggregate: "bundle",
          key: this.props.key,
          event,
          lifecycle: this.props.status,
          publishedVersion: null,
        },
      ),
    );
  }
}
