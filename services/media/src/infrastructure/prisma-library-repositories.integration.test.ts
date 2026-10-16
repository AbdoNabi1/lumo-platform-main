import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { Folder } from "../domain/folder";
import { MediaAsset } from "../domain/media-asset";
import { MediaLibraryEventTranslator } from "./media-library-event-translator";
import { PrismaFolderRepository, PrismaMediaAssetRepository } from "./prisma-library-repositories";

/**
 * Phase 4 T4.14 — real PostgreSQL coverage for the new `list` reads (both Folder and MediaAsset),
 * following the same reference pattern as
 * `services/reviews/src/infrastructure/prisma-review-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/media test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("Prisma Media Library repositories (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new MediaLibraryEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "media",
    });
    const context = rootEventContext(ids, tenantId);
    const folders = new PrismaFolderRepository({ prisma, outbox, context });
    const mediaAssets = new PrismaMediaAssetRepository({ prisma, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(prisma);
    return {
      prisma,
      folders,
      mediaAssets,
      saveFolder: (f: Folder) => unitOfWork.run((tx) => folders.save(f, tenantId, tx)),
      saveAsset: (a: MediaAsset) => unitOfWork.run((tx) => mediaAssets.save(a, tenantId, tx)),
    };
  }

  it("PrismaFolderRepository.list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-folders-${crypto.randomUUID()}`;
    const { prisma, folders, saveFolder } = wire(tenantId);
    for (let i = 0; i < 3; i += 1) {
      await saveFolder(
        Folder.create(
          UniqueEntityId.from(ids.generate()),
          `folder-${i}`,
          ids.generate(),
          clock.now(),
        ),
      );
    }
    const page = await folders.list({ first: 2 }, tenantId);
    expect(page.items).toHaveLength(2);
    expect(page.pageInfo.hasNextPage).toBe(true);
    await prisma.$disconnect();
  });

  it("PrismaMediaAssetRepository.list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-media-assets-${crypto.randomUUID()}`;
    const { prisma, mediaAssets, saveAsset } = wire(tenantId);
    await saveAsset(
      MediaAsset.create(
        UniqueEntityId.from(ids.generate()),
        "hero.png",
        "media/hero.png",
        ids.generate(),
        clock.now(),
      ),
    );
    const page = await mediaAssets.list({ first: 10 }, tenantId);
    expect(page.items).toHaveLength(1);
    await prisma.$disconnect();
  });

  it("does not let tenant A read tenant B's folder through a SINGLE shared repository instance (ADR-0014, WP-10 T10.5)", async () => {
    const tenantA = `tenant-itest-folders-a-${crypto.randomUUID()}`;
    const tenantB = `tenant-itest-folders-b-${crypto.randomUUID()}`;
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new MediaLibraryEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "media",
    });
    const context = rootEventContext(ids, tenantA);
    const folders = new PrismaFolderRepository({ prisma, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(prisma);

    const folder = Folder.create(
      UniqueEntityId.from(ids.generate()),
      "tenant-a-folder",
      ids.generate(),
      clock.now(),
    );
    await unitOfWork.run((tx) => folders.save(folder, tenantA, tx));

    expect(await folders.findById(folder.id.toString(), tenantA)).not.toBeNull();
    expect(await folders.findById(folder.id.toString(), tenantB)).toBeNull();

    await prisma.$disconnect();
  });
});
