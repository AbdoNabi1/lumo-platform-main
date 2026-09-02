import type { IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { IdentityEventTranslator } from "./identity-event-translator";
import { runIdentityDecisionStoreContractTests } from "./identity-decision-store.contract";
import { InMemoryIdentityDecisionStore } from "./in-memory-identity-decision-store";

const clock = { now: () => new Date("2026-07-22T00:00:00.000Z") };
const ids: IdGenerator = { generate: () => crypto.randomUUID() };

runIdentityDecisionStoreContractTests("in-memory", () => {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new IdentityEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "customer360",
  });
  const context = rootEventContext(ids);
  const store = new InMemoryIdentityDecisionStore({ outbox, context });
  return { store, withTx: (fn) => fn(undefined) };
});
