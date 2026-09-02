import { AggregateRoot, UniqueEntityId, BusinessRuleError } from "@platform/domain";
import { NotFoundError } from "@platform/utils";
import { LicensingChanged } from "./events/licensing-changed.event";
import { PlanVersion } from "./plan-version";
import type { PlanSpec } from "./value-objects/plan-spec";

export type PlanTier = "free" | "starter" | "growth" | "pro" | "enterprise" | "custom";

interface PlanProps {
  readonly key: string;
  name: string;
  tier: PlanTier;
  versions: PlanVersion[];
  publishedVersionId?: string;
}

/**
 * A plan product with an append-only version history (ADR-0018 Sprint-5.5 addendum §A) — stable
 * identity (`key`/`name`/`tier`) + the version history + the currently published version pointer.
 * Publishing a new `PlanVersion` never affects existing subscribers (they stay pinned to their id).
 */
export class Plan extends AggregateRoot<PlanProps> {
  static create(
    id: UniqueEntityId,
    key: string,
    name: string,
    tier: PlanTier,
    eventId: string,
    occurredAt: Date,
  ): Plan {
    const plan = new Plan({ key, name, tier, versions: [] }, id);
    plan.raise("created", eventId, occurredAt);
    return plan;
  }

  static reconstitute(
    id: UniqueEntityId,
    key: string,
    name: string,
    tier: PlanTier,
    versions: PlanVersion[],
    version: number,
    publishedVersionId?: string,
  ): Plan {
    return new Plan({ key, name, tier, versions, publishedVersionId }, id, version);
  }

  /** Creates a new draft version (or clones one from an existing version's spec). */
  createDraft(spec: PlanSpec, eventId: string, occurredAt: Date): PlanVersion {
    const draft = PlanVersion.createDraft(
      UniqueEntityId.from(`${this.id.toString()}-v${this.props.versions.length + 1}`),
      spec,
    );
    this.props.versions.push(draft);
    this.raise("draft_created", eventId, occurredAt, draft.id.toString());
    return draft;
  }

  /** Clones a draft from any existing version's spec (does not affect the source version). */
  clone(fromVersionId: string, eventId: string, occurredAt: Date): PlanVersion {
    const source = this.findVersion(fromVersionId);
    return this.createDraft(source.spec, eventId, occurredAt);
  }

  schedule(versionId: string, publishAt: Date, eventId: string, occurredAt: Date): void {
    this.findVersion(versionId).schedule(publishAt);
    this.raise("version_scheduled", eventId, occurredAt, versionId);
  }

  /** Publishes a version — never affects existing subscribers pinned to a different version id. */
  publish(versionId: string, eventId: string, occurredAt: Date): void {
    this.findVersion(versionId).publish();
    this.props.publishedVersionId = versionId;
    this.raise("version_published", eventId, occurredAt, versionId);
  }

  /** Re-points the published pointer to a previously published version (re-point, not a rewrite). */
  rollback(toVersionId: string, eventId: string, occurredAt: Date): void {
    const target = this.findVersion(toVersionId);
    if (target.status !== "published" && target.status !== "archived") {
      throw new BusinessRuleError("Can only roll back to a version that was published");
    }
    this.props.publishedVersionId = toVersionId;
    this.raise("rolled_back", eventId, occurredAt, toVersionId);
  }

  archive(versionId: string, eventId: string, occurredAt: Date): void {
    this.findVersion(versionId).archive();
    this.raise("version_archived", eventId, occurredAt, versionId);
  }

  compare(versionAId: string, versionBId: string) {
    const a = this.findVersion(versionAId);
    const b = this.findVersion(versionBId);
    return a.sections().diff(b.sections());
  }

  private findVersion(versionId: string): PlanVersion {
    const version = this.props.versions.find((v) => v.id.toString() === versionId);
    if (version === undefined) throw new NotFoundError(`Plan version ${versionId} not found`);
    return version;
  }

  private raise(action: string, eventId: string, occurredAt: Date, ref?: string): void {
    this.addDomainEvent(
      new LicensingChanged(
        { eventId, aggregateId: this.id, occurredAt },
        { ref: ref ?? this.props.key, family: "plan", action },
      ),
    );
  }

  get key(): string {
    return this.props.key;
  }

  get name(): string {
    return this.props.name;
  }

  get tier(): PlanTier {
    return this.props.tier;
  }

  get versions(): readonly PlanVersion[] {
    return this.props.versions;
  }

  get publishedVersionId(): string | undefined {
    return this.props.publishedVersionId;
  }
}
