import { AggregateRoot, type UniqueEntityId } from "@platform/domain";
import { MediaAssetReady } from "./events/media-asset-ready.event";
import type { ContentType } from "./value-objects/content-type";
import type { StorageKey } from "./value-objects/storage-key";

interface AssetProps {
  readonly storageKey: StorageKey;
  readonly contentType: ContentType;
}

/** Media asset aggregate (thin — metadata only; the binary lives in object storage). */
export class Asset extends AggregateRoot<AssetProps> {
  static register(
    id: UniqueEntityId,
    storageKey: StorageKey,
    contentType: ContentType,
    eventId: string,
    occurredAt: Date,
  ): Asset {
    const asset = new Asset({ storageKey, contentType }, id);
    asset.addDomainEvent(
      new MediaAssetReady(
        { eventId, aggregateId: id, occurredAt },
        { storageKey: storageKey.value, contentType: contentType.value },
      ),
    );
    return asset;
  }

  /**
   * Rebuilds a persisted asset exactly as stored - no domain events raised, persisted `version`
   * carried for optimistic locking (ADR-0003, G-12).
   */
  static reconstitute(
    id: UniqueEntityId,
    storageKey: StorageKey,
    contentType: ContentType,
    version: number,
  ): Asset {
    return new Asset({ storageKey, contentType }, id, version);
  }

  get storageKey(): StorageKey {
    return this.props.storageKey;
  }

  get contentType(): ContentType {
    return this.props.contentType;
  }
}
