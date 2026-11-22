import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import {
  toMetaComponents,
  validateTemplateDraft,
  type TemplateDraft,
} from "../domain/message-template";
import type { FetchedTemplate, TemplateRecord, TemplateStatusChange } from "../domain/repositories";
import { type TemplateDto, templateDto } from "./dto";
import type { OutreachDeps } from "./outreach-deps";
import { conflict, emit, isMetaError, metaConflictCode } from "./support";
import {
  connectionUnchanged,
  fetchedFromMeta,
  loadActiveConnection,
  normalizeLanguage,
  normalizeTemplateCategory,
  normalizeTemplateStatus,
} from "./template-support";

export interface TenantInput {
  tenantId: string;
}

async function emitTemplateChange(
  deps: OutreachDeps,
  tx: unknown,
  tenantId: string,
  wabaId: string,
  c: TemplateStatusChange,
): Promise<void> {
  // The aggregate id is the stable local row id for every producer (create, sync, webhook, freshness).
  await emit(deps, tx, tenantId, "outreach.template.status_changed", c.id, {
    wabaId,
    metaTemplateId: c.metaTemplateId,
    name: c.name,
    language: c.language,
    from: c.from,
    to: c.to,
    category: c.category,
  });
}

/** Runs a Meta call, mapping an adapter failure to `META_<code>` (and nothing else: provider text never escapes). */
async function metaGuard<T>(call: () => Promise<T>): Promise<Result<T, DomainError>> {
  try {
    return ok(await call());
  } catch (error) {
    if (isMetaError(error)) return err(conflict(metaConflictCode(error)));
    throw error;
  }
}

export class ListTemplates implements UseCase<TenantInput, TemplateDto[], DomainError> {
  constructor(private readonly deps: OutreachDeps) {}

  async execute(input: TenantInput): Promise<Result<TemplateDto[], DomainError>> {
    const row = await this.deps.connections.get(input.tenantId);
    // Templates belong to the ACTIVE connection's WABA; nothing is listed for a disconnected / onboarding shop.
    if (row === null || (row.status !== "connected" && row.status !== "error")) return ok([]);
    const list = await this.deps.templates.list(input.tenantId, row.wabaId);
    return ok(list.map(templateDto));
  }
}

export class SyncTemplates implements UseCase<TenantInput, TemplateDto[], DomainError> {
  constructor(private readonly deps: OutreachDeps) {}

  async execute(input: TenantInput): Promise<Result<TemplateDto[], DomainError>> {
    const { deps } = this;
    const { tenantId } = input;
    const active = await loadActiveConnection(deps, tenantId);
    if (!active.ok) return active;
    const { token, snapshot } = active.value;
    const whatsapp = deps.whatsapp;
    if (whatsapp === undefined) return err(conflict("WHATSAPP_NOT_CONFIGURED"));

    const revisionsAtFetchStart = new Map<string, number>();
    // By stable local row id as well: a row without a provider id can only be reconciled through it.
    const revisionsByLocalId = new Map<string, number>();
    for (const t of await deps.templates.list(tenantId, snapshot.wabaId)) {
      revisionsByLocalId.set(t.id, t.revision);
      if (t.metaTemplateId !== null) revisionsAtFetchStart.set(t.metaTemplateId, t.revision);
    }
    const fetchStartedAt = deps.clock.now();
    const remote = await metaGuard(() => whatsapp.listTemplates(snapshot.wabaId, token));
    if (!remote.ok) return remote;
    const rows = remote.value.map((m) => fetchedFromMeta(deps, m));

    return deps.unitOfWork.run(tenantId, async (tx) => {
      if (!(await connectionUnchanged(deps, tenantId, snapshot, tx))) {
        return err(conflict("CONNECTION_CHANGED"));
      }
      const result = await deps.templates.replaceSnapshot(
        tenantId,
        snapshot.wabaId,
        rows,
        { revisionsAtFetchStart, revisionsByLocalId, fetchStartedAt },
        tx,
      );
      for (const change of result.statusChanges) {
        await emitTemplateChange(deps, tx, tenantId, snapshot.wabaId, change);
      }
      const list = await deps.templates.list(tenantId, snapshot.wabaId, tx);
      return ok(list.map(templateDto));
    });
  }
}

export interface CreateTemplateInput extends TenantInput {
  draft: TemplateDraft;
}

export class CreateTemplate implements UseCase<CreateTemplateInput, TemplateDto, DomainError> {
  constructor(private readonly deps: OutreachDeps) {}

