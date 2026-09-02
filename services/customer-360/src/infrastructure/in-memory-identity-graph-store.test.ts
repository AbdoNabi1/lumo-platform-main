import type { IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { IdentityEventTranslator } from "./identity-event-translator";
import { runIdentityGraphStoreContractTests } from "./identity-graph-store.contract";
import { InMemoryIdentityGraphStore } from "./in-memory-identity-graph-store";

const clock = { now: () => new Date("2026-07-22T00:00:00.000Z") };
const ids: IdGenerator = { generate: () => crypto.randomUUID() };

runIdentityGraphStoreContractTests("in-memory", () => {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new IdentityEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "customer360",
  });
  const context = rootEventContext(ids);
  const store = new InMemoryIdentityGraphStore({ outbox, context });
  return { store, withTx: (fn) => fn(undefined) };
});
