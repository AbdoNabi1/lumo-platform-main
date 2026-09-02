import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork, type Database } from "@platform/db";
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
import type { TransactionalUnitOfWork } from "@platform/repository";
import { GetFolder } from "./application/get-folder.use-case";
import { GetMediaAsset } from "./application/get-media-asset.use-case";
import { ListFolders } from "./application/list-folders.use-case";
import { ListMediaAssets } from "./application/list-media-assets.use-case";
import {
  ArchiveFolder,
  ArchiveMediaAsset,
  CreateFolder,
  GetDownloadUrl,
  RegisterMediaAsset,
} from "./application/media-library.use-cases";
import type { ObjectStoragePort } from "./application/object-storage.port";
import type { FolderRepository, MediaAssetRepository } from "./domain/library-repositories";
import {
  InMemoryFolderRepository,
  InMemoryMediaAssetRepository,
} from "./infrastructure/in-memory-library-repositories";
import { InMemoryObjectStorage } from "./infrastructure/object-storage-adapters";
import {
  MEDIA_LIBRARY_PUBLISHED_EVENTS,
  MediaLibraryEventTranslator,
} from "./infrastructure/media-library-event-translator";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  PrismaFolderRepository,
  PrismaMediaAssetRepository,
} from "./infrastructure/prisma-library-repositories";
import { MediaLibraryController } from "./interfaces/media-library.controller";

export interface MediaLibraryWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly objectStorage?: ObjectStoragePort;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaFolderRepository` +
   * `PrismaMediaAssetRepository` + `PrismaUnitOfWork` (same `prisma?`/`tenantId?`-presence
   * convention as `wireOrders`/`wirePages`); absent ⇒ in-memory, unchanged. `wireMedia` (the
   * Phase-1 Asset slice) is a separate, unrelated composition function never called by
   * `apps/admin` — out of scope here, same "not part of the production graph" exclusion.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Media Library table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredMediaLibrary {
  readonly mediaLibrary: MediaLibraryController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

interface MediaLibraryRepos {
  readonly folders: FolderRepository;
  readonly mediaAssets: MediaAssetRepository;
}

/** Builds the `MediaLibraryController` from an already-wired repo set — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  repos: MediaLibraryRepos,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: MediaLibraryWiringDeps,
): MediaLibraryController {
  const objectStorage = deps.objectStorage ?? new InMemoryObjectStorage();
  const libraryDeps = {
    ...repos,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };

  return new MediaLibraryController({
    createFolder: new CreateFolder(libraryDeps),
    archiveFolder: new ArchiveFolder(libraryDeps),
    registerMediaAsset: new RegisterMediaAsset({ ...libraryDeps, objectStorage }),
    archiveMediaAsset: new ArchiveMediaAsset(libraryDeps),
    getDownloadUrl: new GetDownloadUrl({ ...libraryDeps, objectStorage }),
    listFolders: new ListFolders({ folders: repos.folders }),
    getFolder: new GetFolder({ folders: repos.folders }),
    listMediaAssets: new ListMediaAssets({ mediaAssets: repos.mediaAssets }),
    getMediaAsset: new GetMediaAsset({ mediaAssets: repos.mediaAssets }),
  });
}

/**
 * Composition root for the Media Library extension (Sprint 5.4) — a separate wiring function from
 * `wireMedia` (the Phase-1 Asset slice), matching the dirty tree's own additive split; neither
 * touches the other's persistence or outbox. Prisma slice (both repositories +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wireMediaLibrary(deps: MediaLibraryWiringDeps): WiredMediaLibrary {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireMediaLibrary: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new MediaLibraryEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "media",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const libraryDeps = { prisma: deps.prisma, tenantId, outbox, context };
    const repos: MediaLibraryRepos = {
      folders: new PrismaFolderRepository(libraryDeps),
      mediaAssets: new PrismaMediaAssetRepository(libraryDeps),
    };
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      mediaLibrary: buildController(repos, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new MediaLibraryEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "media",
  });
  const context = rootEventContext(deps.idGenerator);

  const repos: MediaLibraryRepos = {
    folders: new InMemoryFolderRepository({ outbox: outboxWriter, context }),
    mediaAssets: new InMemoryMediaAssetRepository({ outbox: outboxWriter, context }),
  };
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(repos, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of MEDIA_LIBRARY_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    mediaLibrary: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
