import type { Prisma } from "@prisma/client";
import type { TransactionClient } from "@platform/db";
import {
  UNEXPECTED_UNIQUE_CONFLICT,
  type FetchedTemplate,
  type TemplateCategoryValue,
  type TemplateEventResult,
  type TemplateFetchResult,
  type TemplateRecord,
  type TemplateRepository,
  type TemplateSnapshotResult,
  type TemplateStatus,
} from "../domain/repositories";
import {
  applyCategoryEventTo,
  applyFetchedTo,
  applyStatusEventTo,
  reconcileSnapshotTo,
  type TemplatePatch,
  type TemplateRowAccess,
} from "../domain/template-reconcile";
import { templateFromRow, templateInsertRow, toInputJson } from "./prisma-outreach-mappers";
import { withClient, type PrismaOutreachDeps } from "./prisma-outreach-repositories";

/** The Prisma `data` for a template patch. Only the keys the patch sets are written. */
export function templatePatchData(
  patch: TemplatePatch,
): Prisma.MessageTemplateUpdateManyMutationInput {
  return {
    ...(patch.metaTemplateId === undefined ? {} : { metaTemplateId: patch.metaTemplateId }),
    ...(patch.category === undefined ? {} : { category: patch.category }),
    ...(patch.components === undefined ? {} : { components: toInputJson(patch.components) }),
    ...(patch.status === undefined ? {} : { status: patch.status }),
    ...(patch.rejectedReason === undefined ? {} : { rejectedReason: patch.rejectedReason }),
    ...(patch.qualityScore === undefined ? {} : { qualityScore: patch.qualityScore }),
    ...(patch.lastSyncedAt === undefined ? {} : { lastSyncedAt: patch.lastSyncedAt }),
    ...(patch.statusEventAt === undefined ? {} : { statusEventAt: patch.statusEventAt }),
    ...(patch.categoryEventAt === undefined ? {} : { categoryEventAt: patch.categoryEventAt }),
    ...(patch.reconciledAt === undefined ? {} : { reconciledAt: patch.reconciledAt }),
  };
}

export class PrismaTemplateRepository implements TemplateRepository {
  constructor(private readonly deps: PrismaOutreachDeps) {}

  /** Row access for ONE tenant + WABA inside `client`; every `where` names the tenant and the WABA. */
  private access(client: TransactionClient, tenantId: string, wabaId: string): TemplateRowAccess {
    return {
      list: async () => {
        const rows = await client.messageTemplate.findMany({
          where: { tenantId, wabaId },
          orderBy: [{ name: "asc" }, { language: "asc" }],
        });
        return rows.map(templateFromRow);
      },
      findByMetaId: async (metaTemplateId) => {
        const row = await client.messageTemplate.findFirst({
          where: { tenantId, wabaId, metaTemplateId },
        });
        return row === null ? null : templateFromRow(row);
      },
      insert: async (row) => {
        const created = await client.messageTemplate.createMany({
          data: [templateInsertRow(row)],
          skipDuplicates: true,
        });
        return created.count > 0;
      },
      update: async (current, patch) => {
        // CAS on the revision: any write that landed since `current` was read makes this a miss.
        const updated = await client.messageTemplate.updateMany({
          where: { tenantId, wabaId, id: current.id, revision: current.revision },
          data: {
            ...templatePatchData(patch),
            revision: { increment: 1 },
            version: { increment: 1 },
          },
        });
        return updated.count > 0;
      },
    };
  }

  private async run<T>(
    tenantId: string,
    wabaId: string,
    tx: unknown,
    work: (access: TemplateRowAccess) => Promise<T>,
  ): Promise<T> {
    return withClient(this.deps.prisma, tenantId, tx, (client) =>
      work(this.access(client, tenantId, wabaId)),
    );
  }

  list(tenantId: string, wabaId: string, tx?: unknown): Promise<TemplateRecord[]> {
    return this.run(tenantId, wabaId, tx, (a) => a.list());
  }

  findByNameLanguage(
    tenantId: string,
    wabaId: string,
    name: string,
    language: string,
    tx?: unknown,
  ): Promise<TemplateRecord | null> {
    return withClient(this.deps.prisma, tenantId, tx, async (c) => {
      const row = await c.messageTemplate.findFirst({
        where: { tenantId, wabaId, name, language },
      });
      return row === null ? null : templateFromRow(row);
    });
  }

  findByProviderId(
    tenantId: string,
    wabaId: string,
    metaTemplateId: string,
    tx?: unknown,
  ): Promise<TemplateRecord | null> {
    return this.run(tenantId, wabaId, tx, (a) => a.findByMetaId(metaTemplateId));
  }

  insert(r: TemplateRecord, tx?: unknown): Promise<"inserted" | "duplicate"> {
    return withClient(this.deps.prisma, r.tenantId, tx, async (c) => {
      const created = await c.messageTemplate.createMany({
        data: [templateInsertRow(r)],
        skipDuplicates: true,
      });
      if (created.count > 0) return "inserted";
      const replay = await c.messageTemplate.findFirst({
        where: { tenantId: r.tenantId, wabaId: r.wabaId, name: r.name, language: r.language },
      });
      if (replay !== null) return "duplicate";
      throw new Error(UNEXPECTED_UNIQUE_CONFLICT);
    });
  }

  replaceSnapshot(
    tenantId: string,
    wabaId: string,
    rows: FetchedTemplate[],
    fetch: { revisionsAtFetchStart: ReadonlyMap<string, number>; fetchStartedAt: Date },
    tx?: unknown,
  ): Promise<TemplateSnapshotResult> {
    return this.run(tenantId, wabaId, tx, (a) =>
      reconcileSnapshotTo(a, { tenantId, wabaId }, rows, fetch),
    );
  }

  applyFetched(
    tenantId: string,
    wabaId: string,
    row: FetchedTemplate,
    fetch: { revisionAtFetchStart: number; fetchStartedAt: Date },
    tx?: unknown,
  ): Promise<TemplateFetchResult> {
    return this.run(tenantId, wabaId, tx, (a) => applyFetchedTo(a, row, fetch));
  }

  applyStatusEvent(
    tenantId: string,
    wabaId: string,
    metaTemplateId: string,
    event: { status: TemplateStatus; reason: string | null; eventAt: Date },
    tx?: unknown,
  ): Promise<TemplateEventResult> {
    return this.run(tenantId, wabaId, tx, (a) => applyStatusEventTo(a, metaTemplateId, event));
  }

  applyCategoryEvent(
    tenantId: string,
    wabaId: string,
    metaTemplateId: string,
    event: { category: TemplateCategoryValue; eventAt: Date },
    tx?: unknown,
  ): Promise<TemplateEventResult> {
    return this.run(tenantId, wabaId, tx, (a) => applyCategoryEventTo(a, metaTemplateId, event));
  }

  async markDeletedByName(
    tenantId: string,
    wabaId: string,
    name: string,
    tx?: unknown,
  ): Promise<void> {
    await withClient(this.deps.prisma, tenantId, tx, async (c) => {
      await c.messageTemplate.updateMany({
        where: { tenantId, wabaId, name, status: { not: "DELETED" } },
        data: { status: "DELETED", revision: { increment: 1 }, version: { increment: 1 } },
      });
    });
  }
}
