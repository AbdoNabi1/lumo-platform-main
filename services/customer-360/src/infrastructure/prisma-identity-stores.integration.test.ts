import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { IdentityLinkObserved } from "../events/identity-link-observed.event";
import { IdentitySplit } from "../events/identity-split.event";
import { IdentityEventTranslator } from "./identity-event-translator";
import { runIdentityDecisionStoreContractTests } from "./identity-decision-store.contract";
import { runIdentityGraphStoreContractTests } from "./identity-graph-store.contract";
import { PrismaIdentityDecisionStore } from "./prisma-identity-decision-store";
import { PrismaIdentityGraphStore } from "./prisma-identity-graph-store";

/**
 * Integration suite for the Customer 360 Prisma adapters (Phase 6.1). Requires a real PostgreSQL
 * with the `customer_360` schema migrated:
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/customer-360 test
 *
 * HONESTLY GATED: without `DATABASE_URL_TEST` the suite is skipped — never faked. Client creation is
 * lazy (inside `wire`, called within each `it`) so gating never connects.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("Prisma Customer 360 identity stores (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-07-20T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };
  const tenantId = `tenant-itest-${crypto.randomUUID()}`;

  function wire() {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new IdentityEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "customer360",
    });
    const context = rootEventContext(ids);
    const graph = new PrismaIdentityGraphStore({
      prisma,
      outbox,
      context,
      idGenerator: ids,
    });
    const decisions = new PrismaIdentityDecisionStore({
      prisma,
      outbox,
      context,
      idGenerator: ids,
    });
    const unitOfWork = new PrismaUnitOfWork(prisma);
    return { graph, decisions, unitOfWork };
  }

  runIdentityGraphStoreContractTests("prisma", () => {
    const { graph, unitOfWork } = wire();
    return { store: graph, withTx: (fn) => unitOfWork.run(fn) };
  });

  runIdentityDecisionStoreContractTests("prisma", () => {
    const { decisions, unitOfWork } = wire();
    return { store: decisions, withTx: (fn) => unitOfWork.run(fn) };
  });

  it("persists an edge and rehydrates it into an equivalent graph", async () => {
    const { graph, unitOfWork } = wire();
    const edge = {
      fromType: "visitor_id" as const,
      fromValue: `v-${crypto.randomUUID()}`,
      toType: "email_hash" as const,
      toValue: "hash-itest",
      confidence: "deterministic" as const,
      observedAt: clock.now().toISOString(),
      source: "checkout",
    };
    const event = new IdentityLinkObserved(
      {
        eventId: ids.generate(),
        aggregateId: UniqueEntityId.from(edge.fromValue),
        occurredAt: clock.now(),
      },
      {
        fromType: edge.fromType,
        fromValue: edge.fromValue,
        toType: edge.toType,
        toValue: edge.toValue,
        confidence: edge.confidence,
        source: edge.source,
      },
    );

    await unitOfWork.run(async (tx) => {
      await graph.appendEdge(edge, tenantId, event, tx);
    });

    const loaded = await graph.loadGraph(tenantId);
    expect(
      loaded.edges.some((e) => e.fromValue === edge.fromValue && e.toValue === edge.toValue),
    ).toBe(true);
  });

  it("records a split decision and surfaces it as a retracted edge", async () => {
    const { decisions, unitOfWork } = wire();
    const retractedEdge = {
      fromType: "visitor_id" as const,
      fromValue: `v-${crypto.randomUUID()}`,
      toType: "device_id" as const,
      toValue: "shared-tablet-itest",
      confidence: "probabilistic" as const,
      observedAt: clock.now().toISOString(),
      source: "server_stitch",
    };
    const decisionId = ids.generate();
    const event = new IdentitySplit(
      {
        eventId: ids.generate(),
        aggregateId: UniqueEntityId.from(decisionId),
        occurredAt: clock.now(),
      },
      {
        decisionId,
        retractedFromType: retractedEdge.fromType,
        retractedFromValue: retractedEdge.fromValue,
        retractedToType: retractedEdge.toType,
        retractedToValue: retractedEdge.toValue,
        reason: "shared family device",
        actor: "operator-itest",
      },
    );

    await unitOfWork.run(async (tx) => {
      await decisions.record(
        {
          id: decisionId,
          kind: "split",
          subject: { type: retractedEdge.fromType, value: retractedEdge.fromValue },
          related: { type: retractedEdge.toType, value: retractedEdge.toValue },
          retractedEdge,
          reason: "shared family device",
          actor: "operator-itest",
          occurredAt: clock.now().toISOString(),
        },
        event,
        tenantId,
        tx,
      );
    });

    const retracted = await decisions.retractedEdges(tenantId);
    expect(
      retracted.some(
        (e) => e.fromValue === retractedEdge.fromValue && e.toValue === retractedEdge.toValue,
      ),
    ).toBe(true);
  });
});
