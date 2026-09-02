import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { PagesTransitioned } from "./events/pages-transitioned.event";
import type { RoutePath } from "./value-objects/route-path";

export type PageStatusValue = "draft" | "published" | "archived";

const TRANSITIONS: Readonly<Record<PageStatusValue, readonly PageStatusValue[]>> = {
  draft: ["published", "archived"],
  published: ["archived"],
  archived: [],
};

interface PageProps {
  readonly name: string;
  readonly routePath: RoutePath;
  readonly templateRef?: string;
  readonly experienceRef?: string;
  readonly seoProfileRef?: string;
  readonly localeRef?: string;
  status: PageStatusValue;
}

/**
 * Source of truth for one page's routing (Sprint 5.4) — binds Experience/SEO/Theme/Locale by ref,
 * never duplicates content.
 */
export class Page extends AggregateRoot<PageProps> {
  static create(
    id: UniqueEntityId,
    name: string,
    routePath: RoutePath,
    extra: {
      readonly templateRef?: string;
      readonly experienceRef?: string;
      readonly seoProfileRef?: string;
      readonly localeRef?: string;
    } = {},
  ): Page {
    return new Page({ name, routePath, status: "draft", ...extra }, id);
  }

  static reconstitute(
    id: UniqueEntityId,
    name: string,
    routePath: RoutePath,
    status: PageStatusValue,
    version: number,
    extra: {
      readonly templateRef?: string;
      readonly experienceRef?: string;
      readonly seoProfileRef?: string;
      readonly localeRef?: string;
    } = {},
  ): Page {
    return new Page({ name, routePath, status, ...extra }, id, version);
  }

  transition(toStatus: PageStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status;
    if (!TRANSITIONS[fromStatus].includes(toStatus)) {
      throw new BusinessRuleError(`Cannot transition page from "${fromStatus}" to "${toStatus}"`);
    }
    this.props.status = toStatus;
    this.addDomainEvent(
      new PagesTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          ref: this.props.routePath.value,
          family: "page",
          action: toStatus,
        },
      ),
    );
  }

  publish(eventId: string, occurredAt: Date): void {
    this.transition("published", eventId, occurredAt);
  }

  archive(eventId: string, occurredAt: Date): void {
    this.transition("archived", eventId, occurredAt);
  }

  get name(): string {
    return this.props.name;
  }

  get routePath(): RoutePath {
    return this.props.routePath;
  }

  get templateRef(): string | undefined {
    return this.props.templateRef;
  }

  get experienceRef(): string | undefined {
    return this.props.experienceRef;
  }

  get seoProfileRef(): string | undefined {
    return this.props.seoProfileRef;
  }

  get localeRef(): string | undefined {
    return this.props.localeRef;
  }

  get status(): PageStatusValue {
    return this.props.status;
  }
}
