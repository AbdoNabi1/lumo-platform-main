import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface MediaAssetReadyData {
  readonly storageKey: string;
  readonly contentType: string;
}

/** Raised when an asset's metadata is registered and the asset is ready to be referenced. */
export class MediaAssetReady extends DomainEvent {
  readonly eventName = "media.asset_ready";
  readonly data: MediaAssetReadyData;

  constructor(props: DomainEventProps, data: MediaAssetReadyData) {
    super(props);
    this.data = data;
  }
}
