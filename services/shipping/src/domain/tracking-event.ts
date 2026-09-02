import { Entity, type UniqueEntityId } from "@platform/domain";

interface TrackingEventProps {
  readonly description: string;
  readonly location?: string;
  readonly occurredAt: Date;
}

/** One append-only carrier tracking scan — the shipment's full tracking history, never rewritten. */
export class TrackingEvent extends Entity<TrackingEventProps> {
  static create(
    id: UniqueEntityId,
    description: string,
    occurredAt: Date,
    location?: string,
  ): TrackingEvent {
    return new TrackingEvent({ description, location, occurredAt }, id);
  }

  get description(): string {
    return this.props.description;
  }

  get location(): string | undefined {
    return this.props.location;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
