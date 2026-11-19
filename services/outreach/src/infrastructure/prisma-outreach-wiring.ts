import type { Clock } from "@platform/contracts";
import { PrismaUnitOfWork, type Database } from "@platform/db";
import type { OutreachRepositories } from "../domain/repositories";
import {
  PrismaContactRepository,
  PrismaEmailSendCounterRepository,
  PrismaInboundMessageRepository,
  PrismaOutboundMessageRepository,
  PrismaPhoneDirectory,
  PrismaUnmatchedStatusRepository,
  PrismaWhatsAppConnectionRepository,
} from "./prisma-outreach-repositories";
import { PrismaTemplateRepository } from "./prisma-template-repository";

export interface PrismaOutreach extends OutreachRepositories {
  unitOfWork: PrismaUnitOfWork;
}

/** The production repositories on the `outreach` schema. `platformTenantId` scopes the phone directory (A1). */
export function createPrismaOutreach(deps: {
  prisma: Database;
  clock: Clock;
  platformTenantId: string;
}): PrismaOutreach {
  const { prisma, clock, platformTenantId } = deps;
  return {
    unitOfWork: new PrismaUnitOfWork(prisma),
    connections: new PrismaWhatsAppConnectionRepository({ prisma }),
    directory: new PrismaPhoneDirectory({ prisma, platformTenantId }),
    templates: new PrismaTemplateRepository({ prisma }),
    contacts: new PrismaContactRepository({ prisma }),
    outbound: new PrismaOutboundMessageRepository({ prisma }),
    inbound: new PrismaInboundMessageRepository({ prisma }),
    unmatched: new PrismaUnmatchedStatusRepository({ prisma, clock }),
    emailCounters: new PrismaEmailSendCounterRepository(),
  };
}
