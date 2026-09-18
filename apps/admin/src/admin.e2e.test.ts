import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireAdmin } from "./composition";
import { InMemoryAuditTrail } from "./infrastructure/in-memory-audit-trail";

const staff: Principal = { id: "staff-1", kind: "staff", roles: ["admin"] };

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-06-30T00:00:00.000Z") };

function wire() {
  return wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

describe("admin wiring (end to end)", () => {
  it("drives each frozen Phase-1 screen through its owning context and relays the events", async () => {
    const admin = wire();

    // Products screen → Catalog
    const created = await admin.products.createProduct(staff, {
      sku: "P-1",
      name: "Toy Wagon",
      slug: "toy-wagon",
      variants: [{ sku: "P-1-RED", priceAmountMinor: 1999, currency: "USD" }],
      tenantId: "tenant-1",
    });
    expect(created.status).toBe(201);
    const productId = (created.body as { id: string }).id;
    expect(
      (await admin.products.publishProduct(staff, { productId, tenantId: "tenant-1" })).status,
    ).toBe(200);
    expect(
      (
        await admin.products.createCategory(staff, {
          name: "Wagons",
          slug: "wagons",
          tenantId: "tenant-1",
        })
      ).status,
    ).toBe(201);

    // Inventory screen → Inventory
    expect(
      (await admin.inventory.receiveStock(staff, { productId, warehouseId: "wh-1", quantity: 10 }))
        .status,
    ).toBe(200);

    // Customers screen → Identity
    const customer = await admin.customers.registerCustomer(staff, {
      email: "alice@example.com",
      name: "Alice",
      tenantId: "tenant-1",
    });
    expect(customer.status).toBe(201);

    // Orders screen → Orders
    const order = await admin.orders.placeOrder(staff, {
      customerRef: "customer-1",
      currency: "USD",
      items: [{ productId, name: "Toy Wagon", unitPriceAmountMinor: 1999, quantity: 2 }],
      shippingAddress: { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" },
    });
    expect(order.status).toBe(201);

    // Discounts/Coupons screens → Pricing
    expect(
      (
        await admin.pricing.createPriceList(staff, {
          tenantId: "tenant-1",
          name: "Retail",
          currency: "USD",
        })
      ).status,
    ).toBe(201);

    // Events from every context flow through the aggregated outbox drain.
    const published = await admin.drainOutbox();
    // product.created + product.published + category.created (Commerce Sprint 1: create now
    // emits) + inventory.adjusted + customer.registered + order.placed
    expect(published).toBe(6);
    expect(admin.deliveredEventTypes).toEqual(
      expect.arrayContaining([
        "catalog.product.created",
        "catalog.product.published",
        "catalog.category.created",
        "inventory.inventory_item.adjusted",
        "identity.customer.registered",
        "orders.order.placed",
      ]),
    );
  });

  it("delegates presentation unchanged — validation errors surface as 422", async () => {
    const admin = wire();
    const response = await admin.customers.registerCustomer(staff, {
      email: "not-an-email",
      name: "X",
      tenantId: "tenant-1",
    });
    expect(response.status).toBe(422);
  });

  it("delegates not-found unchanged — publishing a missing product is 404", async () => {
    const admin = wire();
    const response = await admin.products.publishProduct(staff, {
      productId: "missing",
      tenantId: "tenant-1",
    });
    expect(response.status).toBe(404);
  });

  it("delegates business-rule errors unchanged — refunding an unpaid order is 409", async () => {
    const admin = wire();
    const order = await admin.orders.placeOrder(staff, {
      customerRef: "customer-1",
      currency: "USD",
      items: [{ productId: "p1", name: "Item", unitPriceAmountMinor: 500, quantity: 1 }],
      shippingAddress: { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" },
    });
    const orderId = (order.body as { orderId: string }).orderId;
    expect((await admin.orders.refundOrder(staff, { orderId })).status).toBe(409);
  });

  it("drives the Coupons screen through create, advance, and redeem", async () => {
    const admin = wire();

    const created = await admin.coupons.create(staff, {
      code: "WELCOME10",
      promotionRef: "promotion-1",
      multiUse: true,
      tenantId: "tenant-1",
    });
    expect(created.status).toBe(201);
    const couponId = (created.body as { couponId: string }).couponId;

    const redeemed = await admin.coupons.redeem(staff, {
      code: "WELCOME10",
      customerRef: "customer-1",
      idempotencyKey: "idem-1",
      tenantId: "tenant-1",
    });
    expect(redeemed.status).toBe(200);
    expect((redeemed.body as { duplicate: boolean }).duplicate).toBe(false);

    const disabled = await admin.coupons.advance(staff, {
      couponId,
      toStatus: "disabled",
      tenantId: "tenant-1",
    });
    expect(disabled.status).toBe(200);
    expect((disabled.body as { status: string }).status).toBe("disabled");
  });

  it("drives the Experimentation screen through create, advance, record-result, and declare-winner", async () => {
    const admin = wire();

    const created = await admin.experimentation.create(staff, {
      name: "Checkout CTA color",
      variants: [
        { key: "control", allocationPercentage: 50, isControl: true },
        { key: "variant-a", allocationPercentage: 50, isControl: false },
      ],
      goalMetricRef: "conversion-rate",
      tenantId: "tenant-1",
    });
    expect(created.status).toBe(201);
    const experimentId = (created.body as { experimentId: string }).experimentId;

    const started = await admin.experimentation.advance(staff, {
      experimentId,
      toStatus: "running",
      tenantId: "tenant-1",
    });
    expect(started.status).toBe(200);

    const recorded = await admin.experimentation.recordResult(staff, {
      experimentId,
      variantKey: "variant-a",
      metricValue: 0.12,
      sampleSize: 1000,
      tenantId: "tenant-1",
    });
    expect(recorded.status).toBe(200);

    const completed = await admin.experimentation.advance(staff, {
      experimentId,
      toStatus: "completed",
      tenantId: "tenant-1",
    });
    expect(completed.status).toBe(200);

    const winner = await admin.experimentation.declareWinner(staff, {
      experimentId,
      variantKey: "variant-a",
      tenantId: "tenant-1",
    });
    expect(winner.status).toBe(200);
    expect((winner.body as { status: string }).status).toBe("completed");
  });

  it("drives the Promotions screen through create, evaluate, advance, and record-usage", async () => {
    const admin = wire();

    const created = await admin.promotions.create(staff, {
      name: "10% off carts over $50",
      ruleType: "automatic",
      scope: "cart",
      targetRefs: [],
      minimumSubtotalAmountMinor: 5000,
      rewardType: "percentage",
      rewardValue: 10,
      stackable: false,
      priority: 1,
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(created.status).toBe(201);
    const promotionId = (created.body as { promotionId: string }).promotionId;

    const activated = await admin.promotions.advance(staff, {
      promotionId,
      toStatus: "active",
    });
    expect(activated.status).toBe(200);

    const evaluated = await admin.promotions.evaluate(staff, {
      cart: {
        lines: [{ productRef: "p1", categoryRefs: [], quantity: 1, unitPriceAmountMinor: 6000 }],
        subtotalAmountMinor: 6000,
      },
      customerRef: "customer-1",
    });
    expect(evaluated.status).toBe(200);
    expect((evaluated.body as { determinations: readonly unknown[] }).determinations.length).toBe(
      1,
    );

    const recorded = await admin.promotions.recordUsage(staff, { promotionId });
    expect(recorded.status).toBe(200);
  });

  it("drives the Recommendations screen through create, advance, generate, and regenerate", async () => {
    const admin = wire();

    const created = await admin.recommendations.create(staff, {
      name: "Frequently bought together",
      strategy: "frequently_bought_together",
      tenantId: "tenant-1",
    });
    expect(created.status).toBe(201);
    const modelId = (created.body as { modelId: string }).modelId;

    const training = await admin.recommendations.advance(staff, {
      modelId,
      toStatus: "training",
      tenantId: "tenant-1",
    });
    expect(training.status).toBe(200);

    const activated = await admin.recommendations.advance(staff, {
      modelId,
      toStatus: "active",
      tenantId: "tenant-1",
    });
    expect(activated.status).toBe(200);

    const generated = await admin.recommendations.generate(staff, {
      modelId,
      interactionId: "interaction-1",
      anchorRef: "product-1",
      tenantId: "tenant-1",
    });
    expect(generated.status).toBe(200);
    expect((generated.body as { setCount: number }).setCount).toBe(1);

    const regenerated = await admin.recommendations.regenerate(staff, {
      modelId,
      anchorRef: "product-1",
      tenantId: "tenant-1",
    });
    expect(regenerated.status).toBe(200);
  });

  it("drives the Automation screen through create, advance, and trigger (idempotent replay)", async () => {
    const admin = wire();

    const created = await admin.automation.create(staff, {
      name: "Send welcome email",
      triggerType: "event",
      eventType: "customer.created",
      actions: [{ actionType: "send_email", params: { template: "welcome" } }],
      tenantId: "tenant-1",
    });
    expect(created.status).toBe(201);
    const workflowId = (created.body as { workflowId: string }).workflowId;

    const activated = await admin.automation.advance(staff, {
      workflowId,
      toStatus: "active",
      tenantId: "tenant-1",
    });
    expect(activated.status).toBe(200);

    const triggered = await admin.automation.trigger(staff, {
      workflowId,
      triggerId: "trigger-1",
      tenantId: "tenant-1",
    });
    expect(triggered.status).toBe(200);
    expect((triggered.body as { duplicate: boolean }).duplicate).toBe(false);

    const replayed = await admin.automation.trigger(staff, {
      workflowId,
      triggerId: "trigger-1",
      tenantId: "tenant-1",
    });
    expect(replayed.status).toBe(200);
    expect((replayed.body as { duplicate: boolean }).duplicate).toBe(true);
  });

  it("drives the Feature Flags screen through create, rollout, rule, override, and advance", async () => {
    const admin = wire();

    const created = await admin.featureFlags.create(staff, {
      key: "new-checkout-flow",
      name: "New checkout flow",
      tenantId: "tenant-1",
    });
    expect(created.status).toBe(201);
    const flagId = (created.body as { flagId: string }).flagId;

    const rolledOut = await admin.featureFlags.setRollout(staff, {
      flagId,
      percentage: 25,
      changedBy: "staff-1",
      tenantId: "tenant-1",
    });
    expect(rolledOut.status).toBe(200);
    expect((rolledOut.body as { rolloutPercentage: number }).rolloutPercentage).toBe(25);

    const ruled = await admin.featureFlags.addRule(staff, {
      flagId,
      type: "tenant",
      values: ["tenant-1"],
      enabled: true,
      changedBy: "staff-1",
      tenantId: "tenant-1",
    });
    expect(ruled.status).toBe(200);

    const overridden = await admin.featureFlags.setEnvironmentOverride(staff, {
      flagId,
      environment: "staging",
      enabled: true,
      changedBy: "staff-1",
      tenantId: "tenant-1",
    });
    expect(overridden.status).toBe(200);

    const killed = await admin.featureFlags.advance(staff, {
      flagId,
      toStatus: "killed",
      changedBy: "staff-1",
      tenantId: "tenant-1",
    });
    expect(killed.status).toBe(200);
    expect((killed.body as { status: string }).status).toBe("killed");
  });

  it("drives the Reporting screen through report-definition create/advance/generate and dashboard create/advance", async () => {
    const admin = wire();

    const definition = await admin.reporting.createReportDefinition(staff, {
      name: "Weekly revenue",
      type: "table",
      metricRefs: ["revenue"],
    });
    expect(definition.status).toBe(201);
    const reportDefinitionId = (definition.body as { reportDefinitionId: string })
      .reportDefinitionId;

    const activated = await admin.reporting.advanceReportDefinition(staff, {
      reportDefinitionId,
      toStatus: "active",
    });
    expect(activated.status).toBe(200);

    const generated = await admin.reporting.generateReport(staff, { reportDefinitionId });
    expect(generated.status).toBe(200);

    const dashboard = await admin.reporting.createDashboard(staff, {
      name: "Executive overview",
      tileRefs: ["revenue-tile"],
    });
    expect(dashboard.status).toBe(201);
    const dashboardId = (dashboard.body as { dashboardId: string }).dashboardId;

    const archived = await admin.reporting.advanceDashboard(staff, {
      dashboardId,
      toStatus: "archived",
    });
    expect(archived.status).toBe(200);
    expect((archived.body as { status: string }).status).toBe("archived");
  });

  it("drives the Reviews screen through create, vote, report, respond, moderate, and advance", async () => {
    const admin = wire();

    const created = await admin.reviews.create(staff, {
      productRef: "product-1",
      customerRef: "customer-1",
      rating: 5,
      bodyText: "Great toy, sturdy build.",
      tenantId: "tenant-1",
    });
    expect(created.status).toBe(201);
    const reviewId = (created.body as { reviewId: string }).reviewId;

    const voted = await admin.reviews.vote(staff, {
      reviewId,
      customerRef: "customer-2",
      helpful: true,
      tenantId: "tenant-1",
    });
    expect(voted.status).toBe(200);

    const reported = await admin.reviews.report(staff, {
      reviewId,
      reporterRef: "customer-3",
      tenantId: "tenant-1",
    });
    expect(reported.status).toBe(200);

    const responded = await admin.reviews.respond(staff, {
      reviewId,
      responseText: "Thanks for the feedback!",
      tenantId: "tenant-1",
    });
    expect(responded.status).toBe(200);

    const published = await admin.reviews.advance(staff, {
      reviewId,
      toStatus: "published",
      tenantId: "tenant-1",
    });
    expect(published.status).toBe(200);

    const moderated = await admin.reviews.moderate(staff, {
      reviewId,
      actionId: "action-1",
      action: "flag",
      moderatorRef: "moderator-1",
      tenantId: "tenant-1",
    });
    expect(moderated.status).toBe(200);
    expect((moderated.body as { duplicate: boolean }).duplicate).toBe(false);
  });

  it("drives the Loyalty screen through open, earn, spend, cashback, redeem, referral, and advance", async () => {
    const admin = wire();

    const opened = await admin.loyalty.open(staff, {
      customerRef: "customer-1",
      tenantId: "tenant-1",
    });
    expect(opened.status).toBe(201);
    const accountId = (opened.body as { accountId: string }).accountId;

    const earned = await admin.loyalty.earn(staff, {
      accountId,
      idempotencyKey: "earn-1",
      points: 1000,
      ref: "order-1",
      tenantId: "tenant-1",
    });
    expect(earned.status).toBe(200);
    expect((earned.body as { balance: number }).balance).toBe(1000);

    const spent = await admin.loyalty.spend(staff, {
      accountId,
      idempotencyKey: "spend-1",
      points: 200,
      ref: "redemption-1",
      tenantId: "tenant-1",
    });
    expect(spent.status).toBe(200);
    expect((spent.body as { balance: number }).balance).toBe(800);

    const cashback = await admin.loyalty.cashback(staff, {
      accountId,
      idempotencyKey: "cashback-1",
      points: 50,
      ref: "order-2",
      tenantId: "tenant-1",
    });
    expect(cashback.status).toBe(200);

    const redeemed = await admin.loyalty.redeem(staff, {
      accountId,
      idempotencyKey: "redeem-1",
      rewardRef: "reward-1",
      rewardName: "$10 off",
      costPoints: 500,
      tenantId: "tenant-1",
    });
    expect(redeemed.status).toBe(200);

    const referral = await admin.loyalty.referral(staff, {
      accountId,
      idempotencyKey: "referral-1",
      bonusPoints: 100,
      referredCustomerRef: "customer-2",
      tenantId: "tenant-1",
    });
    expect(referral.status).toBe(200);

    const suspended = await admin.loyalty.advance(staff, {
      accountId,
      toStatus: "suspended",
      tenantId: "tenant-1",
    });
    expect(suspended.status).toBe(200);
    expect((suspended.body as { status: string }).status).toBe("suspended");
  });

  it("drives the Analytics screen through the read-only semantic-layer catalog", async () => {
    const admin = wire();

    const metrics = await admin.analytics.listMetrics(staff);
    expect(metrics.status).toBe(200);
    expect(
      (metrics.body as readonly { id: { value: string } }[]).some(
        (m) => m.id.value === "finance.revenue",
      ),
    ).toBe(true);

    const metric = await admin.analytics.getMetric(staff, { id: "finance.revenue" });
    expect(metric.status).toBe(200);

    const dimensions = await admin.analytics.listDimensions(staff);
    expect(dimensions.status).toBe(200);
    expect(
      (dimensions.body as readonly { id: { value: string } }[]).some(
        (d) => d.id.value === "finance.period",
      ),
    ).toBe(true);

    const dimension = await admin.analytics.getDimension(staff, { id: "finance.period" });
    expect(dimension.status).toBe(200);

    const missing = await admin.analytics.getMetric(staff, { id: "not-a-metric" });
    expect(missing.status).toBe(404);
  });

  it("drives the Search screen through create, upsert/delete document, synonyms, suggestion, log-query, and advance", async () => {
    const admin = wire();

    const created = await admin.search.create(staff, { name: "products", tenantId: "tenant-1" });
    expect(created.status).toBe(201);
    const indexId = (created.body as { indexId: string }).indexId;

    const upserted = await admin.search.upsertDocument(staff, {
      indexId,
      productRef: "product-1",
      title: "Toy Wagon",
      categoryRefs: ["toys"],
      tenantId: "tenant-1",
    });
    expect(upserted.status).toBe(200);
    expect((upserted.body as { documentCount: number }).documentCount).toBe(1);

    const synonymAdded = await admin.search.addSynonym(staff, {
      indexId,
      term: "wagon",
      synonyms: ["cart"],
      tenantId: "tenant-1",
    });
    expect(synonymAdded.status).toBe(200);

    const synonymRemoved = await admin.search.removeSynonym(staff, {
      indexId,
      term: "wagon",
      tenantId: "tenant-1",
    });
    expect(synonymRemoved.status).toBe(200);

    const suggested = await admin.search.addSuggestion(staff, {
      indexId,
      term: "wagon",
      tenantId: "tenant-1",
    });
    expect(suggested.status).toBe(200);

    const logged = await admin.search.logQuery(staff, {
      indexId,
      term: "wagon",
      tenantId: "tenant-1",
    });
    expect(logged.status).toBe(200);

    const deleted = await admin.search.deleteDocument(staff, {
      indexId,
      productRef: "product-1",
      tenantId: "tenant-1",
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as { documentCount: number }).documentCount).toBe(0);

    const disabled = await admin.search.advance(staff, {
      indexId,
      toStatus: "disabled",
      tenantId: "tenant-1",
    });
    expect(disabled.status).toBe(200);
    expect((disabled.body as { status: string }).status).toBe("disabled");
  });

  it("drives the Feature Registry screen through register, requirements, groups, publish, resolve, list, graph, bundles, and validate", async () => {
    const admin = wire();

    const registered = await admin.featureRegistry.register(staff, {
      key: "commerce.new_checkout",
      name: "New Checkout Flow",
      category: "commerce",
      tenantId: "tenant-1",
    });
    expect(registered.status).toBe(201);

    const requirementsSet = await admin.featureRegistry.setRequirements(staff, {
      key: "commerce.new_checkout",
      requirements: { requiredPlans: ["pro"] },
      tenantId: "tenant-1",
    });
    expect(requirementsSet.status).toBe(200);

    const groupsSet = await admin.featureRegistry.setGroups(staff, {
      key: "commerce.new_checkout",
      groups: ["commerce"],
      tenantId: "tenant-1",
    });
    expect(groupsSet.status).toBe(200);

    const published = await admin.featureRegistry.advance(staff, {
      key: "commerce.new_checkout",
      to: "publish",
      tenantId: "tenant-1",
    });
    expect(published.status).toBe(200);
    expect((published.body as { lifecycle: string }).lifecycle).toBe("active");

    const resolved = await admin.featureRegistry.resolve(staff, {
      key: "commerce.new_checkout",
      tenantId: "tenant-1",
    });
    expect(resolved.status).toBe(200);
    expect((resolved.body as { available: boolean }).available).toBe(true);

    const listed = await admin.featureRegistry.list(staff, { tenantId: "tenant-1" });
    expect(listed.status).toBe(200);
    expect(
      (listed.body as { features: readonly { key: string }[] }).features.some(
        (f) => f.key === "commerce.new_checkout",
      ),
    ).toBe(true);

    const graph = await admin.featureRegistry.analyzeGraph(staff, { tenantId: "tenant-1" });
    expect(graph.status).toBe(200);
    expect((graph.body as { acyclic: boolean }).acyclic).toBe(true);

    const bundle = await admin.featureRegistry.createBundle(staff, {
      key: "commerce.pro_pack",
      name: "Pro Pack",
      featureKeys: ["commerce.new_checkout"],
      tenantId: "tenant-1",
    });
    expect(bundle.status).toBe(201);

    const bundleUpdated = await admin.featureRegistry.updateBundle(staff, {
      key: "commerce.pro_pack",
      groups: ["commerce"],
      tenantId: "tenant-1",
    });
    expect(bundleUpdated.status).toBe(200);

    const bundlesListed = await admin.featureRegistry.listBundles(staff, { tenantId: "tenant-1" });
    expect(bundlesListed.status).toBe(200);

    const validated = await admin.featureRegistry.validate(staff, { tenantId: "tenant-1" });
    expect(validated.status).toBe(200);
  });

  it("drives the Security (Identity & Credentials) screen through register, credential lifecycle, machine-identity governance, and resolution", async () => {
    const admin = wire();

    const registered = await admin.securityIdentity.registerPrincipal(staff, {
      externalId: "svc-checkout-worker",
      kind: "service_account",
      displayName: "Checkout Worker",
    });
    expect(registered.status).toBe(201);

    const issued = await admin.securityIdentity.issueCredential(staff, {
      principalExternalId: "svc-checkout-worker",
      kind: "api_key",
      material: "super-secret-material",
    });
    expect(issued.status).toBe(201);
    const credentialId = (issued.body as { id: string }).id;

    const rotated = await admin.securityIdentity.rotateCredential(staff, {
      credentialId,
      newMaterial: "rotated-secret-material",
    });
    expect(rotated.status).toBe(200);
    const rotatedCredentialId = (rotated.body as { id: string }).id;

    const revoked = await admin.securityIdentity.revokeCredential(staff, {
      credentialId: rotatedCredentialId,
    });
    expect(revoked.status).toBe(200);
    expect((revoked.body as { status: string }).status).toBe("revoked");

    const governed = await admin.securityIdentity.governMachineIdentity(staff, {
      principalExternalId: "svc-checkout-worker",
      config: { owner: "commerce-team", purpose: "checkout automation" },
    });
    expect(governed.status).toBe(200);

    const resolvedMachine = await admin.securityIdentity.resolveMachineIdentity(staff, {
      principalExternalId: "svc-checkout-worker",
    });
    expect(resolvedMachine.status).toBe(200);
    expect((resolvedMachine.body as { owner: string }).owner).toBe("commerce-team");

    const suspended = await admin.securityIdentity.suspendMachineIdentity(staff, {
      principalExternalId: "svc-checkout-worker",
    });
    expect(suspended.status).toBe(200);
    expect((suspended.body as { status: string }).status).toBe("suspended");

    const transitioned = await admin.securityIdentity.transitionPrincipal(staff, {
      externalId: "svc-checkout-worker",
      to: "suspended",
    });
    expect(transitioned.status).toBe(200);
    expect((transitioned.body as { status: string }).status).toBe("suspended");

    const overview = await admin.securityIdentity.identityOverview(staff);
    expect(overview.status).toBe(200);

    const explorer = await admin.securityIdentity.machineIdentityExplorer(staff);
    expect(explorer.status).toBe(200);
  });

  it("drives the Security (Sessions & Authentication) screen through MFA, device, risk, and session lifecycles", async () => {
    const admin = wire();

    const principal = await admin.securityIdentity.registerPrincipal(staff, {
      externalId: "svc-sessions-test",
      kind: "service_account",
      displayName: "Sessions Test Worker",
    });
    expect(principal.status).toBe(201);

    const authMethodRegistered = await admin.securitySessions.registerAuthMethod(staff, {
      kind: "password",
      displayName: "Password",
    });
    expect(authMethodRegistered.status).toBe(201);

    const mfaMethodRegistered = await admin.securitySessions.registerMfaMethod(staff, {
      kind: "totp",
      displayName: "Authenticator App",
    });
    expect(mfaMethodRegistered.status).toBe(201);

    const enrolled = await admin.securitySessions.enrollMfa(staff, {
      principalExternalId: "svc-sessions-test",
      method: "totp",
    });
    expect(enrolled.status).toBe(201);
    const enrollmentId = (enrolled.body as { id: string }).id;

    const verified = await admin.securitySessions.verifyMfaEnrollment(staff, {
      enrollmentId,
      code: "123456",
    });
    expect(verified.status).toBe(200);
    expect((verified.body as { status: string }).status).toBe("active");

    const backupCodes = await admin.securitySessions.generateBackupCodes(staff, { enrollmentId });
    expect(backupCodes.status).toBe(200);
    expect((backupCodes.body as { codes: readonly string[] }).codes.length).toBe(10);

    const deviceRegistered = await admin.securitySessions.registerDevice(staff, {
      fingerprint: "device-1",
      principalExternalId: "svc-sessions-test",
    });
    expect(deviceRegistered.status).toBe(201);

    const signalRecorded = await admin.securitySessions.recordDeviceSignal(staff, {
      fingerprint: "device-1",
      type: "new_location",
      severity: "low",
    });
    expect(signalRecorded.status).toBe(200);

    const deviceTrusted = await admin.securitySessions.trustDevice(staff, {
      fingerprint: "device-1",
    });
    expect(deviceTrusted.status).toBe(200);
    expect((deviceTrusted.body as { trustLevel: string }).trustLevel).toBe("trusted");

    const mfaDecided = await admin.securitySessions.decideMfa(staff, {
      principalExternalId: "svc-sessions-test",
      riskBand: "low",
    });
    expect(mfaDecided.status).toBe(200);

    const riskEvaluated = await admin.securitySessions.evaluateRisk(staff, {
      principalExternalId: "svc-sessions-test",
    });
    expect(riskEvaluated.status).toBe(200);

    const established = await admin.securitySessions.establishSession(staff, {
      principalExternalId: "svc-sessions-test",
      refreshFingerprint: "rf-1",
      ttlSeconds: 3600,
    });
    expect(established.status).toBe(201);
    const sessionId = (established.body as { id: string }).id;

    const refreshed = await admin.securitySessions.refreshSession(staff, {
      sessionId,
      newRefreshFingerprint: "rf-2",
      ttlSeconds: 3600,
    });
    expect(refreshed.status).toBe(200);

    const introspected = await admin.securitySessions.introspectSession(staff, { sessionId });
    expect(introspected.status).toBe(200);
    expect((introspected.body as { active: boolean }).active).toBe(true);

    const sessionRevoked = await admin.securitySessions.revokeSession(staff, { sessionId });
    expect(sessionRevoked.status).toBe(200);

    const allRevoked = await admin.securitySessions.revokeAllSessions(staff, {
      principalExternalId: "svc-sessions-test",
    });
    expect(allRevoked.status).toBe(200);

    const mfaRevoked = await admin.securitySessions.revokeMfa(staff, { enrollmentId });
    expect(mfaRevoked.status).toBe(200);

    const deviceBlocked = await admin.securitySessions.blockDevice(staff, {
      fingerprint: "device-1",
    });
    expect(deviceBlocked.status).toBe(200);
    expect((deviceBlocked.body as { trustLevel: string }).trustLevel).toBe("blocked");

    const sessionExplorer = await admin.securitySessions.sessionExplorer(staff);
    expect(sessionExplorer.status).toBe(200);

    const deviceExplorer = await admin.securitySessions.deviceExplorer(staff);
    expect(deviceExplorer.status).toBe(200);

    const riskExplorer = await admin.securitySessions.riskExplorer(staff);
    expect(riskExplorer.status).toBe(200);
  });

  it("drives the Security (Authorization) screen through roles, policies, ReBAC, access checks, delegation, consent, and tenant config", async () => {
    const admin = wire();

    const principal = await admin.securityIdentity.registerPrincipal(staff, {
      externalId: "svc-authz-test",
      kind: "service_account",
      displayName: "Authz Test Worker",
    });
    expect(principal.status).toBe(201);
    const delegate = await admin.securityIdentity.registerPrincipal(staff, {
      externalId: "svc-authz-delegate",
      kind: "service_account",
      displayName: "Authz Test Delegate",
    });
    expect(delegate.status).toBe(201);

    const roleDefined = await admin.securityAuthorization.defineRole(staff, {
      key: "orders-viewer",
      name: "Orders Viewer",
    });
    expect(roleDefined.status).toBe(201);

    const permissionGranted = await admin.securityAuthorization.grantRolePermission(staff, {
      roleKey: "orders-viewer",
      permission: "orders:read",
    });
    expect(permissionGranted.status).toBe(200);
    expect((permissionGranted.body as { permissions: readonly string[] }).permissions).toContain(
      "orders:read",
    );

    const assigned = await admin.securityAuthorization.assignRole(staff, {
      principalExternalId: "svc-authz-test",
      roleKey: "orders-viewer",
      grantedBy: "staff-1",
    });
    expect(assigned.status).toBe(201);
    const assignmentId = (assigned.body as { id: string }).id;

    const policyDefined = await admin.securityAuthorization.definePolicy(staff, {
      key: "default-policy",
      name: "Default Policy",
      mode: "balanced",
    });
    expect(policyDefined.status).toBe(201);

    const versionPublished = await admin.securityAuthorization.publishPolicyVersion(staff, {
      key: "default-policy",
      rules: [{ id: "rule-1", description: "always allow", when: {}, effect: "allow" }],
    });
    expect(versionPublished.status).toBe(200);
    expect((versionPublished.body as { activeVersion: number }).activeVersion).toBe(1);

    const simulated = await admin.securityAuthorization.simulatePolicy(staff, {
      key: "default-policy",
      context: {},
    });
    expect(simulated.status).toBe(200);

    const tupleWritten = await admin.securityAuthorization.writeRelationTuple(staff, {
      namespace: "orders",
      object: "order-1",
      relation: "viewer",
      subject: "svc-authz-test",
    });
    expect(tupleWritten.status).toBe(201);

    const accessChecked = await admin.securityAuthorization.checkAccess(staff, {
      principalExternalId: "svc-authz-test",
      permission: "orders:read",
    });
    expect(accessChecked.status).toBe(200);
    expect((accessChecked.body as { allowed: boolean }).allowed).toBe(true);

    const tupleDeleted = await admin.securityAuthorization.deleteRelationTuple(staff, {
      namespace: "orders",
      object: "order-1",
      relation: "viewer",
      subject: "svc-authz-test",
    });
    expect(tupleDeleted.status).toBe(200);
    expect((tupleDeleted.body as { removed: boolean }).removed).toBe(true);

    const accessEvaluated = await admin.securityAuthorization.evaluateAccess(staff, {
      principalExternalId: "svc-authz-test",
      permission: "orders:read",
      policyKey: "default-policy",
    });
    expect(accessEvaluated.status).toBe(200);
    expect((accessEvaluated.body as { effect: string }).effect).toBe("allow");

    const fragmentRegistered = await admin.securityAuthorization.registerPolicyFragment(staff, {
      key: "always-allow-fragment",
      expression: { leaf: {} },
    });
    expect(fragmentRegistered.status).toBe(201);

    const permissionRegistered = await admin.securityAuthorization.registerPermission(staff, {
      permission: "orders:export",
      description: "Export orders",
    });
    expect(permissionRegistered.status).toBe(201);

    const delegationGranted = await admin.securityAuthorization.grantDelegation(staff, {
      delegatorExternalId: "svc-authz-test",
      delegateExternalId: "svc-authz-delegate",
    });
    expect(delegationGranted.status).toBe(201);
    const delegationId = (delegationGranted.body as { id: string }).id;

    const impersonationStarted = await admin.securityAuthorization.startImpersonation(staff, {
      delegationId,
      refreshFingerprint: "rf-impersonate-1",
      ttlSeconds: 3600,
    });
    expect(impersonationStarted.status).toBe(201);

    const delegationRevoked = await admin.securityAuthorization.revokeDelegation(staff, {
      delegationId,
    });
    expect(delegationRevoked.status).toBe(200);

    const assignmentRevoked = await admin.securityAuthorization.revokeRoleAssignment(staff, {
      assignmentId,
    });
    expect(assignmentRevoked.status).toBe(200);

    const policyArchived = await admin.securityAuthorization.archivePolicy(staff, {
      key: "default-policy",
    });
    expect(policyArchived.status).toBe(200);
    expect((policyArchived.body as { status: string }).status).toBe("archived");

    const consentChecked = await admin.securityAuthorization.checkConsent(staff, {
      subjectRef: "subject-1",
      purpose: "marketing",
    });
    expect(consentChecked.status).toBe(200);
    expect((consentChecked.body as { granted: boolean }).granted).toBe(false);

    const tenantConfigured = await admin.securityAuthorization.configureTenantSecurity(staff, {
      tenantRef: "tenant-1",
      config: { mfaRequired: true },
    });
    expect(tenantConfigured.status).toBe(200);
    expect((tenantConfigured.body as { mfaRequired: boolean }).mfaRequired).toBe(true);

    const permissionExplorer = await admin.securityAuthorization.permissionExplorer(staff);
    expect(permissionExplorer.status).toBe(200);

    const policyExplorer = await admin.securityAuthorization.policyExplorer(staff);
    expect(policyExplorer.status).toBe(200);

    const registryExplorer = await admin.securityAuthorization.registryExplorer(staff);
    expect(registryExplorer.status).toBe(200);
  });

  it("drives the Security (Secrets) screen through rotation scheduling, due-rotation, emergency revoke, and lineage", async () => {
    const admin = wire();

    const principal = await admin.securityIdentity.registerPrincipal(staff, {
      externalId: "svc-secrets-test",
      kind: "service_account",
      displayName: "Secrets Test Worker",
    });
    expect(principal.status).toBe(201);

    const issued = await admin.securityIdentity.issueCredential(staff, {
      principalExternalId: "svc-secrets-test",
      kind: "api_key",
      material: "initial-secret-material",
    });
    expect(issued.status).toBe(201);
    const credentialId = (issued.body as { id: string }).id;

    const scheduled = await admin.securitySecrets.scheduleCredentialRotation(staff, {
      credentialId,
      intervalDays: 90,
      graceSeconds: 3600,
    });
    expect(scheduled.status).toBe(200);
    expect((scheduled.body as { rotationDueAt: string | null }).rotationDueAt).not.toBeNull();

    const dueRotated = await admin.securitySecrets.rotateDueCredentials(staff);
    expect(dueRotated.status).toBe(200);
    expect((dueRotated.body as { rotated: number }).rotated).toBe(0);

    const lineage = await admin.securitySecrets.getCredentialLineage(staff, { credentialId });
    expect(lineage.status).toBe(200);
    expect((lineage.body as { chain: readonly { id: string }[] }).chain).toHaveLength(1);

    const emergencyRevoked = await admin.securitySecrets.emergencyRevokeCredentials(staff, {
      principalExternalId: "svc-secrets-test",
      reason: "suspected leak",
    });
    expect(emergencyRevoked.status).toBe(200);
    expect((emergencyRevoked.body as { revoked: number }).revoked).toBe(1);

    const secretExplorer = await admin.securitySecrets.secretExplorer(staff);
    expect(secretExplorer.status).toBe(200);
  });

  it("drives the Security (Security Operations) screen through incident lifecycle, threat check, audit-chain, and compliance", async () => {
    const admin = wire();

    const opened = await admin.securityOperations.openIncident(staff, {
      title: "Suspicious login pattern",
      severity: "high",
      category: "account_takeover",
      reference: "INC-TEST-1",
    });
    expect(opened.status).toBe(201);

    const triaged = await admin.securityOperations.triageIncident(staff, {
      reference: "INC-TEST-1",
      assignee: "staff-1",
      note: "Investigating",
    });
    expect(triaged.status).toBe(200);
    expect((triaged.body as { status: string }).status).toBe("triaged");

    const mitigated = await admin.securityOperations.mitigateIncident(staff, {
      reference: "INC-TEST-1",
      note: "Blocked offending IPs",
    });
    expect(mitigated.status).toBe(200);

    const evidenceAdded = await admin.securityOperations.addIncidentEvidence(staff, {
      reference: "INC-TEST-1",
      kind: "audit_record",
      ref: "audit-1",
    });
    expect(evidenceAdded.status).toBe(200);
    expect((evidenceAdded.body as { evidenceCount: number }).evidenceCount).toBe(1);

    const resolved = await admin.securityOperations.resolveIncident(staff, {
      reference: "INC-TEST-1",
      resolution: "Accounts secured, no data loss",
    });
    expect(resolved.status).toBe(200);

    const closed = await admin.securityOperations.closeIncident(staff, {
      reference: "INC-TEST-1",
      note: "Post-mortem complete",
    });
    expect(closed.status).toBe(200);
    expect((closed.body as { status: string }).status).toBe("closed");

    const threatChecked = await admin.securityOperations.checkThreatIndicator(staff, {
      indicator: "203.0.113.1",
    });
    expect(threatChecked.status).toBe(200);

    const auditVerified = await admin.securityOperations.verifyAuditChain(staff, {
      tenantRef: null,
    });
    expect(auditVerified.status).toBe(200);
    expect((auditVerified.body as { valid: boolean }).valid).toBe(true);

    const complianceEvaluated = await admin.securityOperations.evaluateCompliance(staff, {
      framework: "soc2",
    });
    expect(complianceEvaluated.status).toBe(200);
    expect((complianceEvaluated.body as { framework: string }).framework).toBe("soc2");

    const ruleRegistered = await admin.securityOperations.registerComplianceRule(staff, {
      id: "custom-control-1",
      framework: "soc2",
      description: "Custom control",
      severity: "medium",
    });
    expect(ruleRegistered.status).toBe(201);

    const incidentExplorer = await admin.securityOperations.incidentExplorer(staff);
    expect(incidentExplorer.status).toBe(200);

    const auditExplorer = await admin.securityOperations.auditExplorer(staff);
    expect(auditExplorer.status).toBe(200);

    const dashboard = await admin.securityOperations.securityDashboard(staff);
    expect(dashboard.status).toBe(200);

    const trustCenter = await admin.securityOperations.trustCenter(staff);
    expect(trustCenter.status).toBe(200);

    const analytics = await admin.securityOperations.securityAnalytics(staff);
    expect(analytics.status).toBe(200);
  });

  it("drives the Security (AI Governance) screen through govern, check-action (allow and deny), suspend, and the explorer", async () => {
    const admin = wire();

    const principal = await admin.securityIdentity.registerPrincipal(staff, {
      externalId: "ai-copywriter",
      kind: "ai",
      displayName: "AI Copywriter",
    });
    expect(principal.status).toBe(201);

    const governed = await admin.securityAiGovernance.governAiIdentity(staff, {
      principalExternalId: "ai-copywriter",
      config: {
        tokenBudget: 1000,
        callQuota: 10,
        allowedTools: ["draft_copy"],
        isolationLevel: "sandboxed",
      },
    });
    expect(governed.status).toBe(200);
    expect((governed.body as { isolationLevel: string }).isolationLevel).toBe("sandboxed");

    const allowedCheck = await admin.securityAiGovernance.checkAiAction(staff, {
      principalExternalId: "ai-copywriter",
      tool: "draft_copy",
      tokens: 100,
    });
    expect(allowedCheck.status).toBe(200);
    expect((allowedCheck.body as { allowed: boolean }).allowed).toBe(true);
    expect((allowedCheck.body as { remainingTokens: number | null }).remainingTokens).toBe(900);

    const deniedCheck = await admin.securityAiGovernance.checkAiAction(staff, {
      principalExternalId: "ai-copywriter",
      tool: "delete_database",
    });
    expect(deniedCheck.status).toBe(200);
    expect((deniedCheck.body as { allowed: boolean }).allowed).toBe(false);

    const suspended = await admin.securityAiGovernance.suspendAiIdentity(staff, {
      principalExternalId: "ai-copywriter",
    });
    expect(suspended.status).toBe(200);
    expect((suspended.body as { status: string }).status).toBe("suspended");

    const explorer = await admin.securityAiGovernance.aiGovernanceExplorer(staff);
    expect(explorer.status).toBe(200);
  });

  it("drives the Wishlist screen through create, add-item, share-item, move-to-cart, remove-item, and advance", async () => {
    const admin = wire();

    const created = await admin.wishlist.create(staff, {
      customerRef: "customer-1",
      tenantId: "tenant-1",
    });
    expect(created.status).toBe(201);
    const wishlistId = (created.body as { wishlistId: string }).wishlistId;

    const added = await admin.wishlist.addItem(staff, {
      wishlistId,
      productRef: "product-1",
      tenantId: "tenant-1",
    });
    expect(added.status).toBe(200);
    expect((added.body as { itemCount: number }).itemCount).toBe(1);

    const shared = await admin.wishlist.shareItem(staff, {
      wishlistId,
      productRef: "product-1",
      tenantId: "tenant-1",
    });
    expect(shared.status).toBe(200);
    expect((shared.body as { shareToken: string }).shareToken).toBeTruthy();

    const moved = await admin.wishlist.moveItemToCart(staff, {
      wishlistId,
      productRef: "product-1",
      tenantId: "tenant-1",
    });
    expect(moved.status).toBe(200);
    expect((moved.body as { itemCount: number }).itemCount).toBe(0);

    const readded = await admin.wishlist.addItem(staff, {
      wishlistId,
      productRef: "product-2",
      tenantId: "tenant-1",
    });
    expect(readded.status).toBe(200);
    const removed = await admin.wishlist.removeItem(staff, {
      wishlistId,
      productRef: "product-2",
      tenantId: "tenant-1",
    });
    expect(removed.status).toBe(200);
    expect((removed.body as { itemCount: number }).itemCount).toBe(0);

    const archived = await admin.wishlist.advance(staff, {
      wishlistId,
      toStatus: "archived",
      tenantId: "tenant-1",
    });
    expect(archived.status).toBe(200);
    expect((archived.body as { status: string }).status).toBe("archived");
  });

  it("drives the Customer 360 screen through profile, identity-timeline, journey-timeline, and journey-state reads", async () => {
    const admin = wire();

    const profile = await admin.customer360.getProfile(staff, {
      identifierType: "customer_id",
      identifierValue: "customer-1",
      tenantId: "tenant-1",
    });
    expect(profile.status).toBe(200);
    expect((profile.body as { profile: unknown }).profile).toBeNull();

    const identityTimeline = await admin.customer360.getIdentityTimeline(staff, {
      identifierType: "customer_id",
      identifierValue: "customer-1",
      tenantId: "tenant-1",
    });
    expect(identityTimeline.status).toBe(200);

    const journeyTimeline = await admin.customer360.getJourneyTimeline(staff, {
      visitorId: "visitor-1",
      tenantId: "tenant-1",
    });
    expect(journeyTimeline.status).toBe(200);

    const journeyState = await admin.customer360.getJourneyState(staff, {
      visitorId: "visitor-1",
      tenantId: "tenant-1",
    });
    expect(journeyState.status).toBe(200);
  });

  it("denies an action with 403 when the access control refuses the permission", async () => {
    const admin = wireAdmin({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
      accessControl: { authorize: async () => false },
    });

    const response = await admin.orders.refundOrder(staff, { orderId: "o-1" });

    expect(response.status).toBe(403);
    expect((response.body as { code: string }).code).toBe("FORBIDDEN");
  });

  it("records every authorization decision on the immutable audit trail", async () => {
    const auditTrail = new InMemoryAuditTrail();
    const admin = wireAdmin({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
      accessControl: { authorize: async (_p, permission) => permission !== "orders:refund" },
      auditTrail,
    });

    await admin.products.createCategory(staff, {
      name: "Wagons",
      slug: "wagons",
      tenantId: "tenant-1",
    });
    await admin.orders.refundOrder(staff, { orderId: "o-1" });

    expect(auditTrail.snapshot()).toEqual([
      {
        principalId: "staff-1",
        principalKind: "staff",
        permission: "categories:create",
        decision: "allow",
        occurredAt: "2026-06-30T00:00:00.000Z",
      },
      {
        principalId: "staff-1",
        principalKind: "staff",
        permission: "orders:refund",
        decision: "deny",
        occurredAt: "2026-06-30T00:00:00.000Z",
      },
    ]);
  });
});
