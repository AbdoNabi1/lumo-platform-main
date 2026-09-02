import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { PagesTransitioned } from "./events/pages-transitioned.event";

export type TemplateStatusValue = "active" | "archived";

interface TemplateProps {
  readonly name: string;
  readonly experienceRef: string;
  status: TemplateStatusValue;
}

/** A reusable template — binds an Experience layout for reuse across pages. */
export class Template extends AggregateRoot<TemplateProps> {
  static create(id: UniqueEntityId, name: string, experienceRef: string): Template {
    return new Template({ name, experienceRef, status: "active" }, id);
  }

  static reconstitute(
    id: UniqueEntityId,
    name: string,
    experienceRef: string,
    status: TemplateStatusValue,
    version: number,
  ): Template {
    return new Template({ name, experienceRef, status }, id, version);
  }

  archive(eventId: string, occurredAt: Date): void {
    if (this.props.status === "archived") {
      throw new BusinessRuleError("Template is already archived");
    }
    this.props.status = "archived";
    this.addDomainEvent(
      new PagesTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          ref: this.props.name,
          family: "template",
          action: "archived",
        },
      ),
    );
  }

  get name(): string {
    return this.props.name;
  }

  get experienceRef(): string {
    return this.props.experienceRef;
  }

  get status(): TemplateStatusValue {
    return this.props.status;
  }
}
