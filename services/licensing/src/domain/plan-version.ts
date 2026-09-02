import { Entity, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { PlanSections } from "./plan-sections";
import type { PlanSpec } from "./value-objects/plan-spec";

export type PlanVersionStatus = "draft" | "scheduled" | "published" | "archived";

const TRANSITIONS: Record<PlanVersionStatus, readonly PlanVersionStatus[]> = {
  draft: ["scheduled", "published", "archived"],
  scheduled: ["published", "draft", "archived"],
  published: ["archived"],
  archived: [],
};

interface PlanVersionProps {
  readonly spec: PlanSpec;
  status: PlanVersionStatus;
  scheduledPublishAt?: Date;
}

/**
 * An append-only, **immutable-once-published** snapshot of a `Plan`'s limits/entitlements/pricing
 * (ADR-0018 Sprint-5.5 addendum §A) — `draft → scheduled → published → archived`. Publishing a new
 * version never affects existing subscribers (they stay pinned to their `PlanVersion` id). Owned
 * by `Plan` as an internal history entity (like Content's/Theme's/Experience's append-only
 * `*Version` entities, G4), not a separate aggregate root.
 */
export class PlanVersion extends Entity<PlanVersionProps> {
  static createDraft(id: UniqueEntityId, spec: PlanSpec): PlanVersion {
    return new PlanVersion({ spec, status: "draft" }, id);
  }

  static reconstitute(
    id: UniqueEntityId,
    spec: PlanSpec,
    status: PlanVersionStatus,
    scheduledPublishAt?: Date,
  ): PlanVersion {
    return new PlanVersion({ spec, status, scheduledPublishAt }, id);
  }

  schedule(publishAt: Date): void {
    this.transition("scheduled");
    this.props.scheduledPublishAt = publishAt;
  }

  publish(): void {
    this.transition("published");
  }

  archive(): void {
    this.transition("archived");
  }

  /** Read-only preview — resolves this draft as if it were published (no state change). */
  preview(): PlanSpec {
    return this.props.spec;
  }

  sections(): PlanSections {
    return PlanSections.project(this.props.spec);
  }

  private transition(to: PlanVersionStatus): void {
    if (!TRANSITIONS[this.props.status].includes(to)) {
      throw new BusinessRuleError(
        `Cannot transition plan version from ${this.props.status} to ${to}`,
      );
    }
    if (this.props.status === "published") {
      throw new BusinessRuleError("A published plan version is immutable");
    }
    this.props.status = to;
  }

  get spec(): PlanSpec {
    return this.props.spec;
  }

  get status(): PlanVersionStatus {
    return this.props.status;
  }

  get scheduledPublishAt(): Date | undefined {
    return this.props.scheduledPublishAt;
  }
}
