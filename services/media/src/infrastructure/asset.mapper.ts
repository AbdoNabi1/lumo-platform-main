import { UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { UnexpectedError } from "@platform/utils";
import { Asset } from "../domain/asset";
import { ContentType } from "../domain/value-objects/content-type";
import { StorageKey } from "../domain/value-objects/storage-key";

export interface AssetRow {
  readonly id: string;
  readonly storageKey: string;
  readonly contentType: string;
  readonly version: number;
}

function must<T>(result: Result<T, { message: string }>, what: string): T {
  if (!result.ok) {
    throw new UnexpectedError(`Corrupt media row: invalid ${what} (${result.error.message})`);
  }
  return result.value;
}

/** Persistence ↔ aggregate mapping for {@link Asset}. Mapping only — no I/O. */
export class AssetMapper {
  static toDomain(row: AssetRow): Asset {
    return Asset.reconstitute(
      UniqueEntityId.from(row.id),
      must(StorageKey.create(row.storageKey), "storage key"),
      must(ContentType.create(row.contentType), "content type"),
      row.version,
    );
  }

  static toRow(asset: Asset, tenantId: string) {
    return {
      id: asset.id.toString(),
      tenantId,
      storageKey: asset.storageKey.value,
      contentType: asset.contentType.value,
      status: "ready",
      version: 1,
    };
  }
}
