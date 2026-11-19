import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import type { LocalizedText } from "@platform/storefront-content";
import { pageArchived } from "./errors";
import { PagesTransitioned } from "./events/pages-transitioned.event";
import { EMPTY_PAGE_CONTENT, type PageContent } from "./page-content";
import type { RoutePath } from "./value-objects/route-path";

export type PageStatusValue = "draft" | "published" | "archived";

const TRANSITIONS: Readonly<Record<PageStatusValue, readonly PageStatusValue[]>> = {
  draft: ["published", "archived"],
  published: ["draft", "archived"],
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
  content: PageContent;
  publishedAt: Date | null;
  updatedAt: Date | null;
}

interface PageRefs {
  readonly templateRef?: string;
  readonly experienceRef?: string;
  readonly seoProfileRef?: string;
  readonly localeRef?: string;
}

interface PageState {
  readonly content: PageContent;
  readonly publishedAt: Date | null;
  readonly updatedAt: Date | null;
}

const EMPTY_STATE: PageState = { content: EMPTY_PAGE_CONTENT, publishedAt: null, updatedAt: null };

/**
 * Source of truth for one page's routing (Sprint 5.4) and, from Online Store Part 2, its merchant
 * text (title, body, meta description per locale). Binds Experience/SEO/Theme/Locale by ref.
 */
export class Page extends AggregateRoot<PageProps> {
  static create(
    id: UniqueEntityId,
    name: string,
    routePath: RoutePath,
    extra: PageRefs = {},
    content: PageContent = EMPTY_PAGE_CONTENT,
    now: Date | null = null,
  ): Page {
    return new Page(
      { name, routePath, status: "draft", ...extra, content, publishedAt: null, updatedAt: now },
      id,
    );
  }

  static reconstitute(
    id: UniqueEntityId,
    name: string,
    routePath: RoutePath,
    status: PageStatusValue,
    version: number,
    extra: PageRefs = {},
    state: PageState = EMPTY_STATE,
  ): Page {
    return new Page(
      {
        name,
        routePath,
        status,
        ...extra,
        content: state.content,
        publishedAt: state.publishedAt,
        updatedAt: state.updatedAt,
      },
      id,
      version,
    );
  }

  transition(toStatus: PageStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status;
    if (!TRANSITIONS[fromStatus].includes(toStatus)) {
      throw new BusinessRuleError(
        `INVALID_TRANSITION: Cannot transition page from "${fromStatus}" to "${toStatus}"`,
      );
    }
    this.props.status = toStatus;
    // Ruling 15: the first publish date survives an unpublish and a republish.
    if (toStatus === "published" && this.props.publishedAt === null) {
      this.props.publishedAt = occurredAt;
    }
    this.props.updatedAt = occurredAt;
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

  /** Replaces the page's text. Draft and published pages only; an archived page is terminal. */
  updateContent(content: PageContent, now: Date): void {
    if (this.props.status === "archived") throw pageArchived();
    this.props.content = content;
    this.props.updatedAt = now;
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

  get title(): LocalizedText {
    return this.props.content.title;
  }

  get body(): LocalizedText {
    return this.props.content.body;
  }

  get metaDescription(): LocalizedText {
    return this.props.content.metaDescription;
  }

  get publishedAt(): Date | null {
    return this.props.publishedAt;
  }

  get updatedAt(): Date | null {
    return this.props.updatedAt;
  }
}
