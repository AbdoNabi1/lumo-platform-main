import type { IdGenerator } from "@platform/contracts";
import type { OutreachEventSink } from "../application/events";
import type { OutreachDeps } from "../application/outreach-deps";
import type { MetaTemplateRecord } from "../application/ports";
import type {
  TemplateCategoryValue,
  TemplateRecord,
  TemplateStatus,
  WhatsAppConnectionRecord,
} from "../domain/repositories";
import {
  createInMemoryOutreach,
  type InMemoryOutreach,
} from "../infrastructure/in-memory-outreach-wiring";
import { FakeClock, FakeEmailPort, FakeVault, FakeWhatsAppPort } from "./fake-ports";
import { InMemoryOutreachEventRecorder } from "./in-memory-outreach-event-recorder";

export const PLATFORM_TENANT = "platform";
export const T1 = "tenant-1";
export const T2 = "tenant-2";

export interface OutreachKit {
  deps: OutreachDeps;
  mem: InMemoryOutreach;
  clock: FakeClock;
  whatsapp: FakeWhatsAppPort;
  email: FakeEmailPort;
  vault: FakeVault;
  events: InMemoryOutreachEventRecorder;
  pins: string[];
  profile: { storeName: string; contactEmail: string | null };
}

/** Everything a use-case test needs: in-memory repositories (real rollback), fake ports, a fake clock, the recorder. */
export function createOutreachKit(
  opts: {
    now?: Date;
    configured?: boolean;
    emailConfigured?: boolean;
    caps?: { perHour: number; perDay: number };
    eventSink?: (recorder: InMemoryOutreachEventRecorder) => OutreachEventSink;
  } = {},
): OutreachKit {
  const clock = new FakeClock(opts.now ?? new Date("2026-11-19T10:00:00.000Z"));
  const mem = createInMemoryOutreach({ clock: clock, platformTenantId: PLATFORM_TENANT });
  const whatsapp = new FakeWhatsAppPort();
  const email = new FakeEmailPort();
  const vault = new FakeVault();
  const events = new InMemoryOutreachEventRecorder();
  const pins = ["123456", "654321", "111111", "222222", "333333"];
  let idCounter = 0;
  const idGenerator: IdGenerator = {
    generate: () => {
      idCounter += 1;
      return `id-${idCounter}`;
    },
  };
  const profile = { storeName: "My Shop", contactEmail: "owner@shop.test" as string | null };
  const configured = opts.configured ?? true;
  const emailConfigured = opts.emailConfigured ?? true;
  const deps: OutreachDeps = {
    ...mem,
    whatsapp: configured ? whatsapp : undefined,
    vault: configured ? vault : undefined,
    email: emailConfigured ? email : undefined,
    emailFrom: emailConfigured ? "no-reply@send.morbeh.com" : undefined,
    emailCaps: opts.caps ?? { perHour: 200, perDay: 2000 },
    storeProfile: { get: () => Promise.resolve({ ...profile }) },
    randomPin: () => pins.shift() ?? "999999",
    unitOfWork: mem.unitOfWork,
    idGenerator,
    clock,
    events: opts.eventSink === undefined ? events : opts.eventSink(events),
    unresolvedAfterMs: 300_000,
  };
  return { deps, mem, clock, whatsapp, email, vault, events, pins, profile };
}

export interface SeedConnectionOptions {
  tenantId?: string;
  phoneNumberId?: string;
  wabaId?: string;
  token?: string;
  pin?: string;
  status?: "connected" | "onboarding" | "error" | "disconnected";
}

/** A completed connection (row + platform directory entry), written straight to the repositories. */
export async function seedConnection(
  kit: OutreachKit,
  opts: SeedConnectionOptions = {},
): Promise<WhatsAppConnectionRecord> {
  const tenantId = opts.tenantId ?? T1;
  const phoneNumberId = opts.phoneNumberId ?? "phone-1";
  const wabaId = opts.wabaId ?? "waba-1";
  const status = opts.status ?? "connected";
  const sealed = await kit.vault.seal(tenantId, "whatsapp", {
    accessToken: opts.token ?? "token-seed",
    pin: opts.pin ?? "123456",
  });
  const record: WhatsAppConnectionRecord = {
    tenantId,
    status,
    wabaId,
    phoneNumberId,
    displayPhoneNumber: status === "connected" ? "+20 101 234 5678" : null,
    verifiedName: status === "connected" ? "Shop" : null,
    qualityRating: "GREEN",
    messagingLimitTier: "TIER_250",
    sealedCredentials: sealed,
    connectedAt: status === "connected" ? kit.clock.now() : null,
    disconnectedAt: null,
    lastStatusSyncAt: null,
    lastError: null,
    onboardingAttemptId: null,
    onboardingStage: status === "connected" ? "registered" : null,
    onboardingFailure: null,
    onboardingLeaseOwner: null,
    onboardingLeaseUntil: null,
    version: 1,
  };
  await kit.mem.connections.save(record, 0);
  if (status === "connected") await kit.mem.directory.claim(phoneNumberId, wabaId, tenantId);
  return { ...record, version: 1 };
}

export interface SeedTemplateOptions {
  tenantId?: string;
  wabaId?: string;
  name?: string;
  language?: string;
  category?: TemplateCategoryValue;
  status?: TemplateStatus;
  metaTemplateId?: string | null;
  components?: unknown;
  id?: string;
}

export const BODY_ONE_VAR = [{ type: "BODY", text: "Hello {{1}}, your order is on its way" }];

export async function seedTemplate(
  kit: OutreachKit,
  opts: SeedTemplateOptions = {},
): Promise<TemplateRecord> {
  const name = opts.name ?? "cod_confirmation_ar";
  const record: TemplateRecord = {
    id: opts.id ?? `tpl-${name}-${opts.language ?? "ar"}`,
    tenantId: opts.tenantId ?? T1,
    wabaId: opts.wabaId ?? "waba-1",
    metaTemplateId: opts.metaTemplateId === undefined ? `meta-${name}` : opts.metaTemplateId,
    name,
    language: opts.language ?? "ar",
    category: opts.category ?? "UTILITY",
    components: opts.components ?? BODY_ONE_VAR,
    status: opts.status ?? "APPROVED",
    rejectedReason: null,
    qualityScore: null,
    lastSyncedAt: kit.clock.now(),
    statusEventAt: null,
    categoryEventAt: null,
    reconciledAt: kit.clock.now(),
    revision: 1,
    version: 1,
  };
  await kit.mem.templates.insert(record);
  return record;
}

/** The Meta-side record of a seeded template (what `getTemplate` / `listTemplates` return). */
export function metaTemplate(
  t: TemplateRecord,
  over: Partial<MetaTemplateRecord> = {},
): MetaTemplateRecord {
  return {
    id: t.metaTemplateId ?? "meta-x",
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    components: t.components as unknown[],
    rejectedReason: null,
    qualityScore: null,
    ...over,
  };
}
