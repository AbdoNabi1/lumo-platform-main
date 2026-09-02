import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ExperienceTransitionedData {
  readonly name: string;
  readonly action: string;
}

/** Raised on every experience lifecycle transition (Sprint 5.4). The translator maps this to `experience.experience.<action>`. */
export class ExperienceTransitioned extends DomainEvent {
  readonly eventName = "experience.transitioned";
  readonly data: ExperienceTransitionedData;

  constructor(props: DomainEventProps, data: ExperienceTransitionedData) {
    super(props);
    this.data = data;
  }
}
