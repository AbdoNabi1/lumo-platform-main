import { AggregateRoot, type UniqueEntityId } from "@platform/domain";
import { SeoChanged } from "./events/seo-changed.event";
import type { RedirectStatusCode } from "./value-objects/seo";

interface RedirectProps {
  readonly fromPath: string;
  toPath: string;
  statusCode: RedirectStatusCode;
  active: boolean;
}

/** A URL redirect rule. */
export class Redirect extends AggregateRoot<RedirectProps> {
  static create(
    id: UniqueEntityId,
    fromPath: string,
    toPath: string,
    statusCode: RedirectStatusCode,
    eventId: string,
    occurredAt: Date,
  ): Redirect {
    const redirect = new Redirect({ fromPath, toPath, statusCode, active: true }, id);
    redirect.raise("created", eventId, occurredAt);
    return redirect;
  }

  static reconstitute(
    id: UniqueEntityId,
    fromPath: string,
    toPath: string,
    statusCode: RedirectStatusCode,
    active: boolean,
    version: number,
  ): Redirect {
    return new Redirect({ fromPath, toPath, statusCode, active }, id, version);
  }

  update(toPath: string, statusCode: RedirectStatusCode, eventId: string, occurredAt: Date): void {
    this.props.toPath = toPath;
    this.props.statusCode = statusCode;
    this.raise("updated", eventId, occurredAt);
  }

  deactivate(eventId: string, occurredAt: Date): void {
    this.props.active = false;
    this.raise("updated", eventId, occurredAt);
  }

  private raise(
    action: "created" | "updated" | "deleted",
    eventId: string,
    occurredAt: Date,
  ): void {
    this.addDomainEvent(
      new SeoChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          ref: this.props.fromPath,
          entityType: "redirect",
          action,
        },
      ),
    );
  }

  get fromPath(): string {
    return this.props.fromPath;
  }

  get toPath(): string {
    return this.props.toPath;
  }

  get statusCode(): RedirectStatusCode {
    return this.props.statusCode;
  }

  get active(): boolean {
    return this.props.active;
  }
}