  async execute(input: CreateTemplateInput): Promise<Result<TemplateDto, DomainError>> {
    const { deps } = this;
    const { tenantId, draft } = input;
    const issues = validateTemplateDraft(draft);
    if (issues.length > 0) {
      return err(
        new ValidationError(
          "Invalid template",
          issues.map((i) => ({ field: i.field, message: i.code })),
        ),
      );
    }
    const active = await loadActiveConnection(deps, tenantId);
    if (!active.ok) return active;
    const { token, snapshot } = active.value;
    const whatsapp = deps.whatsapp;
    if (whatsapp === undefined) return err(conflict("WHATSAPP_NOT_CONFIGURED"));

    const language = normalizeLanguage(draft.language);
    const local = await deps.templates.findByNameLanguage(
      tenantId,
      snapshot.wabaId,
      draft.name,
      language,
    );
    if (local !== null && local.status !== "DELETED")
      return err(conflict("TEMPLATE_ALREADY_EXISTS"));

    const components = toMetaComponents(draft);
    const created = await metaGuard(() =>
      whatsapp.createTemplate(snapshot.wabaId, token, {
        name: draft.name,
        language: draft.language,
        category: draft.category,
        components,
      }),
    );
    if (!created.ok) return created;

    // Store what Meta returns (it may recategorize). An unrecognised category falls back to the draft's, non-sendable.
    const metaCategory = normalizeTemplateCategory(created.value.category);
    const now = deps.clock.now();
    const record: TemplateRecord = {
      id: deps.idGenerator.generate(),
      tenantId,
      wabaId: snapshot.wabaId,
      metaTemplateId: created.value.id,
      name: draft.name,
      language,
      category: metaCategory ?? draft.category,
      components,
      status: metaCategory === null ? "UNKNOWN" : normalizeTemplateStatus(created.value.status),
      rejectedReason: null,
      qualityScore: null,
      lastSyncedAt: now,
      statusEventAt: null,
      categoryEventAt: null,
      reconciledAt: now,
      revision: 1,
      version: 1,
    };

    return deps.unitOfWork.run(tenantId, async (tx) => {
      // A disconnect/switch after the remote create leaves the template at Meta; the next sync adopts it.
      if (!(await connectionUnchanged(deps, tenantId, snapshot, tx))) {
        return err(conflict("CONNECTION_CHANGED"));
      }
      const existing = await deps.templates.findByNameLanguage(
        tenantId,
        snapshot.wabaId,
        record.name,
        record.language,
        tx,
      );
      if (existing === null) {
        if ((await deps.templates.insert(record, tx)) === "duplicate") {
          return err(conflict("TEMPLATE_ALREADY_EXISTS"));
        }
        await emitTemplateChange(deps, tx, tenantId, snapshot.wabaId, {
          id: record.id,
          metaTemplateId: record.metaTemplateId,
          name: record.name,
          language: record.language,
          category: record.category,
          from: null,
          to: record.status,
        });
      } else {
        // Only the DELETED tombstone seen BEFORE the remote create, still at the revision seen then, is replaced: by its
        // stable local id + scoped name/language + expected revision (the new provider id may differ from the old one).
        if (local === null || existing.id !== local.id || existing.status !== "DELETED") {
          return err(conflict("TEMPLATE_ALREADY_EXISTS"));
        }
        const fetched: FetchedTemplate = {
          id: existing.id,
          metaTemplateId: created.value.id,
          name: record.name,
          language: record.language,
          category: record.category,
          components,
          status: record.status,
          rejectedReason: null,
          qualityScore: null,
        };
        const replaced = await deps.templates.replaceTombstone(
          tenantId,
          snapshot.wabaId,
          {
            id: local.id,
            name: record.name,
            language: record.language,
            expectedRevision: local.revision,
          },
          fetched,
          now,
          tx,
        );
        if (replaced !== "applied") {
          // `existing` is the pre-CAS DELETED tombstone: it is NEVER an answer. A sync that adopted the very template we
          // just created is a success only when the scoped key is re-read now and holds a LIVE row with the expected
          // local id and the newly returned provider id (no event: the adopter emitted it).
          const current = await deps.templates.findByNameLanguage(
            tenantId,
            snapshot.wabaId,
            record.name,
            record.language,
            tx,
          );
          return current !== null &&
            current.id === existing.id &&
            current.status !== "DELETED" &&
            current.metaTemplateId === created.value.id
            ? ok(templateDto(current))
            : err(conflict("TEMPLATE_ALREADY_EXISTS"));
        }
        await emitTemplateChange(deps, tx, tenantId, snapshot.wabaId, {
          id: existing.id,
          metaTemplateId: created.value.id,
          name: record.name,
          language: record.language,
          category: record.category,
          from: existing.status,
          to: record.status,
        });
      }
      const stored = await deps.templates.findByNameLanguage(
        tenantId,
        snapshot.wabaId,
        record.name,
        record.language,
        tx,
      );
      return ok(templateDto(stored ?? record));
    });
  }
}

export interface DeleteTemplateInput extends TenantInput {
  name: string;
}

export class DeleteTemplate implements UseCase<
  DeleteTemplateInput,
  { deleted: number },
  DomainError
> {
  constructor(private readonly deps: OutreachDeps) {}

  async execute(input: DeleteTemplateInput): Promise<Result<{ deleted: number }, DomainError>> {
    const { deps } = this;
    const { tenantId, name } = input;
    if (typeof name !== "string" || name.trim() === "") {
      return err(
        new ValidationError("Invalid template", [{ field: "name", message: "name_required" }]),
      );
    }
    const active = await loadActiveConnection(deps, tenantId);
    if (!active.ok) return active;
    const { token, snapshot } = active.value;
    const whatsapp = deps.whatsapp;
    if (whatsapp === undefined) return err(conflict("WHATSAPP_NOT_CONFIGURED"));

    const live = (await deps.templates.list(tenantId, snapshot.wabaId)).filter(
      (t) => t.name === name && t.status !== "DELETED",
    );
    if (live.length === 0) return err(new NotFoundError("Template not found"));

    const removed = await metaGuard(() => whatsapp.deleteTemplate(snapshot.wabaId, token, name));
    if (!removed.ok) return removed;

    return deps.unitOfWork.run(tenantId, async (tx) => {
      if (!(await connectionUnchanged(deps, tenantId, snapshot, tx))) {
        return err(conflict("CONNECTION_CHANGED"));
      }
      const before = (await deps.templates.list(tenantId, snapshot.wabaId, tx)).filter(
        (t) => t.name === name && t.status !== "DELETED",
      );
      await deps.templates.markDeletedByName(tenantId, snapshot.wabaId, name, tx);
      for (const t of before) {
        await emitTemplateChange(deps, tx, tenantId, snapshot.wabaId, {
          id: t.id,
          metaTemplateId: t.metaTemplateId,
          name: t.name,
          language: t.language,
          category: t.category,
          from: t.status,
          to: "DELETED",
        });
      }
      return ok({ deleted: before.length });
    });
  }
}
