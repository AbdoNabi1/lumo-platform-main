import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { MediaLibraryChanged } from "./events/media-library-changed.event";
import { LibraryEntryStatus } from "./value-objects/library";

interface MediaAssetProps {
  readonly name: string;
  readonly storageKey: string;
  readonly folderRef?: string;
  status: LibraryEntryStatus;
}

/**
 * A media asset organized in the library (Sprint 5.4) — asset organization over object storage.
 * Reuses `@platform/storage` (via `ObjectStoragePort`), never stores files itself. `storageKey` is
 * a bare reference; existence is verified by the application layer before this is constructed.
 */
export class MediaAsset extends AggregateRoot<MediaAssetProps> {
  static create(
    id: UniqueEntityId,
    name: string,
    storageKey: string,
    eventId: string,
    occurredAt: Date,
    folderRef?: string,
  ): MediaAsset {
    const asset = new MediaAsset(
      { name, storageKey, folderRef, status: LibraryEntryStatus.active() },
      id,
    );
    asset.raise("created", eventId, occurredAt);
    return asset;
  }

  static reconstitute(
    id: UniqueEntityId,
    name: string,
    storageKey: string,
    status: LibraryEntryStatus,
    version: number,
    folderRef?: string,
  ): MediaAsset {
    return new MediaAsset({ name, storageKey, folderRef, status }, id, version);
  }

  archive(eventId: string, occurredAt: Date): void {
    if (this.props.status.value === "archived") {
      throw new BusinessRuleError("Media asset is already archived");
    }
    this.props.status = LibraryEntryStatus.from("archived");
    this.raise("archived", eventId, occurredAt);
  }

  private raise(action: "created" | "archived", eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new MediaLibraryChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          ref: this.props.storageKey,
          entityType: "media_asset",
          action,
        },
      ),
    );
  }

  get name(): string {
    return this.props.name;
  }

  get storageKey(): string {
    return this.props.storageKey;
  }

  get folderRef(): string | undefined {
    return this.props.folderRef;
  }

  get status(): LibraryEntryStatus {
    return this.props.status;
  }
}
