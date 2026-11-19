import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { OutreachRepositories } from "../domain/repositories";
import type { OutreachEventSink } from "./events";
import type { EmailSendPort, OutreachCredentialVault, WhatsAppCloudApiPort } from "./ports";

export interface StoreProfilePort {
  get(tenantId: string): Promise<{ storeName: string; contactEmail: string | null }>;
}

/** Everything a use case may need. Undefined ports mean "platform not configured" (the `available:false` path). */
export interface OutreachDeps extends OutreachRepositories {
  whatsapp: WhatsAppCloudApiPort | undefined;
  email: EmailSendPort | undefined;
  vault: OutreachCredentialVault | undefined;
  unitOfWork: TransactionalUnitOfWork<unknown>;
  idGenerator: IdGenerator;
  clock: Clock;
  emailFrom: string | undefined;
  emailCaps: { perHour: number; perDay: number };
  storeProfile: StoreProfilePort;
  /** 6 ASCII digits. */
  randomPin: () => string;
  events: OutreachEventSink;
  /** `pending` rows older than this are recovered to `unknown`. Must exceed the provider timeout. */
  unresolvedAfterMs: number;
}

export const DEFAULT_UNRESOLVED_AFTER_MS = 300_000;
export const DEFAULT_EMAIL_CAPS = { perHour: 200, perDay: 2000 } as const;
