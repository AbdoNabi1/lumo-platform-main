import { Entity, type UniqueEntityId } from "@platform/domain";
import type { BlockBody } from "./value-objects/block-body";

interface ContentVersionProps {
  readonly versionNumber: number;
  readonly body: BlockBody;
  readonly publishedAt: Date;
}

/** An append-only published-version snapshot of a content block (never rewritten). */
export class ContentVersion extends Entity<ContentVersionProps> {
  static create(
    id: UniqueEntityId,
    versionNumber: number,
    body: BlockBody,
    publishedAt: Date,
  ): ContentVersion {
    return new ContentVersion({ versionNumber, body, publishedAt }, id);
  }

  get versionNumber(): number {
    return this.props.versionNumber;
  }

  get body(): BlockBody {
    return this.props.body;
  }

  get publishedAt(): Date {
    return this.props.publishedAt;
  }
}
