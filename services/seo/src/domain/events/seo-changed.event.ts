import { DomainEvent, type DomainEventProps } from "@platform/domain";

export type SeoEntityType = "profile" | "redirect" | "sitemap" | "robots_policy";

export interface SeoChangedData {
  readonly ref: string;
  readonly entityType: SeoEntityType;
  readonly action: "created" | "updated" | "deleted";
}

/**
 * Raised whenever any of the four SEO aggregates changes (Sprint 5.4) — a generic change event
 * (not a transition-table event, since none of `SeoProfile`/`Redirect`/`Sitemap`/`RobotsPolicy` are
 * multi-state workflows in the report's own text; they are metadata records). The translator maps
 * this to `seo.<entityType>.<action>`.
 */
export class SeoChanged extends DomainEvent {
  readonly eventName = "seo.changed";
  readonly data: SeoChangedData;

  constructor(props: DomainEventProps, data: SeoChangedData) {
    super(props);
    this.data = data;
  }
}
