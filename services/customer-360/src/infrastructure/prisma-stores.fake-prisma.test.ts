import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { createCustomerFakePrisma } from "../test-support/fake-prisma";
import { runAttributeStoreContractTests } from "./attribute-store.contract";
import { IdentityEventTranslator } from "./identity-event-translator";
import { runIdentityDecisionStoreContractTests } from "./identity-decision-store.contract";
import { runIdentityGraphStoreContractTests } from "./identity-graph-store.contract";
import { PrismaAttributeStore } from "./prisma-attribute-store";
import { PrismaIdentityDecisionStore } from "./prisma-identity-decision-store";
import { PrismaIdentityGraphStore } from "./prisma-identity-graph-store";
import { PrismaProfileStore } from "./prisma-profile-store";
import { PrismaSegmentDefinitionRegistry } from "./prisma-segment-definition-registry";
import { PrismaSegmentStore } from "./prisma-segment-store";
import { PrismaSessionStore } from "./prisma-session-store";
import { runProfileStoreContractTests } from "./profile-store.contract";
import { runSegmentDefinitionRegistryContractTests } from "./segment-definition-registry.contract";
import { runSegmentStoreContractTests } from "./segment-store.contract";
import { runSessionStoreContractTests } from "./session-store.contract";

/**
 * The same repository parity contracts the in-memory adapters and the `DATABASE_URL_TEST`-gated
 * integration suites run, here against the Prisma adapters over `createCustomerFakePrisma` — so the
 * row mapping, CAS branches and tenant scoping of each adapter are exercised on every `pnpm test`,
 * not only when a Postgres is available. The integration suites stay the authority on real SQL.
 */
const clock: Clock = { now: () => new Date("2026-07-21T00:00:00.000Z") };
const ids: IdGenerator = { generate: () => crypto.randomUUID() };

function wire() {
  const { database: prisma } = createCustomerFakePrisma();
  const outbox = new OutboxWriter({
    store: new PrismaOutboxStore(prisma),
    translator: new IdentityEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "customer360",
  });
  const context = rootEventContext(ids);
  return { prisma, outbox, context, unitOfWork: new PrismaUnitOfWork(prisma) };
}

runAttributeStoreContractTests("prisma over fake client", () => {
  const { prisma } = wire();
  return new PrismaAttributeStore({ prisma, idGenerator: ids });
});

runProfileStoreContractTests("prisma over fake client", () => {
  const { prisma } = wire();
  return new PrismaProfileStore({ prisma, idGenerator: ids });
});

runSessionStoreContractTests("prisma over fake client", () => {
  const { prisma } = wire();
  return new PrismaSessionStore({ prisma, idGenerator: ids });
});

runSegmentStoreContractTests("prisma over fake client", () => {
  const { prisma } = wire();
  return new PrismaSegmentStore({ prisma, idGenerator: ids });
});

runSegmentDefinitionRegistryContractTests("prisma over fake client", () => {
  const { prisma, outbox, context } = wire();
  return new PrismaSegmentDefinitionRegistry({ prisma, outbox, context, idGenerator: ids });
});

runIdentityGraphStoreContractTests("prisma over fake client", () => {
  const { prisma, outbox, context, unitOfWork } = wire();
  const store = new PrismaIdentityGraphStore({ prisma, outbox, context, idGenerator: ids });
  return { store, withTx: (fn) => unitOfWork.run(fn) };
});

runIdentityDecisionStoreContractTests("prisma over fake client", () => {
  const { prisma, outbox, context, unitOfWork } = wire();
  const store = new PrismaIdentityDecisionStore({ prisma, outbox, context, idGenerator: ids });
  return { store, withTx: (fn) => unitOfWork.run(fn) };
});
