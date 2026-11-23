import type { Clock, IdGenerator } from "@platform/contracts";
import type { Database } from "@platform/db";
import { InMemoryLeadEmissionLedger, type LeadEmissionLedgerPort } from "@platform/tracking";
import {
  ChangeLeadStatus,
  GetLead,
  ListLeadExportRows,
  ListLeads,
  SubmitLead,
} from "./application/leads.use-cases";
import type { ShopFactsPort } from "./application/ports";
import type { LeadRepository } from "./domain/lead-repository";
import { InMemoryLeadRepository } from "./infrastructure/in-memory-lead-repository";
import { LeadsController } from "./interfaces/leads.controller";

export interface LeadsWiringDeps {
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly shop: ShopFactsPort;
  /** The once-per-session claim store. Absent ⇒ an in-memory ledger on the injected clock (tests/dev). */
  readonly ledger?: LeadEmissionLedgerPort;
  /**
   * Production persistence. Present ⇒ the Prisma repository (added in Task 2 of Part C); absent ⇒
   * in-memory. ADR-0014: the repository built here is a tenant-agnostic singleton.
   */
  readonly prisma?: Database;
}

export interface WiredLeads {
  readonly controller: LeadsController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

function buildController(leads: LeadRepository, deps: LeadsWiringDeps): LeadsController {
  const ledger =
    deps.ledger ?? new InMemoryLeadEmissionLedger({ now: () => deps.clock.now().getTime() });
  return new LeadsController({
    submitLead: new SubmitLead({
      leads,
      ledger,
      shop: deps.shop,
      clock: deps.clock,
      idGenerator: deps.idGenerator,
    }),
    listLeads: new ListLeads({ leads }),
    getLead: new GetLead({ leads }),
    changeLeadStatus: new ChangeLeadStatus({ leads, clock: deps.clock }),
    listLeadExportRows: new ListLeadExportRows({ leads }),
  });
}

/** Composition root for the Leads context. In-memory only for now; leads publish no events. */
export function wireLeads(deps: LeadsWiringDeps): WiredLeads {
  if (deps.prisma !== undefined) {
    // Fail loud: silently falling back to memory in production would drop every lead on restart.
    throw new Error("leads: Prisma persistence is not wired yet (Part C, Task 2)");
  }
  return {
    controller: buildController(new InMemoryLeadRepository(), deps),
    drainOutbox: () => Promise.resolve(0),
    deliveredEventTypes: [],
  };
}
