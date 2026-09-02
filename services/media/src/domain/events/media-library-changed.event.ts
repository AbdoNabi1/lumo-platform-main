import { DomainEvent, type DomainEventProps } from "@platform/domain";

export type MediaLibraryEntityType = "folder" | "media_asset";

export interface MediaLibraryChangedData {
  readonly ref: string;
  readonly entityType: MediaLibraryEntityType;
  readonly action: "created" | "archived";
}

/** Raised whenever a {@link Folder} or {@link MediaAsset} changes (Sprint 5.4). The translator maps this to `media.<entityType>.<action>`. */
export class MediaLibraryChanged extends DomainEvent {
  readonly eventName = "media.library_changed";
  readonly data: MediaLibraryChangedData;

  constructor(props: DomainEventProps, data: MediaLibraryChangedData) {
    super(props);
    this.data = data;
  }
}
