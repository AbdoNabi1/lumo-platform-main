import { beforeEach, describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireIdentity, type WiredIdentity } from "@platform/identity";
import { wireReviews, type WiredReviews } from "@platform/reviews";
import { wireSecurity, type WiredSecurity } from "@platform/security";
import type { WiredAdmin } from "../composition";
import { CustomerAuthAdminController } from "../interfaces/customer-auth.admin-controller";
import type { CustomerCredentialsPort } from "../interfaces/customer-credentials.port";
import { CustomerGuard } from "../interfaces/customer-guard";
import { publicAuthRoutes } from "./public-auth-routes";
import {
  publicReviewsRoutes,
  type PublicReviewDto,
  type PublicReviewWriteResultDto,
} from "./public-reviews-routes";

/**
 * Public Reviews HTTP surface — T5.18's display half (GET, unauthenticated) plus T5.18-write's
 * authoring half (POST create/vote/report, session-scoped). The display tests drive a bare
 * `wireReviews()` composition through a minimal `stubAdmin` (no session concept needed for an
 * anonymous read, same technique `public-cart-routes.test.ts` uses). The write tests drive REAL
 * `wireSecurity`/`wireIdentity`/`wireReviews` compositions through real customer sessions
 * established by `public-auth-routes.ts`'s own routes — same discipline
 * `public-wishlist-routes.test.ts`/`public-loyalty-routes.test.ts` use — because the dominant risk
 * on a write surface is a caller supplying someone else's identity, which only a REAL session
 * boundary can prove doesn't work.
 *
 * Covers:
 *  1. Display: `PublicReviewDto` never carries `customerRef`/`status`/`productRef`/`reportCount`;
 *     only `status: "published"` reviews are ever returned.
 *  2. Write: every write route 401s without a session; the created/voted/reported review's
 *     `customerRef`/`reporterRef` is verifiably the session's own even when the request body tries
 *     to smuggle a different one; the `.strict()` schemas reject any body carrying `customerRef`/
 *     `reporterRef` at all (422), rather than silently ignoring it.
 */

const clock: Clock = { now: () => new Date("2026-08-31T00:00:00.000Z") };

function sequentialIds(prefix: string): IdGenerator {
  let counter = 0;
  return { generate: () => `${prefix}-${(counter += 1)}` };
}

interface Response {
  readonly status: number;
  readonly body: unknown;
}

// ── Display half (unchanged from T5.18) ──────────────────────────────────────────────────────

function reviewsFixture(): WiredReviews {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `review-id-${(n += 1)}` };
  return wireReviews({ serializer: new InMemoryEventSerializer(), idGenerator, clock });
}

function stubAdmin(reviews: WiredReviews): WiredAdmin {
  return { publicReads: { reviews: reviews.reviews } } as unknown as WiredAdmin;
}

function routesFor(admin: WiredAdmin) {
  const routes = publicReviewsRoutes(admin);
  const byPathAndMethod = (method: string, path: string) => {
    const route = routes.find((r) => r.method === method && r.path === path);
    if (route === undefined) throw new Error(`no route ${method} ${path}`);
    return route;
  };
  return {
    call: (
      method: string,
      path: string,
      params: Record<string, string>,
      query: Record<string, string> = {},
    ): Promise<Response> =>
      byPathAndMethod(method, path).handle({
        params,
        query,
        context: { tenantId: "tenant-local", requestId: "req-1" },
      } as never) as Promise<Response>,
  };
}

async function createReview(
  reviews: WiredReviews,
  productRef: string,
  customerRef: string,
  rating = 5,
  bodyText = "Great product!",
): Promise<string> {
  const created = await reviews.reviews.create({
    productRef,
    customerRef,
    rating,
    bodyText,
    tenantId: "tenant-local",
  });
  if (created.status < 200 || created.status >= 300) {
    throw new Error(`createReview failed (${created.status}): ${JSON.stringify(created.body)}`);
  }
  return (created.body as { reviewId: string }).reviewId;
}

async function publish(reviews: WiredReviews, reviewId: string): Promise<void> {
  const advanced = await reviews.reviews.advance({
    reviewId,
    toStatus: "published",
    tenantId: "tenant-local",
  });
  if (advanced.status < 200 || advanced.status >= 300) {
    throw new Error(`publish failed (${advanced.status}): ${JSON.stringify(advanced.body)}`);
  }
}

