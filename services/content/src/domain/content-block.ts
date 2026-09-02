import { AggregateRoot, BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { ContentTransitioned } from "./events/content-transitioned.event";
import { ContentVersion } from "./content-version";
import type { BlockBody } from "./value-objects/block-body";
import {
  canTransitionContent,
  ContentStatus,
  type ContentStatusValue,
} from "./value-objects/content-status";

interface ContentBlockProps {
  readonly name: string;
  readonly blockType: string;
  body: BlockBody;
  readonly locale?: string;
  status: ContentStatus;
  scheduledAt?: Date;
  readonly versions: ContentVersion[];
}

/**
 * Source of truth for one reusable content block (Sprint 5.4) — versioned/scheduled/localized.
 * Decoupled from Catalog/Media: `body` references other contexts only by bare id, never embeds them.
 */
export class ContentBlock extends AggregateRoot<ContentBlockProps> {
  static create(
    id: UniqueEntityId,
    name: string,
    blockType: string,
    body: BlockBody,
    locale?: string,
  ): ContentBlock {
    return new ContentBlock(
      { name, blockType, body, locale, status: ContentStatus.draft(), versions: [] },
      id,
    );
  }

  /** Rebuilds a persisted content block exactly as stored — no domain events raised (ADR-0003, G-12). */
  static reconstitute(
    id: UniqueEntityId,
    name: string,
    blockType: string,
    body: BlockBody,
    status: ContentStatus,
    version: number,
    extra: {
      readonly locale?: string;
      readonly scheduledAt?: Date;
      readonly versions?: readonly ContentVersion[];
    } = {},
  ): ContentBlock {
    return new ContentBlock(
      {
        name,
        blockType,
        body,
        locale: extra.locale,
        status,
        scheduledAt: extra.scheduledAt,
        versions: extra.versions === undefined ? [] : [...extra.versions],
      },
      id,
      version,
    );
  }

  /** The generic, validated status transition — every named method below delegates to this. */
  transition(toStatus: ContentStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionContent(fromStatus, toStatus)) {
      throw new BusinessRuleError(
        `Cannot transition content block from "${fromStatus}" to "${toStatus}"`,
      );
    }
    this.props.status = ContentStatus.from(toStatus);
    if (toStatus === "published") {
      this.props.versions.push(
        ContentVersion.create(
          UniqueEntityId.from(this.id.toString() + this.props.versions.length),
          this.props.versions.length + 1,
          this.props.body,
          occurredAt,
        ),
      );
    }
    this.raise(toStatus, eventId, occurredAt);
  }

  schedule(scheduledAt: Date, eventId: string, occurredAt: Date): void {
    this.props.scheduledAt = scheduledAt;
    this.transition("scheduled", eventId, occurredAt);
  }

  publish(eventId: string, occurredAt: Date): void {
    this.transition("published", eventId, occurredAt);
  }

  archive(eventId: string, occurredAt: Date): void {
    this.transition("archived", eventId, occurredAt);
  }

  /** Updates the draft body — only permitted while not yet published (edits after publish create a new draft cycle via a future version, out of scope here). */
  updateBody(body: BlockBody): void {
    if (this.props.status.value === "archived") {
      throw new BusinessRuleError("Cannot edit an archived content block");
    }
    this.props.body = body;
  }

  private raise(action: string, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new ContentTransitioned(
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

  get blockType(): string {
    return this.props.blockType;
  }

  get body(): BlockBody {
    return this.props.body;
  }

  get locale(): string | undefined {
    return this.props.locale;
  }

  get status(): ContentStatus {
    return this.props.status;
  }

  get scheduledAt(): Date | undefined {
    return this.props.scheduledAt;
  }

  /** The append-only published-version history (persisted verbatim). */
  get versions(): readonly ContentVersion[] {
    return this.props.versions;
  }
}
