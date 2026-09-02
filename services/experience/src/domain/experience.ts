import { AggregateRoot, BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { ExperienceTransitioned } from "./events/experience-transitioned.event";
import { ExperienceVersion } from "./experience-version";
import { Canvas } from "./value-objects/canvas";
import {
  canTransitionExperience,
  ExperienceStatus,
  type ExperienceStatusValue,
} from "./value-objects/experience-status";

interface ExperienceProps {
  readonly name: string;
  /** An open string — the same builder powers Storefront/Funnels/Landing/Blogs/Checkout/Account/Campaign pages without redesign. */
  readonly experienceType: string;
  canvas: Canvas;
  status: ExperienceStatus;
  readonly versions: ExperienceVersion[];
}

/** Source of truth for one experience's layout (Sprint 5.4) — owns layouts; references Components/Content/Theme only by ref. */
export class Experience extends AggregateRoot<ExperienceProps> {
  static create(id: UniqueEntityId, name: string, experienceType: string): Experience {
    return new Experience(
      {
        name,
        experienceType,
        canvas: Canvas.empty(),
        status: ExperienceStatus.draft(),
        versions: [],
      },
      id,
    );
  }

  static reconstitute(
    id: UniqueEntityId,
    name: string,
    experienceType: string,
    canvas: Canvas,
    status: ExperienceStatus,
    version: number,
    versions: readonly ExperienceVersion[] = [],
  ): Experience {
    return new Experience(
      { name, experienceType, canvas, status, versions: [...versions] },
      id,
      version,
    );
  }

  transition(toStatus: ExperienceStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionExperience(fromStatus, toStatus)) {
      throw new BusinessRuleError(
        `Cannot transition experience from "${fromStatus}" to "${toStatus}"`,
      );
    }
    this.props.status = ExperienceStatus.from(toStatus);
    if (toStatus === "published") {
      this.props.versions.push(
        ExperienceVersion.create(
          UniqueEntityId.from(this.id.toString() + this.props.versions.length),
          this.props.versions.length + 1,
          this.props.canvas,
          occurredAt,
        ),
      );
    }
    this.raise(toStatus, eventId, occurredAt);
  }

  publish(eventId: string, occurredAt: Date): void {
    this.transition("published", eventId, occurredAt);
  }

  archive(eventId: string, occurredAt: Date): void {
    this.transition("archived", eventId, occurredAt);
  }

  /** Replaces the draft canvas tree — the persisted resulting tree powers the (out-of-scope) visual builder client. */
  updateCanvas(canvas: Canvas): void {
    if (this.props.status.value === "archived") {
      throw new BusinessRuleError("Cannot edit an archived experience");
    }
    this.props.canvas = canvas;
  }

  private raise(action: string, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new ExperienceTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          name: this.props.name,
          action,
        },
      ),
    );
  }

  get name(): string {
    return this.props.name;
  }

  get experienceType(): string {
    return this.props.experienceType;
  }

  get canvas(): Canvas {
    return this.props.canvas;
  }

  get status(): ExperienceStatus {
    return this.props.status;
  }

  get versions(): readonly ExperienceVersion[] {
    return this.props.versions;
  }
}
