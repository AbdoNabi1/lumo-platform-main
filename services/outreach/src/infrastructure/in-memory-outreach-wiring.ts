import type { Clock } from "@platform/contracts";
import type { OutreachRepositories } from "../domain/repositories";
import {
  InMemoryContactRepository,
  InMemoryEmailSendCounterRepository,
  InMemoryInboundMessageRepository,
  InMemoryOutboundMessageRepository,
  InMemoryPhoneDirectory,
  InMemoryTemplateRepository,
  InMemoryUnmatchedStatusRepository,
  InMemoryWhatsAppConnectionRepository,
} from "./in-memory-outreach-repositories";
import { InMemoryOutreachStore, InMemoryOutreachUnitOfWork } from "./in-memory-outreach-store";

export interface InMemoryOutreach extends OutreachRepositories {
  unitOfWork: InMemoryOutreachUnitOfWork;
  store: InMemoryOutreachStore;
}

/** One in-memory "database": every repository shares the store, and the unit of work really rolls back. */
export function createInMemoryOutreach(deps: {
  clock: Clock;
  platformTenantId: string;
}): InMemoryOutreach {
  const store = new InMemoryOutreachStore();
  return {
    store,
    unitOfWork: new InMemoryOutreachUnitOfWork(store),
    connections: new InMemoryWhatsAppConnectionRepository(store, deps.clock),
    directory: new InMemoryPhoneDirectory(store, deps.platformTenantId),
    templates: new InMemoryTemplateRepository(store),
    contacts: new InMemoryContactRepository(store),
    outbound: new InMemoryOutboundMessageRepository(store),
    inbound: new InMemoryInboundMessageRepository(store),
    unmatched: new InMemoryUnmatchedStatusRepository(store, deps.clock),
    emailCounters: new InMemoryEmailSendCounterRepository(store),
  };
}
