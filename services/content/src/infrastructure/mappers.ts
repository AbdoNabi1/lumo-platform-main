import { UniqueEntityId } from "@platform/domain";
import { ContentBlock } from "../domain/content-block";
import { ContentVersion } from "../domain/content-version";
import { BlockBody, type BlockBodyFormat } from "../domain/value-objects/block-body";
import { ContentStatus, type ContentStatusValue } from "../domain/value-objects/content-status";

export interface ContentVersionJson {
  readonly id: string;
  readonly versionNumber: number;
  readonly format: BlockBodyFormat;
  readonly content: string;
  readonly publishedAt: string;
}

export interface ContentBlockRow {
  readonly id: string;
  readonly name: string;
  readonly blockType: string;
  readonly format: BlockBodyFormat;
  readonly content: string;
  readonly locale: string | null;
  readonly status: string;
  readonly scheduledAt: Date | null;
  readonly versions: readonly ContentVersionJson[];
  readonly version: number;
}

/** Persistence ↔ aggregate mapping for {@link ContentBlock}. Mapping only — no I/O. */
export class ContentBlockMapper {
  static toDomain(row: ContentBlockRow): ContentBlock {
    return ContentBlock.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      row.blockType,
      BlockBody.create(row.format, row.content),
      ContentStatus.from(row.status as ContentStatusValue),
      row.version,
      {
        locale: row.locale ?? undefined,
        scheduledAt: row.scheduledAt ?? undefined,
        versions: row.versions.map((v) =>
          ContentVersion.create(
            UniqueEntityId.from(v.id),
            v.versionNumber,
            BlockBody.create(v.format, v.content),
            new Date(v.publishedAt),
          ),
        ),
      },
    );
  }

  static toRow(block: ContentBlock, tenantId: string) {
    return {
      id: block.id.toString(),
      tenantId,
      name: block.name,
      blockType: block.blockType,
      format: block.body.format,
      content: block.body.content,
      locale: block.locale ?? null,
      status: block.status.value,
      scheduledAt: block.scheduledAt ?? null,
      versions: block.versions.map((v) => ({
        id: v.id.toString(),
        versionNumber: v.versionNumber,
        format: v.body.format,
        content: v.body.content,
        publishedAt: v.publishedAt.toISOString(),
      })),
      version: 1,
    };
  }
}