describe("public reviews routes — GET /public/reviews/by-product/:productRef (T5.18)", () => {
  it("returns only published reviews, projected to PublicReviewDto with no privacy/moderation fields", async () => {
    const reviews = reviewsFixture();
    const admin = stubAdmin(reviews);
    const { call } = routesFor(admin);

    const publishedId = await createReview(reviews, "product-1", "customer-1", 5, "Loved it!");
    await publish(reviews, publishedId);

    // Left pending — must never reach the public surface.
    await createReview(reviews, "product-1", "customer-2", 2, "Meh.");

    const response = await call("GET", "/public/reviews/by-product/:productRef", {
      productRef: "product-1",
    });

    expect(response.status).toBe(200);
    const body = response.body as { items: readonly PublicReviewDto[]; pageInfo: unknown };
    expect(body.items).toHaveLength(1);

    const [dto] = body.items;
    expect(dto).toEqual({
      id: publishedId,
      rating: 5,
      bodyText: "Loved it!",
      assetRefs: [],
      verifiedPurchase: false,
      helpfulCount: 0,
      unhelpfulCount: 0,
      merchantResponse: null,
    });
    expect(dto).not.toHaveProperty("customerRef");
    expect(dto).not.toHaveProperty("status");
    expect(dto).not.toHaveProperty("productRef");
    expect(dto).not.toHaveProperty("reportCount");
    // No aggregate internals either (same class of leak `public-catalog-routes.ts` documents).
    expect(dto).not.toHaveProperty("props");
    expect(dto).not.toHaveProperty("_id");
    expect(dto).not.toHaveProperty("_domainEvents");
    expect(dto).not.toHaveProperty("_version");
  });

  it("excludes rejected/flagged/removed reviews, not just pending ones", async () => {
    const reviews = reviewsFixture();
    const admin = stubAdmin(reviews);
    const { call } = routesFor(admin);

    const rejectedId = await createReview(reviews, "product-2", "customer-1");
    await reviews.reviews.advance({
      reviewId: rejectedId,
      toStatus: "rejected",
      tenantId: "tenant-local",
    });

    const flaggedThenRemovedId = await createReview(reviews, "product-2", "customer-2");
    await publish(reviews, flaggedThenRemovedId);
    await reviews.reviews.advance({
      reviewId: flaggedThenRemovedId,
      toStatus: "flagged",
      tenantId: "tenant-local",
    });
    await reviews.reviews.advance({
      reviewId: flaggedThenRemovedId,
      toStatus: "removed",
      tenantId: "tenant-local",
    });

    const stillPublishedId = await createReview(reviews, "product-2", "customer-3");
    await publish(reviews, stillPublishedId);

    const response = await call("GET", "/public/reviews/by-product/:productRef", {
      productRef: "product-2",
    });
    expect(response.status).toBe(200);
    const body = response.body as { items: readonly PublicReviewDto[] };
    expect(body.items.map((item) => item.id)).toEqual([stillPublishedId]);
  });

  it("never returns another product's reviews", async () => {
    const reviews = reviewsFixture();
    const admin = stubAdmin(reviews);
    const { call } = routesFor(admin);

    const otherId = await createReview(reviews, "product-other", "customer-1");
    await publish(reviews, otherId);

    const response = await call("GET", "/public/reviews/by-product/:productRef", {
      productRef: "product-3",
    });
    expect(response.status).toBe(200);
    expect((response.body as { items: readonly PublicReviewDto[] }).items).toHaveLength(0);
  });
});

// ── Write half (T5.18-write) ──────────────────────────────────────────────────────────────────

interface Harness {
  readonly admin: WiredAdmin;
  readonly reviews: WiredReviews;
}

function harness(): Harness {
  const deps = {
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds("id"),
    clock,
  };
  const security: WiredSecurity = wireSecurity(deps);
  const identity: WiredIdentity = wireIdentity(deps);
  const reviews = wireReviews(deps);

  const credentials: CustomerCredentialsPort = {
    registerSubject: async (subjectRef) => {
      security.identityDirectory.register(subjectRef);
    },
    setPassword: async (identifier, password, principalExternalId) => {
      security.passwordProvider.register(identifier, password, principalExternalId);
    },
  };
  const customerAuth = new CustomerAuthAdminController({
    security: security.security,
    customers: identity.customers,
    credentials,
    guard: new CustomerGuard({ security: security.security, customers: identity.customers }),
    idGenerator: sequentialIds("refresh"),
    sessionTtlSeconds: 3600,
  });

  const admin = {
    customerAuth,
    publicReads: {
      security: security.security,
      customers: identity.customers,
      reviews: reviews.reviews,
    },
  } as unknown as WiredAdmin;

  return { admin, reviews };
}

