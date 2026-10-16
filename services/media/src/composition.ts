import type { Clock, IdGenerator } from "@platform/contracts";
import type { EventSerializer } from "@platform/domain-events";
import {
  InMemoryEventBus,
  InMemoryEventPublisher,
  InMemoryOutboxStore,
  OutboxRelay,
  OutboxWriter,
  rootEventContext,
  type Subscriber,
} from "@platform/messaging";
import { RegisterAsset } from "./application/register-asset.use-case";
import { InMemoryAssetRepository } from "./infrastructure/in-memory-asset-repository";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { MediaEventTranslator } from "./infrastructure/media-event-translator";
import { TenantPrefixedKeyPolicy } from "./infrastructure/tenant-prefixed-key-policy";
import { AssetController } from "./interfaces/asset.controller";

export interface MediaWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface WiredMedia {
  readonly assets: AssetController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Composition root for the Media context — wires the slice with in-memory adapters. */
export function wireMedia(deps: MediaWiringDeps): WiredMedia {
  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new MediaEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "media",
  });
  const context = rootEventContext(deps.idGenerator);

  const assets = new InMemoryAssetRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = new AssetController(
    new RegisterAsset({
      assets,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
      keyPolicy: new TenantPrefixedKeyPolicy(),
    }),
  );

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  bus.subscribe("media.asset.ready.v1", sink);

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    assets: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