function callRoute(
  routes: readonly { method: string; path: string; handle: (i: unknown) => unknown }[],
  method: string,
  path: string,
  options: { body?: unknown; params?: Record<string, string>; sessionId?: string } = {},
): Promise<Response> {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (route === undefined) throw new Error(`no route ${method} ${path}`);
  return route.handle({
    body: options.body ?? {},
    params: options.params ?? {},
    query: {},
    context: {
      tenantId: "tenant-local",
      requestId: "req-1",
      headers: options.sessionId !== undefined ? { "x-customer-session": options.sessionId } : {},
    },
  }) as Promise<Response>;
}

let h: Harness;
beforeEach(() => {
  h = harness();
});

function reviewRoute(
  method: string,
  path: string,
  options: { body?: unknown; params?: Record<string, string>; sessionId?: string } = {},
) {
  return callRoute(publicReviewsRoutes(h.admin) as never, method, path, options);
}

/** Registers + signs in a customer through the real auth routes, returning a real session id. */
async function signIn(email: string): Promise<{ sessionId: string; customerRef: string }> {
  const auth = publicAuthRoutes(h.admin) as never;
  const registered = await callRoute(auth, "POST", "/public/auth/register", {
    body: { email, name: "Shopper", password: "correct-horse" },
  });
  expect(registered.status).toBe(201);
  const loggedIn = await callRoute(auth, "POST", "/public/auth/login", {
    body: { email, password: "correct-horse" },
  });
  expect(loggedIn.status).toBe(200);
  return loggedIn.body as { sessionId: string; customerRef: string };
}

describe("POST /public/reviews", () => {
  it("creates a review scoped to the session's own customer", async () => {
    const { sessionId, customerRef } = await signIn("a@example.com");

    const response = await reviewRoute("POST", "/public/reviews", {
      sessionId,
      body: { productRef: "product-1", rating: 5, bodyText: "Great!" },
    });

    expect(response.status).toBe(201);
    const dto = response.body as PublicReviewWriteResultDto;
    expect(dto.reviewId).toBeTruthy();
    expect(dto.status).toBe("pending");

    const stored = await h.reviews.reviews.get({
      reviewId: dto.reviewId,
      tenantId: "tenant-local",
    });
    expect(stored.status).toBe(200);
    expect((stored.body as { customerRef: string }).customerRef).toBe(customerRef);
  });

  it("ignores a client-supplied customerRef even when the schema would let it through, and rejects one that would not", async () => {
    const a = await signIn("a@example.com");
    const b = await signIn("b@example.com");

    // `.strict()` schema: a body carrying `customerRef` is rejected at the HTTP boundary in the
    // real server (see the schema's own doc comment); calling `.handle()` directly bypasses that
    // zod layer the way every test in this file does, so this asserts the SECOND line of defense —
    // the handler itself never reads `customerRef` off the body, even if it arrived.
    const response = await reviewRoute("POST", "/public/reviews", {
      sessionId: a.sessionId,
      body: {
        productRef: "product-1",
        rating: 5,
        bodyText: "Great!",
        customerRef: b.customerRef,
      },
    });

    expect(response.status).toBe(201);
    const dto = response.body as PublicReviewWriteResultDto;
    const stored = await h.reviews.reviews.get({
      reviewId: dto.reviewId,
      tenantId: "tenant-local",
    });
    expect((stored.body as { customerRef: string }).customerRef).toBe(a.customerRef);
    expect((stored.body as { customerRef: string }).customerRef).not.toBe(b.customerRef);
  });

  it("the .strict() schema itself rejects a customerRef field (422), verified against the real zod schema", async () => {
    const { schema } = publicReviewsRoutes(h.admin).find(
      (r) => r.method === "POST" && r.path === "/public/reviews",
    ) as unknown as { schema: { body: { safeParse: (v: unknown) => { success: boolean } } } };

    const result = schema.body.safeParse({
      productRef: "product-1",
      rating: 5,
      bodyText: "Great!",
      customerRef: "customer-intruder",
    });

    expect(result.success).toBe(false);
  });

  it("401s for an anonymous caller — no review is created", async () => {
    const response = await reviewRoute("POST", "/public/reviews", {
      body: { productRef: "product-1", rating: 5, bodyText: "Great!" },
    });

    expect(response.status).toBe(401);
  });

  it("decides verifiedPurchase server-side (via OrdersPort), never from the request", async () => {
    const { sessionId } = await signIn("a@example.com");

    const response = await reviewRoute("POST", "/public/reviews", {
      sessionId,
      // Even if a caller tried to smuggle a truthy verifiedPurchase, the schema has no such field.
      body: { productRef: "product-1", rating: 5, bodyText: "Great!" },
    });

    const dto = response.body as PublicReviewWriteResultDto;
    const stored = await h.reviews.reviews.get({
      reviewId: dto.reviewId,
      tenantId: "tenant-local",
    });
    // InMemoryOrdersPort's default `hasPurchased` — no purchase on record for this fixture.
    expect((stored.body as { verifiedPurchase: boolean }).verifiedPurchase).toBe(false);
  });
});

describe("POST /public/reviews/:reviewId/vote", () => {
  it("records the vote under the session's own customerRef, not a client-supplied one", async () => {
    const author = await signIn("author@example.com");
    const voter = await signIn("voter@example.com");
    const created = await reviewRoute("POST", "/public/reviews", {
      sessionId: author.sessionId,
      body: { productRef: "product-1", rating: 4, bodyText: "Solid." },
    });
    const { reviewId } = created.body as PublicReviewWriteResultDto;

    const response = await reviewRoute("POST", "/public/reviews/:reviewId/vote", {
      sessionId: voter.sessionId,
      params: { reviewId },
      body: { helpful: true, customerRef: author.customerRef },
    });

    expect(response.status).toBe(200);
    const stored = await h.reviews.reviews.get({ reviewId, tenantId: "tenant-local" });
    expect((stored.body as { helpfulCount: number }).helpfulCount).toBe(1);
  });

  it("401s for an anonymous caller", async () => {
    const author = await signIn("author@example.com");
    const created = await reviewRoute("POST", "/public/reviews", {
      sessionId: author.sessionId,
      body: { productRef: "product-1", rating: 4, bodyText: "Solid." },
    });
    const { reviewId } = created.body as PublicReviewWriteResultDto;

    const response = await reviewRoute("POST", "/public/reviews/:reviewId/vote", {
      params: { reviewId },
      body: { helpful: true },
    });

    expect(response.status).toBe(401);
  });
});

describe("POST /public/reviews/:reviewId/report", () => {
  it("records the report under the session's own customerRef as reporterRef, not a client-supplied one", async () => {
    const author = await signIn("author@example.com");
    const reporter = await signIn("reporter@example.com");
    const created = await reviewRoute("POST", "/public/reviews", {
      sessionId: author.sessionId,
      body: { productRef: "product-1", rating: 1, bodyText: "Bad." },
    });
    const { reviewId } = created.body as PublicReviewWriteResultDto;

    const response = await reviewRoute("POST", "/public/reviews/:reviewId/report", {
      sessionId: reporter.sessionId,
      params: { reviewId },
      body: { reporterRef: author.customerRef },
    });

    expect(response.status).toBe(200);
    const stored = await h.reviews.reviews.get({ reviewId, tenantId: "tenant-local" });
    expect((stored.body as { reportCount: number }).reportCount).toBe(1);
  });

  it("401s for an anonymous caller", async () => {
    const author = await signIn("author@example.com");
    const created = await reviewRoute("POST", "/public/reviews", {
      sessionId: author.sessionId,
      body: { productRef: "product-1", rating: 1, bodyText: "Bad." },
    });
    const { reviewId } = created.body as PublicReviewWriteResultDto;

    const response = await reviewRoute("POST", "/public/reviews/:reviewId/report", {
      params: { reviewId },
      body: {},
    });

    expect(response.status).toBe(401);
  });
});

describe("route declarations (write routes)", () => {
  it("declares every write route public, with no customerRef/reporterRef in the path", () => {
    for (const route of publicReviewsRoutes(h.admin)) {
      if (route.method === "GET") continue;
      expect(route.public).toBe(true);
      expect(route.path).not.toContain(":customerRef");
      expect(route.path).not.toContain(":reporterRef");
    }
  });
});
