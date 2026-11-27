# Local Carriers — Part 1: Carrier Foundation and Bosta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Plan review (Tasks 3–14):** Sol: VERDICT: AGREED (round 3, plan-review-3.md) · OPUS: AGREED (2026-11-16). Cleared for Phase 3 delegation.

**Goal:** A merchant connects their Bosta account once. From then on they can ship one order or up to 50 in one click with a server-computed COD amount, and print waybills (A6 or A4, Arabic or English) from Morbeh. Shipment and fulfillment statuses then follow Bosta's webhooks on their own, and a shipment can be cancelled before pickup.

**Architecture:**

- `services/shipping` gains the carrier foundation, mirroring payments:
  - a `CarrierRegistry` of `CarrierRegistration`s;
  - a per-call `TenantCarrierResolver`;
  - `MerchantCarrierSettings` in a new RLS table `shipping.merchant_carrier_settings`;
  - an envelope-encrypted `CarrierCredentialVault` under its own KEK.

  It also gains a durable **pending** label attempt in `CreateLabel`, so a lost Bosta response never creates a second delivery. Further additions are `CancelCarrierShipment`, `PrintCarrierAwbs`, a Prisma processed-webhook store, and a `RecordCarrierWebhook` that adds scans and walks skipped steps.

- `services/fulfillment` gains additive transitions and four carrier use cases: prepare, attach, detach and mirror.
- `packages/carrier-bosta` is a raw-REST client plus a `BostaCarrierProvider`. The provider _structurally_ implements shipping's `CarrierProvider`, so the package depends on no service. It also holds the Egyptian address, phone and name rules, a state map and a webhook parser.
- `apps/admin` adds:
  - the `ShipOrderWithCarrier` orchestrator, which crosses orders, payments, fulfillment and shipping through adapters;
  - the carrier settings, shipping, AWB and cancel routes;
  - the public Bosta webhook route.

  `apps/runtime` composes Bosta only when both `SHIPPING_CREDENTIALS_KEK_REF` and `ADMIN_API_PUBLIC_URL` are set. `admin-web` adds the Carriers card, the order-page carrier card with its timeline, a new orders-list selection bar, and a PDF proxy.

**Tech Stack:** TypeScript, zod routes on `@platform/http` (Fastify), Prisma 6 (one hand-written additive migration, never applied), `@platform/secrets` envelope encryption, Vitest, Next.js 15 App Router + React 19 (admin-web), `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-11-12-local-carriers-design.md`. §9a amends §6–§8 and wins every conflict. The builder-check questions it answers are in `.superpowers/builder-check-carriers.md` (local only, never staged). Read the spec and this plan together.

The branch `morbeh/local-carriers` is at `10181339` (the spec commit). Where this plan and the spec differ, the Bosta API reference and the code on this branch are the ground truth, and a Ruling below says so.

---

## Plan review amendments for Tasks 3–14 (Opus, 2026-11-16)

Tasks 1–2 are complete (747cc9c5, e6ac19ed, 6ed5e117). The preflight's 26 findings (`.superpowers/sdd/2026-11-12-local-carriers-part1-bosta/preflight.md`, all ACCEPTED) and the carry-forwards from the Task 1/2 reviews are now written **into each task** as an `**Amendments (binding)**` block at the end of the task. Where an amendment and the task text above it disagree, **the amendment wins**. An implementer needs this plan file only. The preflight file is background, not a source of requirements.

**Implementers (pipeline rule: odd → terra, even → sonnet):** T3 terra · T4 sonnet · T5 terra · T6 sonnet · T7 terra · T8 sonnet · T9 terra · T10 sonnet · T11 terra · T12 sonnet · T13 terra · T14 sonnet. The old "Model tier" lines now only say how carefully each task is reviewed.

**Rules for every task 3–14 (on top of the Global Constraints):**

- **A1 (F9).** Every new test file starts with `beforeEach(() => { expect.hasAssertions(); });`. Every `/* … */` test body in this plan is filled with the assertions listed in that task's amendment block. An `it` with no `expect` fails review.
- **A2.** Work in `F:/New folder/morbeh-carriers` on branch `morbeh/local-carriers-task3-wip` (it holds T1, T2 and the T3 WIP commit 33be124d). Commit only the task's files, by path. Never `git stash`, `checkout`, `reset` or `--no-verify`. Never push or merge.
- **A3. Code names that exist on the branch (verified 2026-11-16). Use them; never re-create them:**
  - `services/shipping/src/application/concurrency-retry.ts`: `withConcurrencyRetry`.
  - `services/shipping/src/domain/errors.ts`: `CarrierError`, `CarrierErrorStatus = 409 | 422 | 503`.
  - `services/shipping/src/domain/attempt-id.ts`.
  - `Shipment`: `pendingLabelAttempt()`, `nextLabelReference(base)`, `beginLabelAttempt(reference, at)`, `failLabelAttempt(reference, at)`, `markCarrierResultUnknown(reference, eventId, at)`, `retry(eventId, at)`, `addTrackingEvent(description, at, location?)`, `recordCarrierWebhook(kind, at)`, `markDeliveryFailed(reason, eventId, at)` (records a `carrier`/`failed` attempt carrying `reason`).
  - `ShipmentRepository`: `findByFulfillmentRef` (newest first), `findByTrackingNumber`.
  - `testing/shipping-doubles.ts`: `PostgresLikeShipmentRepository` (tenant-bucketed), `TrackingUnitOfWork`.
  - Fulfillment codes, carried in `BusinessRuleError` **message prefixes** (the envelope `code` is `BUSINESS_RULE`): `STOCK_NOT_RESERVED`, `SHIPMENT_IN_PROGRESS`, `FULFILLMENT_NOT_SHIPPABLE`, `FULFILLMENT_NOT_ATTACHABLE`.
- **A4. Added to "Not confirmed by the docs":**
  - **U11 (F1):** `/deliveries/search` is documented under Bearer only. If the API key is refused there, every lost response parks for review (`CARRIER_RESULT_UNKNOWN`), never a second create.
  - **U12 (F14):** `errorCode` is declared `type: string`, but the examples are numbers. The `/cities` `countryId` parameter is commented out in the YAML (still sent; matching never assumes an Egypt-only list). Mass-AWB has no operation-level security and an undocumented 200.
- **A6. Validation status (Task 9 review, Opus ruling 2026-11-16).** Admin API routes validate params/body/query **only** through `defineRoute` schemas (`schema: { params, body, query }`), never by parsing inside the handler. A schema failure is the shared transport's **422** `{ code: "VALIDATION", … field issues }`. That is what admin-web's client maps to `MutationResult.outcome = "invalid"`, and the failure is not cached under the idempotency key.
  - Wherever Tasks 9–14, Global Constraint 6 or Review Focus 1 say an invalid admin-API request (a `cod` key, 51 ids, duplicate ids, a malformed carrier key, a 513-character credential, `{}`, disconnect + another key) is a **400**, read **422** with `code: "VALIDATION"`.
  - Domain codes keep their statuses (`CARRIER_UNKNOWN` 422, `CARRIER_CREDENTIALS_REJECTED` 409, …).
  - **Exception:** admin-web's Next.js route handler `GET /orders/awb` (Task 14) keeps its 400 `text/plain`.
- **A5. Residuals (F7, F19, F26, T2 review), recorded, no code in Part 1:**
  - Unknown tenants get the transport's 403 `TENANT_UNKNOWN`, not the handler's 401 (pinned in Task 10).
  - Fulfillment's inventory port is the always-confirmed in-memory adapter, because checkout holds stock, so `STOCK_NOT_RESERVED` can't fire in production.
  - Ruling 32's lock is best-effort. After a lock loss, two shipments would both send `<n>-1`, and U4 decides.
  - Public routes are limited to 300/min per (tenant, IP), so a Bosta burst can lose updates to Part 2's poll.
  - From the T2 review: `reservation_requested` stuck → `SHIPMENT_IN_PROGRESS` with no recovery path. Mirror from `shipment_created` walks `tracking_assigned` without a tracking number (unreachable while attach is atomic).

---

## Bosta API facts (verified 2026-11-12)

The API reference at `https://docs.bosta.co/api` is a Stoplight Elements page. Its source (`48dcf387.*.js`) loads `apiDescriptionUrl: "/api/api.yaml"`, so the full OpenAPI 3.0.1 document is **https://docs.bosta.co/api/api.yaml** (440 KB). Every fact below was read from it or from the how-to pages it links. The fixtures in this plan are copied from these examples. A fixture whose name ends in `.modelled.json` is modelled on a shape the docs only describe in prose.

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Source                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| F1  | **Auth:** header `Authorization: <apiKey>`, no prefix (`securitySchemes.ApiKey: {type: apiKey, name: Authorization, in: header}`). The YAML's `servers` says `http://app.bosta.co/api/v2/`; every how-to says `https://app.bosta.co/api/v2`. **Use https.**                                                                                                                                                                                                                                                                                                                                                                                            | api.yaml `components.securitySchemes`; [print-awbs](https://docs.bosta.co/docs/how-to/print-awbs/)                  |
| F2  | **Create:** `POST /deliveries?apiVersion=1` (operationId `adddelivery`). Required: `type`, `cod`. Fields: `specs.{packageType: "Parcel"\|"Document"\|…, size: "SMALL"\|"MEDIUM"\|"LARGE"\|…, packageDetails.{itemsCount, description}}`, `notes`, `cod` ("limit is 30,000 EGP"), `dropOffAddress`, `businessReference`, **`uniqueBusinessReference`** ("must be unique across all orders"), `receiver.{firstName (req), lastName, fullName, phone (req), secondPhone, email}`, `allowToOpenPackage`, `deliveryImages`, `webhookUrl`, `webhookCustomHeaders`, `businessLocationId`, `goodsInfo.amount`, `escrowInfo.{isExcluded, amountToBeCollected}`. | [adddelivery](https://docs.bosta.co/api#/operations/adddelivery), schema `BusinessadddeliveryRequest`               |
| F3  | **Create response:** `200 {success, message, data: {_id, trackingNumber, businessReference, state: {code: 10, value}, …}}`. Errors: `{success: false, message, errorCode, data: null}`; 401 → errorCode 1007, 403 → 1008, 500 → 1000.                                                                                                                                                                                                                                                                                                                                                                                                                  | same                                                                                                                |
| F4  | **`dropOffAddress`** (`AddressCreateDelivery`): `city` (name, required), `firstLine` (required, "must be more than 5 characters"), `secondLine`, `buildingNumber`, `floor`, `apartment`, `zoneId`. **`oneOf`**: `districtId`, **or** `districtName` + `cityId`.                                                                                                                                                                                                                                                                                                                                                                                        | schema `AddressCreateDelivery`; [format-bosta-address](https://docs.bosta.co/docs/how-to/format-bosta-address/)     |
| F5  | **`allowToOpenPackage: true` requires `deliveryImages: [{type: "ALLOW_TO_OPEN_THE_PACKAGE", images: [1–10 URLs]}]`**. Otherwise the create fails with errorCode 2150.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | schema `DeliveryImage`; [create-your-first-delivery](https://docs.bosta.co/docs/how-to/create-your-first-delivery/) |
| F6  | **Create error codes:** 1061, 1073 (no business location), 2150/2151/2152 (images), 3001 City Not Found, 3002 Zone, 3003 District, 3004 Street code, 3005, 3006, 3007 (COD > 30000 EGP), 3008, 3009 (city/zone/district required).                                                                                                                                                                                                                                                                                                                                                                                                                     | create-your-first-delivery "Error Codes"                                                                            |
| F7  | **Search exists:** `POST /deliveries/search`, body `DeliverySearchParams` with `businessReference` (string), `trackingNumbers`, `mobilePhones`, `stateCodes`, `type`. The documented 200 example shows `data` as **one delivery object**.                                                                                                                                                                                                                                                                                                                                                                                                              | api.yaml `/deliveries/search`                                                                                       |
| F8  | **Cancel exists:** `DELETE /deliveries/business/{trackingNumber}/terminate` (operationId `Businessterminatedelivery`). 200 → `{success: true, message: "Delivery has been terminated successfully.", data: {_id}}`; 404 → errorCode 1066 "Delivery not found"; 400 is undocumented.                                                                                                                                                                                                                                                                                                                                                                    | api.yaml                                                                                                            |
| F9  | **Get:** `GET /deliveries/business/{trackingNumber}` (operationId `Businessviewdelivery`) → `data.{_id, state: {code, value}, maskedState, cod, type: {code, value}, businessReference, trackingNumber, history[], timeline[], dropOffAddress.{city, zone, district}}`.                                                                                                                                                                                                                                                                                                                                                                                | api.yaml                                                                                                            |
| F10 | **Cities:** `GET /cities?countryId=…` has `security: []`, so **it is public**. Response `data.list[]` with `{_id, name, nameAr, alias, code: "EG-01", sector, dropOffAvailability, pickupAvailability}`. Only Cairo (`FceDyHXwpSYYF9zGW`, `EG-01`) and Alexandria (`Jrb6X6ucjiYgMP4T7`, `EG-02`) are documented rows. Bosta's `code` is **not** ISO 3166-2.                                                                                                                                                                                                                                                                                            | api.yaml `/cities`                                                                                                  |
| F11 | **Egypt `countryId` = `60e4482c7cb7d4bc4849c4d5`** (KSA `eF-3f9FZr`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | api.yaml `components.schemas.countryId`; format-bosta-address                                                       |
| F12 | **Mass AWB:** `POST /deliveries/mass-awb` `{trackingNumbers: "a,b" (comma string), requestedAwbType: "A6"\|"A4", lang: "ar"\|"en"}`. The 200 body schema is **not documented**. The how-to says: ≤ 50 → "a base64 encoded pdf file"; > 50 → `{success: true, message: "AirwayBill will be exported to your email!"}` and a zip by email; up to 1000. A4 is the original AWB, A6 the Zebra one.                                                                                                                                                                                                                                                         | api.yaml; print-awbs                                                                                                |
| F13 | **Webhook:** Bosta sends a POST on every state change, **not on creation**. Per delivery, `webhookCustomHeaders` is "any custom headers you want to be send with the request" (object). Body: `{_id, trackingNumber, state (Number), type ("SEND"\|"RTO"\|…), cod (only Delivered), timeStamp (Number, ms), isConfirmedDelivery, deliveryPromiseDate, exceptionReason, exceptionCode, businessReference, numberOfAttempts}`. The examples send `trackingNumber` as a **number** (`48089608`). There is no location field and no signature.                                                                                                             | [get-delivery-status-via-webhook](https://docs.bosta.co/docs/how-to/get-delivery-status-via-webhook/)               |
| F14 | **States:** 10 Pickup requested, 11 Waiting for route, 20 Route assigned, 21 Picked up from business, 22 Picking up from consignee, 23 Picked up from consignee, 24 Received at warehouse, 25 Fulfilled, 30 In transit between hubs, 40 Picking up, **41 Picked up = Out for delivery when type SEND, Out for return when CRP/RTO/EXCHANGE**, 45 Delivered, 46 Returned to business, 47 Exception, 48 Terminated, 49 Canceled, 60 Returned to stock, 100 Lost, 101 Damaged, 102 Investigation, 103 Awaiting your action, 104 Archived, 105 On hold.                                                                                                    | same                                                                                                                |
| F15 | **`GET /pickup-locations`** is authenticated (documents a 401), read-only, and every business has at least one location (1073).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | api.yaml `/pickup-locations`                                                                                        |

**Not confirmed by the docs** (each is designed so that a later confirmation is a one-function change):

- **U1:** the JSON field that holds the mass-AWB base64 PDF. The parser accepts raw `%PDF` bytes, `data` as a string, or `data.data`, strips a `data:application/pdf;base64,` prefix, and requires `%PDF-` after decoding (`parseAwbResponse`, Task 6).
- **U2:** the real `/deliveries/search` response shape (array, `data.deliveries`, or the documented single object). The parser accepts all three and keeps only exact `businessReference` matches (`parseSearchResponse`, Task 6).
- **U3:** whether `cod: 0` is accepted for `type: 10`. The schema says "deliver (10): COD must be positive". We send `0` for prepaid orders and surface a refusal as `CARRIER_REJECTED` (Ruling 14).
- **U4:** whether a duplicate `uniqueBusinessReference` is refused, and with which errorCode (Ruling 3).
- **U5:** whether non-`Authorization` custom headers (`x-tenant-id`) reach the webhook. The docs say "any custom headers". If they don't, every webhook answers 401 and Part 2's poll job is the backstop (Ruling 21).
- **U6:** Bosta's English spellings for 25 of the 27 governorates. Matching uses Arabic names first (Ruling 10).
- **U7:** the limit on `packageDetails.description` (Ruling 18).
- **U8:** the public tracking page's query parameter (Ruling 39).
- **U9:** the webhook retry policy.
- **U10:** the terminate response for an already-terminated or already-picked-up delivery (Ruling 1).

---

## Rulings (decided on the owner's behalf; the spec is silent, ambiguous, or wrong against the code or the API)

The owner delegated every decision ("نفذ وخد القرارات مكاني ما يخدم مصلحة المنصة"). Each ruling is binding for the tasks that follow. Format: **decision** — why — cost if wrong.

1. **Cancel calls Bosta's terminate (§8.4, first case).** The cancel is `DELETE /deliveries/business/{tn}/terminate` (F8), offered only while the shipment is `label_created`. Then `voidLabel` runs and the fulfillment detaches. 404/errorCode 1066 counts as "already gone" and voids. Any other 4xx answers `CARRIER_CANCEL_REFUSED` and changes nothing. No local-only fallback is built: the capability is documented. — **Why:** a cancel that leaves a live Bosta delivery behind invites a second delivery. — **Cost if wrong:** if Bosta returns 400 for a delivery it would still accept, the merchant cancels in Bosta's dashboard; the message says so.
2. **Search by `businessReference` exists (F7), so a retry after a lost response searches first.**
   - Exactly one exact match → settle with it.
   - None → create again under the **same** reference.
   - More than one, or the search fails → the §9a.5 fallback: the shipment goes to `exception`, which surfaces as `CARRIER_RESULT_UNKNOWN`.

   — **Why:** the shape is unverified (U2), so the code assumes nothing it can't check. — **Cost if wrong:** an unknown shape lands in `exception` and the merchant checks Bosta. That is safe and costs a click.

3. **`uniqueBusinessReference` is sent equal to `businessReference`**, as Bosta's own duplicate guard (F2). A 4xx on a _resumed_ create is read as "maybe a duplicate" and goes to the result-unknown path, never `failed`. — **Why:** it is a second, server-side guard against the half-shipped anti-goal. — **Cost if wrong:** if Bosta ignores the field, nothing changes; if it refuses duplicates, the search already handled that case.
4. **Pending attempts are append-only.** `shipping_attempts` is written with `createMany({ skipDuplicates })` and is never rewritten (`prisma-shipment-repository.ts`). So "settle turns it into succeeded/failed" (§9a.5) is implemented as **appending** a `label` attempt with outcome `succeeded`/`failed` and the **same `reference`**.
   - A "pending attempt with no result" is the latest `label` attempt with outcome `pending` whose `reference` has no later `label` attempt.
   - The sequence number is 1 + the number of `pending` label attempts.
   - `businessReference` = `<orderNumber>-<seq>`.

   — **Why:** it keeps the observability log's invariant. — **Cost if wrong:** none functionally; the log has two rows per attempt.

5. **An in-flight grace of 120 s.** A retry that finds a pending attempt younger than 120 s answers `CARRIER_CREATE_IN_PROGRESS` without calling Bosta. — **Why:** the original call may still be running (double click, a slow carrier), and searching too early can miss a delivery Bosta hasn't indexed yet. — **Cost if wrong:** the merchant waits up to 2 minutes.
6. **A 4xx is a definite failure; a timeout, 5xx or network error is "unknown".**
   - A 4xx appends a `failed` attempt. The shipment stays `created` and the code is returned (`ADDRESS_NOT_SHIPPABLE`, …).
   - A timeout, 5xx, network error or non-JSON body leaves the attempt `pending` and answers `CARRIER_TIMEOUT` / `CARRIER_UNAVAILABLE` (503, retryable). The next attempt resumes through Ruling 2.

   — **Why:** only a 4xx proves Bosta created nothing. — **Cost if wrong:** a 4xx after a create would be a duplicate risk; F3 documents none.

7. **Fix the attempt-id defect in shipping and fulfillment.** `Shipment.recordAttempt` and `FulfillmentOrder.recordAttempt` build ids as `<uuid> + <index>` (e.g. `…-4a1f0`). The columns are `UUID` (`shipping_attempts.id`, `fulfillment_attempts.id`), so Postgres refuses every attempt row. That is the first save of a pending attempt, and the first reservation. Both contexts get `attemptIdFor(aggregateId, index)`: a deterministic UUID from SHA-256 of `"<id>:attempt:<index>"`, with version nibble 5 and variant 10. Deterministic, so `skipDuplicates` still dedupes on re-save. — **Why:** found by reading the code; this feature writes attempts on its first click. — **Cost if wrong:** none (ids stay unique). Rows written before the fix can't exist, because their insert failed. **Payments has the same pattern (`payment-intent.ts:499`) and is out of scope; it is reported, not fixed.**
8. **Credentials are verified with `GET /pickup-locations` (F15), not `GET /cities` (spec conflict).** `/cities` is public (F10), so it accepts any key and proves nothing. 200 → valid; 401/403 → `CARRIER_CREDENTIALS_REJECTED`; anything else → `CARRIER_UNAVAILABLE`, and nothing is saved. The response body is discarded unread. — **Cost if wrong:** none known; it is a read the merchant's own account allows.
9. **`dropOffAddress` uses the second documented format (F4):** `{ city: <Bosta city name>, cityId, districtName: <order city text>, firstLine }`.
   - The city comes from `GET /cities?countryId=60e4482c7cb7d4bc4849c4d5`, fetched with the resolving tenant's key and cached per process for 6 h, keyed by country id (never by tenant).
   - A district Bosta refuses comes back as 3003 → `ADDRESS_NOT_SHIPPABLE` / `DISTRICT_NOT_FOUND`.
   - **Districts versus zones:** zones aren't used. `districtName` is the documented free-text path.
10. **The governorate table is `@platform/regions`' 27 EG provinces (ISO → `en`/`ar`) plus Bosta English aliases.** A province matches a Bosta city when the normalised `nameAr` is equal: drop tatweel and spaces, fold أ/إ/آ→ا, ة→ه, ى→ي. Failing that, it matches when the lower-cased `name`/`alias` is one of the province's English candidates. A city with `dropOffAvailability === false` doesn't match. No match → `ADDRESS_NOT_SHIPPABLE` / `CITY_NOT_FOUND`. — **Why:** U6; the Arabic names are the most stable key. — **Cost if wrong:** a governorate Bosta spells differently fails with a clear reason, and an alias is a one-line fix.
11. **`specs` is `{ packageType: "Parcel", size: "SMALL", packageDetails }` (spec conflict).** The spec says `packageType: "SMALL"`. The API reference's own example uses `packageType: Parcel, size: MEDIUM`, while one how-to uses `packageType: "Small"`. The reference wins.
12. **`escrowInfo: { isExcluded: true }` is always sent.** — **Why:** if it is omitted, the merchant's Bosta escrow default can split the COD into a deposit and a remainder (F2). The amount on the waybill must be exactly the server-computed amount (§6). — **Cost if wrong:** the merchant loses Bosta's deposit feature for Morbeh orders until a config switch is added.
13. **`goodsInfo` is omitted.** The docs say insurance isn't calculated without it. Insurance is a paid add-on whose terms the merchant should choose. — **Cost if wrong:** lost parcels aren't insured, which matches what merchants get today when they type deliveries by hand.
14. **Prepaid orders send `cod: 0`** (U3). A refusal surfaces as `CARRIER_REJECTED`; nothing is guessed.
15. **"Allow opening the package" sends `deliveryImages`.** Images are the order's line image URLs: https only, deduplicated, at most 10. No image means `OPEN_PACKAGE_NEEDS_IMAGES` before any call (F5).
16. **The receiver name follows §8.3** (first space split, `lastName` `"-"`), even though the docs mark `lastName` optional. A missing `recipientName` → `ADDRESS_NOT_SHIPPABLE` / `RECIPIENT_MISSING`.
17. **The phone uses a new `toBostaPhone` (spec conflict: "the existing phone helpers").** The repo's helpers (`services/checkout/.../checkout-address.ts`, `packages/tracking/.../normalization.ts`) produce `+`-prefixed E.164 at best. The new helper:
    - maps Arabic-Indic and Persian digits;
    - strips separators and `+20` / `0020` / `20`;
    - prefixes a missing `0`;
    - accepts only Egyptian mobiles `^01[0125]\d{8}$`. Anything else → `PHONE_NOT_SHIPPABLE`.
18. **The description** is `"<name>[ (<variant>)] ×<qty>"`, joined with `"، "` and clipped to **200** characters with `"…"` (U7). `notes` is omitted, since orders hold no delivery note.
19. **How error codes travel.** A `CarrierError extends DomainError` carries the specific code as `code` (so `body.code` is it) and `"<CODE>: <text>"` as `message` (§7's prefix rule). It also carries `httpStatus` (409 | 422 | 503) and an optional allow-listed `reason`. The shipping presenter maps it, and admin-web's `MutationResult` gains `code`.
20. **`packages/carrier-bosta` doesn't depend on `services/shipping`.** It declares the same shapes locally. `BostaCarrierProvider` satisfies shipping's `CarrierProvider` structurally, checked at compile time in `apps/runtime/src/bosta-registration.ts`. Failure classification uses a `carrierFailure` discriminant property, never `instanceof`. — **Why:** packages must not import services (`psp-paymob` depends only on `contracts`/`utils`).
21. **The webhook (§9a.1).**
    - **Headers:** `webhookCustomHeaders = { "x-tenant-id": <tenantId>, "Authorization": <secret> }` (F13).
    - **Route:** `POST /api/v1/public/shipping/webhook/bosta`.
    - **Body:** ≤ 16 KiB, checked in the handler; the transport's default cap is 1 MiB.
    - **Secret check:** SHA-256 of both values compared with `timingSafeEqual`. The previous secret is accepted until `previousValidUntil`.
    - **401:** a wrong secret, a missing header and an unknown tenant all answer **one** body, `{ code: "UNAUTHORIZED", message: "Unauthorized" }`.
    - **Unknown tracking number:** a tracking number with no Bosta shipment in this tenant answers `200 { ignored: true }`, so Bosta doesn't retry.
22. **Scan text is Bosta's own English state name (F14)**, e.g. "Received at warehouse". For 47 it is `"Exception: <exceptionReason>"` (≤ 200 chars). Location is absent (F13). It isn't translated: it is the carrier's scan, as Shopify shows it.
23. **Skip-ahead is a shortest path over the shipment transition table.**
    - **Intermediates:** only `label_created`, `carrier_accepted`, `in_transit`, `out_for_delivery` and `delivery_failed`.
    - **Targets reachable by walking:** `carrier_accepted`, `in_transit`, `out_for_delivery`, `delivered`, `delivery_failed` and `returned`.
    - **Direct edge only:** `cancelled` and `exception`; no invented in-transit step before a cancel.
    - **Unreachable:** scan only.
    - **Bosta map:** 21/24/30 map to `in_transit`, which walks `label_created → carrier_accepted → in_transit` (§8.2). 41 maps only for `type: SEND`; 41 for RTO/CRP is a scan.
24. **A carrier cancel mirrors to fulfillment only before pickup.** §9a.3 adds `shipment_created`/`tracking_assigned → packing_completed` and nothing later, so a 48/49 after pickup leaves the fulfillment where it is. The shipment shows the cancel. — **Why:** a parcel cancelled while in Bosta's hands must not read as "unfulfilled" and invite a re-ship. — **Cost if wrong:** the merchant fixes one order by hand.
25. **The fulfillment mirror runs in the webhook route**, after `RecordCarrierWebhook` saves. A mirror failure is logged with ids only and the route still answers 200, so the next webhook re-mirrors. The shipping `FulfillmentPort` takes no tenant and is best-effort, so it isn't used.
26. **Both new permissions are admin-only.** The role table excludes `shipping:read_settings` and `shipping:update_settings` from operator's `shipping:*`. The order page and the orders list learn which carriers are enabled from the new `GET /shipping/carriers/enabled` under `shipping:read`, which carries no config.
27. **The webhook secret has its own envelope**, sealed under the carrier key `"<key>:webhook"`, so it never shares a payload with the API key.
28. **Disconnect** disables the carrier **and deletes** its sealed credentials and webhook secrets. — **Cost if wrong:** after a reconnect, old deliveries' webhooks fail. Part 2's poll covers them.
29. **`merchant_carrier_settings.version`** guards writes: `updateMany where { tenantId, version }`. A lost race is `ConcurrencyError` → 409.
30. **Resolution has a purpose.** `new_shipment` needs the carrier enabled and configured. `existing_shipment` (cancel, print) needs it configured only, so a merchant who turns Bosta off can still print and cancel what's on the road.
31. **Bosta is registered only when both `SHIPPING_CREDENTIALS_KEK_REF` and `ADMIN_API_PUBLIC_URL` are set.** Without the URL, deliveries carry no `webhookUrl` and statuses never follow, which silently breaks goal 5. Exactly one of the two set refuses boot outside `local`. `ADMIN_API_PUBLIC_URL` is new: the public origin of the admin API. The webhook URL is `<origin>/api/v1/public/shipping/webhook/bosta`.
32. **A per-order lock.** `ShipOrderWithCarrier` takes `DistributedLock.acquire("carrier-ship:<tenantId>:<orderId>", 60_000)`. If the lock is held → `SHIPMENT_IN_PROGRESS`. The runtime passes `RedisDistributedLock`; an absent lock (tests) runs unlocked. — **Why:** two clicks with different idempotency keys must not open two fulfillments and two deliveries.
33. **Fulfillment and shipment are reused, not keyed.** `CreateFulfillment` and `CreateShipment` take no idempotency key (the `shipments.idempotency_key` column is unused). Phase 2 therefore reuses the order's current fulfillment order and that fulfillment's shipment. Ruling 32 plus route-level `Idempotency-Key` replay cover the rest.
34. **`ShipmentPackage.weightGrams` is 1** (the domain requires a positive value; Bosta is sent no weight).
35. **A second ship of an already-labelled order succeeds** and returns the same tracking number. Its fulfillment attach is re-applied idempotently.
36. **Bulk time budget.**
    - The carrier HTTP timeout is 10 s.
    - The overall budget is 55 s.
    - Before each order, if `elapsed > 55 s − 15 s`, every remaining order is `{ code: "CARRIER_TIMEOUT", attempted: false }`.
    - admin-web's API timeouts are 30 s (single) and 75 s (bulk). The orders pages export `maxDuration = 90`.
37. **AWB printing.**
    - `POST /shipments/awb` takes `{ shipmentIds }` **or** `{ orderIds }` (1–50 each), plus optional `format`/`lang`; the defaults come from carrier config.
    - Any selected order without a printable label → 409 `AWB_NOT_AVAILABLE` with `orderNumbers`, and no partial PDF.
    - The PDF is sent as the response body with `Cache-Control: private, no-store` and never stored.
    - admin-web proxies it through a `GET /orders/awb?orderIds=&format=&lang=` route handler, so the bearer token stays server-side.
38. **The orders-list "bulk-selection bar" doesn't exist (spec conflict).** `orders-table.tsx` has no selection. Task 14 builds one: a client selection provider, a checkbox cell and a sticky bar.
39. **The Bosta tracking link points to the public page `https://bosta.co/tracking-shipments` without a parameter (U8)**, next to the tracking number and a copy button.
40. **The COD decision (§9a.2, made exact).**
    - The order's payment status is derived from its history.
    - `refunded`/`voided` → `ORDER_NOT_SHIPPABLE`.
    - `paid` → COD 0.
    - Otherwise the order's `paymentRef` intent must be `provider === "cod"` with status in `{requires_payment, created, processing, authorized, capture_requested}`. Its `amount.amountMinor` must equal `order.totalAmount().amountMinor`, else `COD_AMOUNT_MISMATCH`.
    - Anything else → `ORDER_NOT_PAID`.
    - The currency must be `EGP` (`CURRENCY_NOT_SUPPORTED`).
41. **`ORDER_NOT_SHIPPABLE`** covers: the order isn't open (cancelled/closed history); its payment is refunded/voided; or its current fulfillment order is past `tracking_assigned` (`shipment_dispatched` and later, or `cancelled`/`closed` with tracking).
42. **A shipment in `exception` blocks shipping** with `SHIPMENT_NEEDS_REVIEW` until the merchant presses "راجعت بوسطة — اشحن تاني". That runs `RetryShipment`, which closes the open pending attempt as `failed`, then ships again under the next reference (`-2`).
43. **Brand copy.** New Arabic copy says **مربح**. The existing `ar.brand: "موربيه"` key is out of this plan's scope and is reported as a finding, not edited.

---

## Global Constraints

These come from spec §7 (verbatim where quoted) and the binding lessons of earlier plans. Every task's requirements include them.

1. **Tenancy (spec §7):**
   - "ADR-0014: every new adapter, resolver, store and provider is a process-wide singleton taking `tenantId` per call, and `assertMultiTenantReady` must stay green."
   - "Credentials are resolved per call and never cached across tenants."
   - "RLS: every new tenant-scoped table gets `ENABLE` + `FORCE ROW LEVEL SECURITY` + `tenant_isolation` in its own hand-written, additive migration. Never run migrate or db push; the owner deploys."
   - "Carrier HTTP calls run outside open transactions, using the existing precheck → external call → settle shape."
   - "Domain events are written through the outbox in the same transaction as the aggregate."

   No new object field named `tenantId` anywhere on `WiredAdmin`. The Bosta city cache is keyed by country id only.

2. **Error codes (spec §7):** "Error codes travel as a `CODE:` message prefix to `body.code`." (Ruling 19.)
3. **admin-web (spec §7):**
   - "client components never value-import `lib/api` or `lib/auth`";
   - "server actions validate their arguments";
   - "actions are wrapped in `unstable_rethrow` with localised errors";
   - "admin copy is Egyptian Arabic, and the brand is مربح";
   - "ar/en parity".

   Every new string goes in both `messages/en.ts` and `messages/ar.ts`. CSS is logical (`ms-`/`me-`/`ps-`/`pe-`/`start`/`end`). Carrier and scan text renders in `<bdi dir="auto">`.

4. **Outbound HTTP (spec §7):** "an injectable `HttpFetch` with an `AbortController` timeout, typed API errors that never echo response bodies, and tests that use JSON fixtures copied from Bosta's documentation. No test calls Bosta."
5. **CI (spec §7):** "the lint warning cap (473) must not rise, and coverage floors must hold."
   - In in-memory doubles and fakes, write `return Promise.resolve(x)` in a non-`async` method instead of `async` without `await` (`require-await` warns).
   - Shipping floors: lines 69, statements 69, functions 72, branches 76. Fulfillment: 80 across the board. The new `@platform/carrier-bosta`: 80 across the board, like `psp-paymob`.
6. **Money:** no client-supplied amount, anywhere. The COD amount is computed in `ShipOrderWithCarrier` from Orders + Payments. Request bodies are zod `.strict()`, so a `cod`/`amount` key is a 400. The amount is capped at 30,000 EGP (3,000,000 minor) and is never read as "paid" (§6).
7. **Credentials and PII (spec §6, §9):**
   - No read DTO, log line, error message or webhook response carries an API key or webhook secret.
   - Waybill PDFs are never stored. Every PDF response sends `Cache-Control: private, no-store`.
   - Log lines carry ids and codes only, never addresses, phones or names.
8. **Tenant-where guard:** run `node scripts/dev/check-prisma-tenant-where.mjs` after every task that touches Prisma. On this base it reports exactly one known finding (`discounts.admin-controller.ts:166: promotions.update has no where`). Any new platform-global read must get a classified `EXEMPTIONS` entry; this plan adds none. **Windows:** `prisma-tenant-where.guard.test.ts` fails locally because of the space in "New folder", so run the script instead.
9. **`tenant-mode-guard`:** any new `TENANT_DEFAULT_ID` read must be classified in `apps/runtime/src/tenant-mode-guard.ts`; this plan adds none.
10. **No migration is run.** Never `prisma migrate`, `db push`, or any SQL against any database. `pnpm --filter @platform/db db:generate` (client generation) is allowed. DB-gated suites stay skipped.
11. **Git:**
    - Commit with `git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit`, body lines ≤ 100 chars (commitlint), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
    - Never use `--no-verify`, `git stash` or `git checkout`.
    - Stage only the task's files, by path. Never stage `.superpowers/` or `.claude/`.
12. **Brand:** **مربح** / **Morbeh** in every new string (Ruling 43).

**Part 1 numbers** (spec and Bosta values, verbatim):

| Value                           |                                                                      |
| ------------------------------- | -------------------------------------------------------------------- |
| COD cap                         | 30,000 EGP = 3,000,000 minor (`COD_ABOVE_CARRIER_LIMIT`, Bosta 3007) |
| Bulk ship / print               | 1–50 orders; mass-AWB ≤ 50 per call (F12)                            |
| Carrier HTTP timeout            | 10 s                                                                 |
| Bulk budget / per-order reserve | 55 s / 15 s                                                          |
| In-flight grace                 | 120 s                                                                |
| Previous webhook secret         | valid 7 days after rotation                                          |
| Webhook body                    | ≤ 16 KiB                                                             |
| City cache                      | 6 h per process, keyed by country id                                 |
| Egypt countryId                 | `60e4482c7cb7d4bc4849c4d5`                                           |
| Base URL                        | `https://app.bosta.co/api/v2`                                        |

## Review Focus

These are the five failure modes most likely to cost a merchant money or trust. Each names the test that pins it.

1. **A wrong or unclear COD amount reaches Bosta.**
   - **The risk:** an unpaid card order, a manual order, or a COD intent that differs from the total must never ship as COD 0 or as a guessed amount. A request body can't carry an amount. 30,000.00 EGP passes; 30,000.01 doesn't.
   - **Pinned in:**
     - **Task 11:** `cod-amount.test.ts` "a pending card order is ORDER_NOT_PAID, never COD 0" and "a COD intent that differs from the total is COD_AMOUNT_MISMATCH";
     - **Task 11:** `carrier-shipping-routes.test.ts` "a body with cod is a 400";
     - **Task 5:** `delivery-request.test.ts` "converts minor to EGP with two decimals and accepts exactly 30,000" and "refuses 3,000,001, negatives and fractions before any call".
2. **A double delivery after a lost response.**
   - **The risk:** a timeout after Bosta created the delivery must not create a second one on retry. A retry within 120 s mustn't call Bosta at all. An ambiguous search parks the shipment for review, and Retry moves to reference `-2`. Two concurrent clicks can't both ship.
   - **Pinned in:**
     - **Task 7:** `create-label.carrier.test.ts` "a timeout leaves the attempt pending; the retry finds the delivery by reference and creates nothing", "a retry inside 120 s is CARRIER_CREATE_IN_PROGRESS with no Bosta call" and "an ambiguous search parks the shipment; Retry ships as -2";
     - **Task 11:** `ship-order-with-carrier.test.ts` "a held lock answers SHIPMENT_IN_PROGRESS".
3. **A webhook from another tenant, or with a wrong secret, moves a shipment.**
   - **The risk:** tenant B's secret presented as tenant A must be refused. A wrong secret and an unknown tenant must be indistinguishable. Another tenant's tracking number changes nothing. The previous secret dies after 7 days.
   - **Pinned in:**
     - **Task 4:** `carrier-settings.use-cases.test.ts` "accepts the tenant's own secret only; tenant B's secret is refused for tenant A" and "the previous secret works for 7 days after a rotation, then not";
     - **Task 10:** `public-carrier-webhook-routes.test.ts` "wrong secret and unknown tenant give the same 401 body" and "a tracking number this tenant doesn't own is ignored".
4. **An address that can't be shipped.**
   - **The risk:** no province, a non-EG country, a short line, a missing recipient, an unknown governorate or a district Bosta refuses must each fail with a reason. Nothing is written before the call, and Bosta's text is never echoed.
   - **Pinned in:**
     - **Task 5:** `delivery-request.test.ts` "each unshippable address names its reason";
     - **Task 6:** `bosta-carrier-provider.test.ts` "3003 is ADDRESS_NOT_SHIPPABLE/DISTRICT_NOT_FOUND without the body";
     - **Task 7:** `create-label.carrier.test.ts` "a prepare problem writes no attempt".
5. **A bulk run hits the time budget.**
   - **The risk:** a slow carrier must not hold the request open past the budget. Unattempted orders are reported as `CARRIER_TIMEOUT` and never sent. One order's failure never stops the others.
   - **Pinned in:** **Task 11:** `bulk-ship.test.ts` "orders after the budget are CARRIER_TIMEOUT and never attempted" and "a failed order doesn't stop the next".

---

## File Structure

**services/shipping** (`@platform/shipping`)

- `src/domain/attempt-id.ts` (new): `attemptIdFor`.
- `src/domain/errors.ts` (new): `CarrierError`.
- `src/domain/value-objects/shipment-status.ts`: the §9a.4 transitions and `carrierPathTo`.
- `src/domain/value-objects/carrier-key.ts` (new).
- `src/domain/shipping-attempt.ts`: the `pending` outcome.
- `src/domain/value-objects/shipping-label.ts`: `carrierDeliveryId`.
- `src/domain/shipment.ts`: pending attempts, `markCarrierResultUnknown`, `needsCarrierReview`, retry closing.
- `src/domain/shipment-repository.ts`: `findByTrackingNumber`.
- `src/domain/merchant-carrier-settings.ts` and `merchant-carrier-settings-repository.ts` (new).
- `src/application/carrier-provider.ts`, `carrier-registry.ts`, `carrier-resolver.ts` (new).
- `src/application/carrier-settings.use-cases.ts`, `carrier-shipment.use-cases.ts` (new).
- `src/application/shipment-lifecycle.use-cases.ts`: the carrier `CreateLabel` path and `RetryShipment`.
- `src/application/record-carrier-webhook.use-case.ts`: scans and skip-ahead.
- `src/application/ports.ts`: `CarrierCredentialVault`.
- `src/infrastructure/`:
  - `envelope-carrier-credential-vault.ts`, `tenant-carrier-resolver.ts`;
  - `prisma-merchant-carrier-settings-repository.ts`, `in-memory-merchant-carrier-settings-repository.ts`;
  - `prisma-processed-carrier-webhook-store.ts`;
  - `shipment.mapper.ts`, `prisma-shipment-repository.ts`, `in-memory-shipment-repository.ts`.
- `src/interfaces/presenter.ts` (`CarrierError`) and `shipping.controller.ts`.
- `src/composition.ts`, `src/index.ts`.
- `src/testing/shipping-doubles.ts`, `src/testing/carrier-doubles.ts` (new, test-only).
- `package.json` (+ `@platform/secrets`).

**services/fulfillment** (`@platform/fulfillment`)

- `src/domain/attempt-id.ts` (new).
- `src/domain/value-objects/fulfillment-status.ts`: transitions and `fulfillmentCarrierPathTo`.
- `src/domain/fulfillment-order.ts`: `returnToPacking`, attempt ids.
- `src/application/carrier-fulfillment.use-cases.ts` (new).
- `src/interfaces/fulfillment.controller.ts`, `src/composition.ts`, `src/index.ts`.

**packages/carrier-bosta** (`@platform/carrier-bosta`, new)

- `package.json`, `tsconfig.json`, `vitest.config.ts`.
- `src/`:
  - `http.ts`, `errors.ts`, `config.ts`;
  - `phone.ts`, `governorates.ts`, `delivery-request.ts`;
  - `states.ts`, `webhook.ts`;
  - `cities.ts`, `client.ts`, `provider.ts`, `index.ts`.
- `src/__fixtures__/*.json`.

**packages/db**

- `prisma/schema/shipping.prisma` (`MerchantCarrierSettings`, the shipments index).
- `prisma/schema/migrations/20261112000000_shipping_carrier_settings/migration.sql` (new).
- `src/schema-migration-consistency.test.ts`.

**packages/auth**

- `src/role-table-access-control.ts` (+ test).

**apps/admin**

- `src/carrier-shipping/` (new): `ports.ts`, `cod-amount.ts`, `carrier-order.adapter.ts`, `carrier-fulfillment.adapter.ts`, `ship-order-with-carrier.ts`, `bulk-ship.ts`.
- `src/interfaces/carrier-settings.admin-controller.ts` and `carrier-shipping.admin-controller.ts` (new).
- `src/http/carrier-settings-routes.ts`, `public-carrier-webhook-routes.ts`, `carrier-shipping-routes.ts` (new).
- `src/http/shipping-routes.ts` (the DTO), `admin-routes.ts`, `src/composition.ts`.
- `package.json` (+ `@platform/carrier-bosta`).

**apps/runtime**

- `src/bosta-registration.ts` (new), `src/composition.ts`, `src/config.ts`, `src/api.ts` (+ tests).
- `package.json` (+ `@platform/carrier-bosta`).

**apps/admin-web**

- `src/lib/api/client.ts` (`code`, `timeoutMs`, `postAdminApiForBytes`), `src/lib/api/carriers.ts` (new), `src/lib/api/carrier-shipments.ts` (new).
- `src/lib/shipping/carrier-errors.ts` (new).
- `src/app/settings/shipping/carrier-actions.ts` (new) and `page.tsx`.
- `src/app/orders/carrier-actions.ts` (new), `src/app/orders/awb/route.ts` (new), `page.tsx`, `[orderId]/page.tsx`.
- `src/components/settings/shipping/carriers-card.tsx` and `carrier-dialog.tsx` (new).
- `src/components/orders/`: `order-carrier-card.tsx`, `carrier-shipment-actions.tsx`, `shipment-timeline.tsx`, `orders-selection.tsx`, `bulk-ship-results-dialog.tsx` (new), `orders-table.tsx`.
- `src/messages/en.ts`, `ar.ts`.

**Root**

- `.env.example`, `scripts/ops/seed-ory-network.mjs`, `pnpm-lock.yaml`.

## Commands

- **Tests:**
  - all: `pnpm --filter <pkg> test`;
  - one file: `pnpm --filter <pkg> exec vitest run <file>`;
  - types and lint: `pnpm --filter <pkg> typecheck` and `pnpm --filter <pkg> lint`.

  Admin and admin-web lint need memory: `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint` (the same variable for `admin-web`).

- **Package filter names:** `@platform/shipping`, `@platform/fulfillment`, `@platform/carrier-bosta`, `@platform/db`, `@platform/auth`, `@platform/admin`, `@platform/runtime`, `admin-web`.
- **Workspace dependency changes:** after editing a `package.json`, run `pnpm install --offline`. Commit `pnpm-lock.yaml` with the task. Never delete `node_modules` or the lockfile.
- **Prisma client:** `pnpm --filter @platform/db db:generate` after editing a `.prisma` file. Never `migrate`.
- **Tenant-where guard:** `node scripts/dev/check-prisma-tenant-where.mjs`. Expect exactly the one known finding.
- **Env docs:** `node scripts/ops/check-env-docs.mjs`.
- **Route contract:** `cd apps/admin-web && pnpm exec vitest run src/lib/api/route-contract.test.ts`.
- **Lint cap:** `node scripts/ops/check-lint-warnings.mjs`. The total must stay ≤ 473; run it at the end and after Tasks 11 and 14.
- **Client-bundle grep (admin-web):** `grep -rlE '^"use client"' apps/admin-web/src | xargs grep -nE 'from "@/lib/(api|auth)/' | grep -v 'import type'`. It prints exactly the three pre-existing hits:
  - `components/finance/finance-model-picker.tsx`;
  - `components/security/audit-actions.tsx`;
  - `components/security/identity-actions.tsx`.

  Nothing new may appear.

- **`next build` fails with `EPERM` on this machine.** `typecheck`, `lint` and `test` are admin-web's gates.

Commit template used by every task (replace subject/body):

```bash
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
<type>(<scope>): <lower-case subject>

<body, lines <= 100 chars>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 1: Shipping domain — transitions, pending label attempts, `carrierDeliveryId`, attempt ids

Model tier: **strong** (the half-shipped anti-goal rests on these invariants).

**Files:**

- Create: `services/shipping/src/domain/attempt-id.ts`, `attempt-id.test.ts`
- Create: `services/shipping/src/domain/errors.ts`
- Create: `services/shipping/src/testing/shipping-doubles.ts`. Move `TrackingUnitOfWork` and `PostgresLikeShipmentRepository` out of `src/shipment-lifecycle-transaction-boundary.test.ts`, export them, and import them back.
- Modify:
  - `services/shipping/src/domain/value-objects/shipment-status.ts` (+ new `shipment-status.test.ts`);
  - `services/shipping/src/domain/shipping-attempt.ts`;
  - `services/shipping/src/domain/value-objects/shipping-label.ts`;
  - `services/shipping/src/domain/shipment.ts` and `shipment.test.ts`;
  - `services/shipping/src/domain/shipment-repository.ts`;
  - `services/shipping/src/infrastructure/shipment.mapper.ts`, `prisma-shipment-repository.ts`, `in-memory-shipment-repository.ts` (+ `in-memory-shipment-repository.test.ts`);
  - `services/shipping/src/interfaces/presenter.ts`.

**Interfaces:**

- Consumes: `DomainError` (`@platform/utils`), `createHash` (`node:crypto`).
- Produces:

```ts
// attempt-id.ts
/** Deterministic RFC-4122-shaped id (version 5, variant 10) from SHA-256 of `${aggregateId}:attempt:${index}`. */
export function attemptIdFor(aggregateId: string, index: number): string;

// errors.ts
export type CarrierErrorStatus = 409 | 422 | 503;
export class CarrierError extends DomainError {
  readonly retryable: boolean; // true only for 503
  readonly httpStatus: CarrierErrorStatus;
  readonly reason?: string;
  /** message = `${code}: ${text}`; `code` property = code (Ruling 19). */
  constructor(code: string, text: string, httpStatus: CarrierErrorStatus, reason?: string);
}

// shipment-status.ts
/** Ruling 23. Steps after `from`, ending with `to`; `[]` when equal; null when unreachable. */
export function carrierPathTo(
  from: ShipmentStatusValue,
  to: ShipmentStatusValue,
): readonly ShipmentStatusValue[] | null;

// shipping-attempt.ts
export type ShippingAttemptOutcome = "succeeded" | "failed" | "pending";

// shipping-label.ts
static create(labelId: string, trackingNumber: string, carrierDeliveryId?: string): Result<ShippingLabel, ValidationError>;
get carrierDeliveryId(): string | undefined;

// shipment.ts (new members)
pendingLabelAttempt(): ShippingAttempt | undefined;
/** `${base}-${1 + number of pending label attempts}` (Ruling 4). */
nextLabelReference(base: string): string;
/** Appends label/pending/reference. Throws BusinessRuleError if one is open or status can't reach label_created. */
beginLabelAttempt(reference: string, occurredAt: Date): void;
/** Appends label/failed/reference (closes the pending attempt). */
failLabelAttempt(reference: string, occurredAt: Date): void;
createLabel(label, carrier, carrierService, trackingNumber, eventId, occurredAt, reference?: string): void;
/** created → exception; records carrier/failed `CARRIER_RESULT_UNKNOWN:<reference>`; the pending attempt stays open. */
markCarrierResultUnknown(reference: string, eventId: string, occurredAt: Date): void;
/** status exception AND a pending label attempt is open. */
get needsCarrierReview(): boolean;

// shipment-repository.ts
findByTrackingNumber(carrier: string, trackingNumber: string, tenantId: string, tx?: unknown): Promise<Shipment | null>;
```

- [ ] **Step 1: Write the failing tests**

`services/shipping/src/domain/value-objects/shipment-status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canTransitionShipment, carrierPathTo } from "./shipment-status";

describe("§9a.4 additive transitions", () => {
  it.each([
    ["in_transit", "returned"],
    ["out_for_delivery", "returned"],
    ["delivery_failed", "returned"],
    ["exception", "returned"],
    ["in_transit", "delivery_failed"],
    ["carrier_accepted", "cancelled"],
    ["in_transit", "cancelled"],
    ["created", "exception"],
  ] as const)("%s → %s is allowed", (from, to) => {
    expect(canTransitionShipment(from, to)).toBe(true);
  });
  it("keeps every pre-existing edge", () => {
    expect(canTransitionShipment("delivered", "returned")).toBe(true);
    expect(canTransitionShipment("voided", "created")).toBe(true);
    expect(canTransitionShipment("exception", "created")).toBe(true);
  });
});

describe("carrierPathTo (Ruling 23)", () => {
  it("walks missed steps forward", () => {
    expect(carrierPathTo("label_created", "delivered")).toEqual([
      "carrier_accepted",
      "in_transit",
      "out_for_delivery",
      "delivered",
    ]);
    expect(carrierPathTo("label_created", "in_transit")).toEqual([
      "carrier_accepted",
      "in_transit",
    ]);
    expect(carrierPathTo("label_created", "returned")).toEqual([
      "carrier_accepted",
      "in_transit",
      "returned",
    ]);
  });
  it("is [] for the same status and null when unreachable", () => {
    expect(carrierPathTo("in_transit", "in_transit")).toEqual([]);
    expect(carrierPathTo("delivered", "in_transit")).toBeNull();
    expect(carrierPathTo("voided", "delivered")).toBeNull();
  });
  it("reaches cancelled and exception only by a direct edge", () => {
    expect(carrierPathTo("in_transit", "cancelled")).toEqual(["cancelled"]);
    expect(carrierPathTo("delivery_failed", "cancelled")).toBeNull();
    expect(carrierPathTo("label_created", "exception")).toBeNull();
    expect(carrierPathTo("in_transit", "exception")).toEqual(["exception"]);
  });
});
```

`services/shipping/src/domain/attempt-id.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { attemptIdFor } from "./attempt-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("attemptIdFor (Ruling 7)", () => {
  it("is a valid UUID, deterministic, and distinct per index and aggregate", () => {
    const a = attemptIdFor("019a0000-0000-7000-8000-000000000001", 0);
    expect(a).toMatch(UUID);
    expect(attemptIdFor("019a0000-0000-7000-8000-000000000001", 0)).toBe(a);
    expect(attemptIdFor("019a0000-0000-7000-8000-000000000001", 1)).not.toBe(a);
    expect(attemptIdFor("019a0000-0000-7000-8000-000000000002", 0)).not.toBe(a);
  });
});
```

Add to `services/shipping/src/domain/shipment.test.ts`:

```ts
describe("pending label attempts (§9a.5, Ruling 4)", () => {
  const at = new Date("2026-11-12T10:00:00.000Z");
  it("begins, reports and closes a pending attempt; references count up", () => {
    const s = newShipment(); // existing helper in this file: Shipment.create(...) at `created`
    expect(s.nextLabelReference("1001")).toBe("1001-1");
    s.beginLabelAttempt("1001-1", at);
    expect(s.pendingLabelAttempt()?.reference).toBe("1001-1");
    expect(() => s.beginLabelAttempt("1001-2", at)).toThrow(/pending/i);
    s.failLabelAttempt("1001-1", at);
    expect(s.pendingLabelAttempt()).toBeUndefined();
    expect(s.nextLabelReference("1001")).toBe("1001-2");
    expect(s.attempts.every((a) => /^[0-9a-f-]{36}$/.test(a.id.toString()))).toBe(true);
  });
  it("a labelled shipment closes the attempt with the same reference and keeps the delivery id", () => {
    const s = newShipment();
    s.beginLabelAttempt("1001-1", at);
    const label = ShippingLabel.create("del-1", "5108002", "del-1");
    s.createLabel(
      unwrap(label),
      unwrap(Carrier.create("bosta")),
      unwrap(CarrierService.create("standard")),
      unwrap(TrackingNumber.create("5108002")),
      "evt-1",
      at,
      "1001-1",
    );
    expect(s.status.value).toBe("label_created");
    expect(s.label?.carrierDeliveryId).toBe("del-1");
    expect(s.pendingLabelAttempt()).toBeUndefined();
  });
  it("result unknown → exception needing review; retry closes the attempt and goes back to created", () => {
    const s = newShipment();
    s.beginLabelAttempt("1001-1", at);
    s.markCarrierResultUnknown("1001-1", "evt-2", at);
    expect(s.status.value).toBe("exception");
    expect(s.needsCarrierReview).toBe(true);
    s.retry("evt-3", at);
    expect(s.status.value).toBe("created");
    expect(s.pendingLabelAttempt()).toBeUndefined();
    expect(s.nextLabelReference("1001")).toBe("1001-2");
  });
});
```

Extend `in-memory-shipment-repository.test.ts` with "findByTrackingNumber is tenant- and carrier-scoped". It saves a labelled bosta shipment in `t-1`, then expects `findByTrackingNumber("bosta", "5108002", "t-1")` to be found, and both `("bosta", "5108002", "t-2")` and `("aramex", "5108002", "t-1")` to be `null`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/shipping exec vitest run src/domain`
Expected: FAIL with `carrierPathTo is not exported`, `Cannot find module './attempt-id'` and `beginLabelAttempt is not a function`.

- [ ] **Step 3: Implement**

- **The transition table becomes:**
  - `created: [label_created, voided, cancelled, exception]`;
  - `label_created: [carrier_accepted, rejected, voided, cancelled]` (unchanged);
  - `carrier_accepted: [in_transit, cancelled]` (unchanged);
  - `in_transit: [out_for_delivery, exception, delivery_failed, returned, cancelled]`;
  - `out_for_delivery: [delivered, delivery_failed, returned]`;
  - `delivery_failed: [in_transit, exception, closed, returned]`;
  - `exception: [created, closed, returned]`.

  The rest is unchanged.

- **`carrierPathTo` is a breadth-first search over `TRANSITIONS`:**

```ts
const WALKABLE = new Set<ShipmentStatusValue>([
  "label_created",
  "carrier_accepted",
  "in_transit",
  "out_for_delivery",
  "delivery_failed",
]);
const WALK_TARGETS = new Set<ShipmentStatusValue>([
  "carrier_accepted",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "delivery_failed",
  "returned",
]);
export function carrierPathTo(from, to) {
  if (from === to) return [];
  if (!WALK_TARGETS.has(to)) return canTransitionShipment(from, to) ? [to] : null;
  const previous = new Map<ShipmentStatusValue, ShipmentStatusValue>();
  const queue: ShipmentStatusValue[] = [from];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const next of TRANSITIONS[node]) {
      if (previous.has(next) || next === from) continue;
      if (next !== to && !WALKABLE.has(next)) continue;
      previous.set(next, node);
      if (next === to) {
        const path: ShipmentStatusValue[] = [to];
        for (let at = node; at !== from; at = previous.get(at)!) path.unshift(at);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}
```

- **`attemptIdFor`:** `createHash("sha256").update(`${id}:attempt:${index}`).digest()`. Take the first 16 bytes, then set `b[6] = (b[6] & 0x0f) | 0x50` and `b[8] = (b[8] & 0x3f) | 0x80`. Format as 8-4-4-4-12 hex.
- **`Shipment.recordAttempt`:** use `UniqueEntityId.from(attemptIdFor(this.id.toString(), this.props.attempts.length))`. Tracking-event ids are unchanged: they live in JSON, not a UUID column.
- **`pendingLabelAttempt`:** walk `attempts` from the end. Return the first `kind === "label" && outcome === "pending"` attempt for which no later `label` attempt has the same `reference`.
- **`retry()`:** when the current status is `exception` and `pendingLabelAttempt()` is set, call `failLabelAttempt(pending.reference)` before the transition.
- **`createLabel(..., reference)`:** pass `reference` to `recordAttempt("label", "succeeded", at, reference)`.
- **`ShippingLabel`:** the mapper reads and writes `label.carrierDeliveryId`; it is absent for older rows.
- **`findByTrackingNumber` on Prisma:** `client.shipment.findFirst({ where: { tenantId, carrier, trackingNumber }, include: { attempts: { orderBy: { occurredAt: "asc" } } }, orderBy: { createdAt: "desc" } })` through `readScoped`. Factor the row-to-domain cast the three finders repeat into one private `toDomain(row)`.
- **In-memory and `PostgresLikeShipmentRepository`:** loop over the tenant bucket. Follow Global Constraint 5's `Promise.resolve` rule in the double.
- **The presenter:**

  ```ts
  if (!result.ok && result.error instanceof CarrierError) {
    return {
      status: result.error.httpStatus,
      body: {
        ...toErrorEnvelope(result.error),
        ...(result.error.reason !== undefined ? { reason: result.error.reason } : {}),
      },
    };
  }
  ```

- [ ] **Step 4: Run the shipping suite**

Run: `pnpm --filter @platform/shipping test && pnpm --filter @platform/shipping typecheck && pnpm --filter @platform/shipping lint`
Expected: PASS. The boundary test passes unchanged against the moved doubles.

- [ ] **Step 5: Commit**

```bash
git add services/shipping/src/domain services/shipping/src/testing/shipping-doubles.ts \
  services/shipping/src/shipment-lifecycle-transaction-boundary.test.ts \
  services/shipping/src/infrastructure/shipment.mapper.ts \
  services/shipping/src/infrastructure/prisma-shipment-repository.ts \
  services/shipping/src/infrastructure/in-memory-shipment-repository.ts \
  services/shipping/src/infrastructure/in-memory-shipment-repository.test.ts \
  services/shipping/src/interfaces/presenter.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(shipping): carrier transitions, pending label attempts and valid attempt ids

Adds the spec's additive shipment transitions, a shortest-path walk for skipped carrier steps,
pending label attempts that settle append-only, ShippingLabel.carrierDeliveryId, lookup by
tracking number, and CarrierError. Attempt ids were "<uuid><n>", which a UUID column refuses.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Fulfillment — additive transitions and carrier use cases

Model tier: **standard**.

**Files:**

- Create: `services/fulfillment/src/domain/attempt-id.ts` (a copy of Task 1's, its own test)
- Create: `services/fulfillment/src/application/carrier-fulfillment.use-cases.ts`, `carrier-fulfillment.use-cases.test.ts`
- Modify:
  - `services/fulfillment/src/domain/value-objects/fulfillment-status.ts` (+ test);
  - `services/fulfillment/src/domain/fulfillment-order.ts` and `fulfillment-order.test.ts`;
  - `services/fulfillment/src/interfaces/fulfillment.controller.ts`;
  - `services/fulfillment/src/composition.ts`;
  - `services/fulfillment/src/index.ts`.

**Interfaces:**

- Consumes: `RequestReservation`, `FulfillmentLifecycleDeps`, `notifyBestEffort`, `withConcurrencyRetry`. This file keeps its own copy of the helper, by convention.
- Produces:

```ts
// fulfillment-status.ts — additive
// shipment_created:  [tracking_assigned, packing_completed]
// tracking_assigned: [shipment_dispatched, packing_completed]
// in_transit:        [out_for_delivery, delivery_failed, returned]
// out_for_delivery:  [delivered, delivery_failed, returned]
export function fulfillmentCarrierPathTo(
  from: FulfillmentStatusValue,
  to: FulfillmentStatusValue,
): readonly FulfillmentStatusValue[] | null; // intermediates: tracking_assigned, shipment_dispatched, in_transit, out_for_delivery, delivery_failed

// fulfillment-order.ts
/** shipment_created | tracking_assigned → packing_completed; clears carrierReference and trackingNumber ("label voided", §9a.3). */
returnToPacking(eventId: string, occurredAt: Date): void;

// carrier-fulfillment.use-cases.ts
export class PrepareForCarrierShipment { execute(i: FulfillmentOrderIdInput): Promise<Result<FulfillmentOrderStatusOutput, DomainError>> }
export interface AttachCarrierShipmentInput extends FulfillmentOrderIdInput {
  readonly carrier: string; readonly carrierShipmentId: string; readonly trackingNumber: string;
}
export class AttachCarrierShipment { execute(i: AttachCarrierShipmentInput): Promise<Result<FulfillmentOrderStatusOutput, DomainError>> }
export class DetachCarrierShipment { execute(i: FulfillmentOrderIdInput): Promise<Result<FulfillmentOrderStatusOutput, DomainError>> }
export interface MirrorShipmentStatusInput extends FulfillmentOrderIdInput { readonly shipmentStatus: string }
export class MirrorShipmentStatus {
  execute(i: MirrorShipmentStatusInput): Promise<Result<FulfillmentOrderStatusOutput & { readonly changed: boolean }, DomainError>>;
}

// FulfillmentController (new methods, each `present(..., 200)`)
prepareForCarrier(input: FulfillmentOrderIdInput): Promise<ControllerResponse>;
attachCarrierShipment(input: AttachCarrierShipmentInput): Promise<ControllerResponse>;
detachCarrierShipment(input: FulfillmentOrderIdInput): Promise<ControllerResponse>;
mirrorShipmentStatus(input: MirrorShipmentStatusInput): Promise<ControllerResponse>;
```

**What each use case does:**

- **`PrepareForCarrierShipment`:**
  - `created` / `failed` / `reservation_requested` → run `RequestReservation`. If it ends `failed` → `BusinessRuleError("STOCK_NOT_RESERVED: …")`.
  - Then, in one transaction, walk `confirmed → picking_started → picking_completed → packing_started → packing_completed`. It resumes from any of these.
  - `packing_completed` / `shipment_created` / `tracking_assigned` → ok as-is.
  - Anything else → `BusinessRuleError("FULFILLMENT_NOT_SHIPPABLE: …")`.
- **`AttachCarrierShipment`:**
  - `packing_completed` → `createShipment(ref)` + `assignTracking(tn)` in one transaction.
  - `shipment_created` → `assignTracking`.
  - `tracking_assigned` with the same tracking number → ok (idempotent, Ruling 35).
  - Otherwise `BusinessRuleError`.
- **`DetachCarrierShipment`:** `shipment_created` / `tracking_assigned` → `returnToPacking`. `packing_completed` → ok. Anything else → `BusinessRuleError("FULFILLMENT_ALREADY_DISPATCHED: …")`.
- **`MirrorShipmentStatus`** (§9a.4, Ruling 24):

  | Shipment           | Fulfillment target                                                    |
  | ------------------ | --------------------------------------------------------------------- |
  | `carrier_accepted` | `shipment_dispatched`                                                 |
  | `in_transit`       | `in_transit`                                                          |
  | `out_for_delivery` | `out_for_delivery`                                                    |
  | `delivered`        | `delivered` (`markDelivered`)                                         |
  | `delivery_failed`  | `delivery_failed`                                                     |
  | `returned`         | `returned`                                                            |
  | `cancelled`        | `returnToPacking`, only from `shipment_created` / `tracking_assigned` |
  | other              | no-op                                                                 |

  It walks `fulfillmentCarrierPathTo`. Unreachable → `ok({ changed: false })`, never an error.

- [ ] **Step 1: Write the failing tests**

`carrier-fulfillment.use-cases.test.ts`. Build deps from `InMemoryFulfillmentOrderRepository` + `InMemoryUnitOfWork` + a scripted `InventoryPort`, exactly as `request-reservation-transaction-boundary.test.ts` does.

```ts
describe("PrepareForCarrierShipment (§9a.3)", () => {
  it("walks a new fulfillment order through reservation to packing_completed", async () => {
    const h = harness({ reserve: { confirmed: true } });
    const id = await h.createOrder("order-1");
    const result = await h.prepare.execute({ tenantId: T, fulfillmentOrderId: id });
    expect(result.ok && result.value.status).toBe("packing_completed");
    expect(h.statusTrail(id)).toEqual([
      "reservation_requested",
      "confirmed",
      "picking_started",
      "picking_completed",
      "packing_started",
      "packing_completed",
    ]);
  });
  it("is STOCK_NOT_RESERVED when inventory refuses", async () => {
    const h = harness({ reserve: { confirmed: false, reason: "out of stock" } });
    const id = await h.createOrder("order-1");
    const result = await h.prepare.execute({ tenantId: T, fulfillmentOrderId: id });
    expect(!result.ok && result.error.message).toMatch(/^STOCK_NOT_RESERVED:/);
  });
  it("resumes from picking_started and leaves tracking_assigned untouched", async () => {
    /* … */
  });
});

describe("Attach / Detach (Ruling 35, §9a.3)", () => {
  it("attach is idempotent for the same tracking number; detach clears it back to packing_completed", async () => {
    const h = harness({ reserve: { confirmed: true } });
    const id = await h.packedOrder("order-1");
    const input = {
      tenantId: T,
      fulfillmentOrderId: id,
      carrier: "bosta",
      carrierShipmentId: "del-1",
      trackingNumber: "5108002",
    };
    expect((await h.attach.execute(input)).ok).toBe(true);
    expect((await h.attach.execute(input)).ok).toBe(true);
    expect(h.order(id).trackingNumber?.value).toBe("5108002");
    const detached = await h.detach.execute({ tenantId: T, fulfillmentOrderId: id });
    expect(detached.ok && detached.value.status).toBe("packing_completed");
    expect(h.order(id).trackingNumber).toBeUndefined();
    expect(h.order(id).carrierReference).toBeUndefined();
  });
});

describe("MirrorShipmentStatus (§9a.4, Ruling 24)", () => {
  it.each([
    ["carrier_accepted", "shipment_dispatched"],
    ["in_transit", "in_transit"],
    ["delivered", "delivered"],
    ["returned", "returned"],
  ])("shipment %s → fulfillment %s from tracking_assigned", async (shipment, expected) => {
    const h = harness({ reserve: { confirmed: true } });
    const id = await h.attachedOrder("order-1");
    const r = await h.mirror.execute({
      tenantId: T,
      fulfillmentOrderId: id,
      shipmentStatus: shipment,
    });
    expect(r.ok && r.value.status).toBe(expected);
  });
  it("cancelled returns to packing_completed before pickup only", async () => {
    const h = harness({ reserve: { confirmed: true } });
    const before = await h.attachedOrder("order-1");
    expect(await h.statusAfterMirror(before, "cancelled")).toBe("packing_completed");
    const after = await h.attachedOrder("order-2");
    await h.mirror.execute({
      tenantId: T,
      fulfillmentOrderId: after,
      shipmentStatus: "in_transit",
    });
    const r = await h.mirror.execute({
      tenantId: T,
      fulfillmentOrderId: after,
      shipmentStatus: "cancelled",
    });
    expect(r.ok && r.value).toMatchObject({ status: "in_transit", changed: false });
  });
});
```

In `fulfillment-order.test.ts`, add "attempt ids are valid UUIDs after requestReservation".

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/fulfillment exec vitest run src/application/carrier-fulfillment.use-cases.test.ts`
Expected: FAIL with `Cannot find module './carrier-fulfillment.use-cases'`.

- [ ] **Step 3: Implement** the transitions, `fulfillmentCarrierPathTo` (Task 1's BFS shape with this context's allowed intermediates), `returnToPacking`, the attempt ids, the four use cases, the controller methods, the composition wiring and the index exports. Only `AttachCarrierShipmentInput` and `MirrorShipmentStatusInput` are new types. Each use case reads, applies and saves inside `withConcurrencyRetry(5, …)`; `notifyBestEffort` runs after the save.

- [ ] **Step 4: Run the fulfillment suite**

Run: `pnpm --filter @platform/fulfillment test && pnpm --filter @platform/fulfillment typecheck && pnpm --filter @platform/fulfillment lint`
Expected: PASS. Coverage holds at 80.

- [ ] **Step 5: Commit** with `feat(fulfillment): carrier prepare/attach/detach/mirror and label-voided transitions`. The body mentions the attempt-id fix.

---

### Task 3: Carrier registry, credential vault, merchant carrier settings and resolver

Model tier: **strong** (the credential boundary and RLS).

**Files:**

- Create: `services/shipping/src/domain/value-objects/carrier-key.ts`
- Create: `services/shipping/src/application/carrier-provider.ts`, `carrier-registry.ts` (+ test), `carrier-resolver.ts`
- Create: `services/shipping/src/domain/merchant-carrier-settings.ts` (+ test), `merchant-carrier-settings-repository.ts`
- Create: `services/shipping/src/infrastructure/envelope-carrier-credential-vault.ts` (+ test)
- Create: `services/shipping/src/infrastructure/prisma-merchant-carrier-settings-repository.ts`, `in-memory-merchant-carrier-settings-repository.ts`
- Create: `services/shipping/src/infrastructure/tenant-carrier-resolver.ts` (+ test)
- Create: `services/shipping/src/testing/carrier-doubles.ts`. It holds `LocalKeyWrapCipher`, copied from payments' test-support because a service may not import another's internals, plus `testCarrierVault()`, `FakeCarrierProvider`, `fakeRegistration()`, `fixedClock()`, `sequentialIds()`.
- Create: `packages/db/prisma/schema/migrations/20261112000000_shipping_carrier_settings/migration.sql`
- Modify: `packages/db/prisma/schema/shipping.prisma`, `packages/db/src/schema-migration-consistency.test.ts`
- Modify: `services/shipping/src/application/ports.ts` (`CarrierCredentialVault`), `services/shipping/src/composition.ts`, `src/index.ts`, `services/shipping/package.json` (+ `"@platform/secrets": "workspace:*"`)

**Interfaces:**

- Consumes: `EnvelopeCipher`, `SealedEnvelope` (`@platform/secrets`); `runReadScoped`, `runInTenantTransaction` (`@platform/db`); `BusinessRuleError`; `ConcurrencyError`.
- Produces:

```ts
// carrier-key.ts
export const CARRIER_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;
export function isWellFormedCarrierKey(value: string): boolean;

// carrier-provider.ts — the port a carrier package satisfies structurally (Ruling 20)
export interface CarrierParcelRequest {
  readonly recipient: { readonly name: string; readonly phone: string };
  readonly address: {
    readonly line1: string;
    readonly line2?: string;
    readonly city: string;
    readonly province?: string;
    readonly country: string;
  };
  readonly codAmountMinor: number;
  readonly currency: string;
  readonly itemsCount: number;
  readonly description: string;
  readonly packageImages: readonly string[];
}
export interface CarrierDeliveryRequest extends CarrierParcelRequest {
  readonly reference: string;
}
export interface CarrierDelivery {
  readonly deliveryId: string;
  readonly trackingNumber: string;
}
export type CarrierRejectionCode =
  | "ADDRESS_NOT_SHIPPABLE"
  | "PHONE_NOT_SHIPPABLE"
  | "COD_ABOVE_CARRIER_LIMIT"
  | "COD_INVALID"
  | "CURRENCY_NOT_SUPPORTED"
  | "OPEN_PACKAGE_NEEDS_IMAGES"
  | "CARRIER_REJECTED"
  | "CARRIER_CANCEL_REFUSED";
export interface CarrierProblem {
  readonly code: CarrierRejectionCode;
  readonly reason?: string;
}
export type CarrierStatusTarget =
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "delivery_failed"
  | "returned"
  | "cancelled"
  | "exception";
export interface CarrierDeliveryStatus {
  readonly trackingNumber: string;
  readonly stateCode: number;
  readonly stateLabel: string;
  readonly target: CarrierStatusTarget | null;
}
export interface AwbOptions {
  readonly format?: "A4" | "A6";
  readonly lang?: "ar" | "en";
}
export interface CarrierProvider {
  readonly key: string;
  prepare(request: CarrierParcelRequest): Promise<CarrierProblem | null>;
  createDelivery(request: CarrierDeliveryRequest): Promise<CarrierDelivery>;
  findDeliveriesByReference(reference: string): Promise<readonly CarrierDelivery[]>;
  cancelDelivery(trackingNumber: string): Promise<"cancelled" | "not_found">;
  printAwbs(trackingNumbers: readonly string[], options: AwbOptions): Promise<Uint8Array>;
  getDelivery(trackingNumber: string): Promise<CarrierDeliveryStatus>;
  verifyCredentials(): Promise<void>;
}
export type CarrierFailureKind = "rejected" | "unavailable" | "credentials_rejected";
export interface CarrierFailure {
  readonly carrierFailure: CarrierFailureKind;
  readonly code?: CarrierRejectionCode;
  readonly reason?: string;
  readonly timedOut?: boolean;
}
/** Reads the discriminant; null for anything else (never `instanceof`, Ruling 20). */
export function carrierFailureOf(error: unknown): CarrierFailure | null;

// carrier-registry.ts
export interface CarrierCapabilities {
  readonly cod: boolean;
  readonly awb: boolean;
  readonly webhooks: boolean;
  readonly cancel: boolean;
}
export type CarrierConfigParseResult =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly reason: string };
export interface CarrierBuildContext {
  readonly config: Readonly<Record<string, unknown>>;
  readonly credentials: Readonly<Record<string, string>>;
  /** { "x-tenant-id", Authorization } for a resolved tenant; {} for a credential check. */
  readonly webhookHeaders: Readonly<Record<string, string>>;
}
export interface CarrierRegistration {
  readonly key: string;
  readonly displayName: string;
  readonly backing: "real" | "stub";
  readonly credentialFields: readonly string[]; // non-empty
  readonly parseConfig: (raw: unknown) => CarrierConfigParseResult;
  readonly capabilities: CarrierCapabilities;
  /** Absolute webhook URL Bosta posts to; null ⇒ statuses never follow (Ruling 31). */
  readonly webhookUrl: string | null;
  readonly create: (context: CarrierBuildContext) => CarrierProvider;
}
export class CarrierRegistry {
  static from(registrations: readonly CarrierRegistration[]): CarrierRegistry; // rejects duplicate / malformed key / empty credentialFields
  get(key: string): CarrierRegistration | undefined;
  has(key: string): boolean;
  list(): readonly CarrierRegistration[];
}

// carrier-resolver.ts
export type CarrierResolutionPurpose = "new_shipment" | "existing_shipment"; // Ruling 30
export type CarrierResolutionCode =
  "CARRIER_UNKNOWN" | "CARRIER_NOT_ENABLED" | "CARRIER_NOT_CONFIGURED" | "CARRIER_NOT_AVAILABLE";
export class CarrierResolutionError extends Error {
  readonly code: CarrierResolutionCode;
  constructor(code: CarrierResolutionCode);
}
export interface CarrierResolver {
  resolve(
    tenantId: string,
    carrierKey: string,
    purpose: CarrierResolutionPurpose,
  ): Promise<CarrierProvider>;
}

// ports.ts
export interface CarrierCredentialVault {
  readonly backing: "real" | "stub";
  seal(
    tenantId: string,
    carrierKey: string,
    secrets: Readonly<Record<string, string>>,
  ): Promise<string>;
  open(
    tenantId: string,
    carrierKey: string,
    sealed: string,
  ): Promise<Readonly<Record<string, string>>>;
}

// merchant-carrier-settings.ts
export const PREVIOUS_WEBHOOK_SECRET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export interface CarrierWebhookSecrets {
  readonly sealedSecret: string;
  readonly previousSealedSecret?: string;
  readonly previousValidUntil?: Date;
}
export interface StoredCarrierSettings {
  readonly config: Readonly<Record<string, unknown>>;
  readonly sealedCredentials: string;
  readonly webhook: CarrierWebhookSecrets;
}
export class MerchantCarrierSettings {
  static empty(): MerchantCarrierSettings; // version 0
  static reconstitute(props: {
    readonly enabledCarriers: readonly string[];
    readonly carriers: Readonly<Record<string, StoredCarrierSettings>>;
    readonly version: number;
  }): MerchantCarrierSettings;
  get version(): number;
  get enabledCarriers(): readonly string[];
  get carriers(): Readonly<Record<string, StoredCarrierSettings>>;
  carrier(key: string): StoredCarrierSettings | undefined; // Object.hasOwn
  isEnabled(key: string): boolean; // enabled AND configured
  withCarrier(key: string, stored: StoredCarrierSettings): MerchantCarrierSettings;
  withEnabled(key: string, enabled: boolean): MerchantCarrierSettings; // unconfigured + true → BusinessRuleError("CARRIER_NOT_CONFIGURED: …")
  withRotatedWebhook(key: string, newSealedSecret: string, now: Date): MerchantCarrierSettings;
  withoutCarrier(key: string): MerchantCarrierSettings; // Ruling 28
}
export interface MerchantCarrierSettingsRepository {
  get(tenantId: string, tx?: unknown): Promise<MerchantCarrierSettings | null>;
  /** Insert at version 0, else updateMany where { tenantId, version }; 0 rows → ConcurrencyError (Ruling 29). */
  save(settings: MerchantCarrierSettings, tenantId: string, tx?: unknown): Promise<void>;
}

// envelope-carrier-credential-vault.ts
export class EnvelopeCarrierCredentialVault implements CarrierCredentialVault {
  constructor(cipher: EnvelopeCipher, alias: string);
} // payload { v: 1, t, c, s }; open re-checks t and c
export class InMemoryCarrierCredentialVault implements CarrierCredentialVault {} // backing "stub"

// tenant-carrier-resolver.ts
export class TenantCarrierResolver implements CarrierResolver {
  constructor(deps: {
    settings: MerchantCarrierSettingsRepository;
    registry: CarrierRegistry;
    vault: CarrierCredentialVault | undefined;
  });
}
/** The vault key a webhook secret is sealed under (Ruling 27). */
export function webhookVaultKey(carrierKey: string): string; // `${carrierKey}:webhook`

// composition.ts
export interface ShippingWiringDeps {
  // … existing …
  readonly carrierRegistrations?: readonly CarrierRegistration[];
  readonly carrierCredentialVault?: CarrierCredentialVault;
}
export interface WiredShipping {
  /* … existing … */ readonly carrierRegistry: CarrierRegistry;
}
```

**`TenantCarrierResolver.resolve` order:**

1. Registration missing → `CARRIER_UNKNOWN`.
2. Vault `undefined` → `CARRIER_NOT_AVAILABLE`. A `stub` vault or registration is allowed here; it is the runtime boot guard (Task 12) that refuses stubs outside `local`.
3. Stored settings missing → `CARRIER_NOT_CONFIGURED`.
4. `new_shipment` and not enabled → `CARRIER_NOT_ENABLED`.
5. Open the credentials (each `credentialFields` entry is required, else `CARRIER_NOT_CONFIGURED`) and the webhook secret.
6. `registration.create({ config, credentials, webhookHeaders: { "x-tenant-id": tenantId, Authorization: secret } })`.

It caches nothing.

**Migration** (`migration.sql`):

```sql
-- Project 5 Part 1 (local carriers). Written by hand, NOT applied by the agent; the owner deploys it
-- BEFORE the release that reads it. Additive only.
-- (1) shipping.merchant_carrier_settings: one row per merchant. `carrier_settings` holds only sealed
--     envelopes and non-secret config: { [key]: { config, sealedCredentials, webhook: {...} } }.
--     New tenant-scoped table, so it needs its OWN RLS policy (G-63).
-- (2) An index for webhook lookups by (tenant, carrier, tracking number).
CREATE TABLE "shipping"."merchant_carrier_settings" (
  "tenant_id" TEXT NOT NULL,
  "enabled_carriers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "carrier_settings" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "merchant_carrier_settings_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "shipping"."merchant_carrier_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shipping"."merchant_carrier_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "shipping"."merchant_carrier_settings";
CREATE POLICY tenant_isolation ON "shipping"."merchant_carrier_settings" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE INDEX "shipments_tenant_id_carrier_tracking_number_idx"
  ON "shipping"."shipments"("tenant_id", "carrier", "tracking_number");
```

**Prisma model** (in `shipping.prisma`, plus `@@index([tenantId, carrier, trackingNumber])` on `Shipment`):

```prisma
/// Project 5 — which carriers a merchant uses and how to reach them. `carrierSettings` is
/// `{ [key]: { config, sealedCredentials, webhook: { sealedSecret, previousSealedSecret?, previousValidUntil? } } }`;
/// sealed values are envelopes, never plaintext, and never returned by any read DTO.
model MerchantCarrierSettings {
  tenantId        String   @id @map("tenant_id")
  enabledCarriers String[] @default([]) @map("enabled_carriers")
  carrierSettings Json     @default("{}") @map("carrier_settings")
  version         Int      @default(0)
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("merchant_carrier_settings")
  @@schema("shipping")
}
```

**The repository's parsing** fails loudly on anything that isn't the exact shape: `"Corrupt merchant carrier settings: …"`, naming no key value and no envelope. It writes `previousValidUntil` as an ISO string. Reads and writes use `findUnique({ where: { tenantId } })` / `create` / `updateMany({ where: { tenantId, version } })` through `runReadScoped` / `runInTenantTransaction`, as the payments repository does.

- [ ] **Step 1: Write the failing tests**

`envelope-carrier-credential-vault.test.ts`:

```ts
describe("EnvelopeCarrierCredentialVault (spec §6)", () => {
  it("round-trips for the same tenant and carrier; the envelope holds no plaintext", async () => {
    const vault = testCarrierVault();
    const sealed = await vault.seal("t-1", "bosta", { apiKey: "bosta-live-key-123" });
    expect(sealed).not.toContain("bosta-live-key-123");
    expect(await vault.open("t-1", "bosta", sealed)).toEqual({ apiKey: "bosta-live-key-123" });
  });
  it("an envelope copied to another tenant or carrier fails to open, naming nothing", async () => {
    const vault = testCarrierVault();
    const sealed = await vault.seal("t-1", "bosta", { apiKey: "k" });
    await expect(vault.open("t-2", "bosta", sealed)).rejects.toThrow(
      /^Carrier credentials could not be opened$/,
    );
    await expect(vault.open("t-1", "bosta:webhook", sealed)).rejects.toThrow(/could not be opened/);
  });
});
```

`carrier-registry.test.ts`: `from` rejects a duplicate key, `"Bosta"`, `"b"` and `credentialFields: []`. `list()` keeps registration order.

`merchant-carrier-settings.test.ts`:

- enabling an unconfigured carrier throws `CARRIER_NOT_CONFIGURED:`;
- `withRotatedWebhook(now)` moves current → previous with `previousValidUntil = now + 7 d`;
- `withoutCarrier` removes the entry and the enablement;
- `carrier("__proto__")` is `undefined`.

`tenant-carrier-resolver.test.ts`:

```ts
it("builds the provider per call with the tenant's own key and webhook headers; caches nothing", async () => {
  const h = await resolverHarness(); // configures bosta for t-1 (apiKey k1) and t-2 (apiKey k2), both enabled
  const p1 = await h.resolver.resolve("t-1", "bosta", "new_shipment");
  const p2 = await h.resolver.resolve("t-2", "bosta", "new_shipment");
  expect(h.created.map((c) => c.credentials.apiKey)).toEqual(["k1", "k2"]);
  expect(h.created[0]!.webhookHeaders["x-tenant-id"]).toBe("t-1");
  expect(h.created[0]!.webhookHeaders.Authorization).toBe(h.secretOf("t-1"));
  expect(p1).not.toBe(p2);
});
it.each([
  ["unknown key", "aramex", "new_shipment", "CARRIER_UNKNOWN"],
  ["disabled, new shipment", "bosta", "new_shipment", "CARRIER_NOT_ENABLED"],
] as const)("%s → %s", async (_label, key, purpose, code) => {
  /* … rejects with CarrierResolutionError(code) */
});
it("a disabled but configured carrier still resolves for an existing shipment (Ruling 30)", async () => {
  /* … */
});
```

In `packages/db/src/schema-migration-consistency.test.ts`, add a `describe("shipping.merchant_carrier_settings — migration history matches the Prisma model (Project 5)")` block. It checks the columns `tenant_id, enabled_carriers, carrier_settings, version, created_at, updated_at`. It also checks that the SQL contains `FORCE ROW LEVEL SECURITY` and `CREATE POLICY tenant_isolation ON "shipping"."merchant_carrier_settings"`, and the `shipments_tenant_id_carrier_tracking_number_idx` index.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/shipping exec vitest run src/infrastructure src/application/carrier-registry.test.ts src/domain/merchant-carrier-settings.test.ts && pnpm --filter @platform/db exec vitest run src/schema-migration-consistency.test.ts`
Expected: FAIL (modules missing; the migration is absent).

- [ ] **Step 3: Implement** the files above.
  - Add the workspace dependency, then run `pnpm install --offline` and `pnpm --filter @platform/db db:generate`.
  - In `wireShipping`, both branches build `CarrierRegistry.from(deps.carrierRegistrations ?? [])`. Prisma builds `PrismaMerchantCarrierSettingsRepository`; in-memory builds `InMemoryMerchantCarrierSettingsRepository`.
  - Then build `TenantCarrierResolver({ settings, registry, vault: deps.carrierCredentialVault })` and return `carrierRegistry`.
  - There is **no stub-vault default**: absent means every carrier is unavailable.

- [ ] **Step 4: Run the suites and the guard**

Run: `pnpm --filter @platform/shipping test && pnpm --filter @platform/shipping typecheck && pnpm --filter @platform/shipping lint && pnpm --filter @platform/db exec vitest run src/schema-migration-consistency.test.ts && node scripts/dev/check-prisma-tenant-where.mjs`
Expected: PASS, and the guard prints only the one known finding.

- [ ] **Step 5: Commit** the shipping files, `packages/db/prisma/schema/shipping.prisma`, the migration folder, the consistency test, `services/shipping/package.json` and `pnpm-lock.yaml`. Message: `feat(shipping): carrier registry, sealed carrier settings and per-call resolver`.

**Amendments (binding) — implementer: terra. Review depth: strong.**

**Start state: a draft exists, and it is untrusted.**

Committed WIP **33be124d**:

- `application/carrier-provider.ts` (+test), `carrier-registry.ts` (+test), `carrier-resolver.ts`, `ports.ts` (`CarrierCredentialVault`);
- `domain/merchant-carrier-settings.ts` (+test), `merchant-carrier-settings-repository.ts`;
- `composition.ts` + `composition.carriers.test.ts`, `index.ts`;
- the migration, the Prisma model, the consistency test;
- `packages/secrets/src/testing/local-key-wrap-cipher.ts` (+test) exported from the new `@platform/secrets/testing` subpath, with payments' `test-support/local-key-wrap-cipher.ts` reduced to a re-export.

**Untracked** (never committed):

- `domain/value-objects/carrier-key.ts`;
- `infrastructure/envelope-carrier-credential-vault.ts` (+test), `in-memory-merchant-carrier-settings-repository.ts` (+test), `prisma-merchant-carrier-settings-repository.ts` (+test), `tenant-carrier-resolver.ts` (+test);
- `testing/carrier-doubles.ts` (+test).

None of it is reviewed. **Read every file against this task text and the amendments below.** Keep what is correct, fix what isn't, and add what is missing. Don't assume a draft test proves its title: check each assertion.

1. **F10 — no copy of `LocalKeyWrapCipher`.** It comes from `@platform/secrets/testing` (this replaces the "copied from payments" line in Files). `carrier-doubles.ts` imports it from there. `packages/secrets/package.json` `exports` has `"./testing"`. Payments still passes: run `pnpm --filter @platform/payments test` and `pnpm --filter @platform/secrets test` in Step 4. Add `packages/secrets/**` and `services/payments/src/test-support/local-key-wrap-cipher.ts` to the commit if the WIP changed them after 33be124d.
2. **F11 — repository versions (replaces the `save` comment in the interface):**
   - `settings.version === 0` → `create({ data: { tenantId, enabledCarriers, carrierSettings, version: 1 } })`.
   - `version n ≥ 1` → `updateMany({ where: { tenantId, version: n }, data: { enabledCarriers, carrierSettings, version: { increment: 1 } } })`. `count === 0` → `ConcurrencyError`.
   - A Prisma error with `code === "P2002"` on create → `ConcurrencyError`. Any other error is rethrown unchanged.
   - A `get` after a successful save returns version `n + 1` (or 1 after a create).
   - `InMemoryMerchantCarrierSettingsRepository` has the same version semantics. It stores a copy per tenant, and its methods are non-`async` and return `Promise.resolve` / `Promise.reject`.
3. **F11 — `prisma-merchant-carrier-settings-repository.test.ts`.** Use a fake client object with `merchantCarrierSettings: { findUnique, create, updateMany }` as `vi.fn`s, in the style of `prisma-shipping-zone-repository.test.ts`, passed through the same `runReadScoped` / `runInTenantTransaction` seam the repository uses. Cases, input → expected:
   - (a) save `empty().withCarrier("bosta", stored)` → `create` called once with `version: 1` and `carrierSettings.bosta.webhook.previousValidUntil` as an ISO string when set. Feeding that row back through `findUnique` → `get` returns an equal aggregate with `previousValidUntil` as a `Date` and version 1.
   - (b) save an aggregate reconstituted at version 1 → `updateMany` called with `where: { tenantId: "t-1", version: 1 }` and `version: { increment: 1 }`.
   - (c) `updateMany` resolves `{ count: 0 }` → rejects with `ConcurrencyError`.
   - (d) `create` rejects `{ code: "P2002" }` → rejects with `ConcurrencyError`.
   - (e) a row whose `carrierSettings` is `{ bosta: { config: {}, sealedCredentials: 5, webhook: { sealedSecret: "ENVELOPE-TEXT" } } }` → `get` rejects with a message matching `/^Corrupt merchant carrier settings/` that does not contain `"ENVELOPE-TEXT"`.
   - (f) `findUnique` → `null` gives `get` → `null`.
   - The in-memory repository's test covers (a)–(c) as well, plus "first save of a version-0 aggregate when a row exists → `ConcurrencyError`".
4. **F3.** `CarrierRejectionCode` stays the literal union. `carrierFailureOf(e)`:
   - returns `null` unless `e` is a non-null object whose `carrierFailure` is one of the three kinds;
   - copies `code` only when it is one of the union members (otherwise `code` is absent);
   - copies `reason` only when it is a string;
   - copies `timedOut` only when it is a boolean.

   Tests:
   - `{ carrierFailure: "rejected", code: "NOPE" }` → `{ carrierFailure: "rejected" }`;
   - `new Error("x")` → `null`;
   - `{ carrierFailure: "unavailable", timedOut: true }` → same.

5. **Resolver (F9, with the decision below).** Fill the `it.each` and the Ruling 30 case, and add these rows. Each rejects with a `CarrierResolutionError` whose `.code` is the value shown. The harness uses the in-memory repository, `testCarrierVault()` and `fakeRegistration()`.

   | Case                                                                | Purpose           | Expected                                           |
   | ------------------------------------------------------------------- | ----------------- | -------------------------------------------------- |
   | key `"aramex"` (not registered)                                     | new_shipment      | `CARRIER_UNKNOWN`                                  |
   | vault `undefined`                                                   | new_shipment      | `CARRIER_NOT_AVAILABLE`                            |
   | tenant with no row                                                  | existing_shipment | `CARRIER_NOT_CONFIGURED`                           |
   | configured, disabled                                                | new_shipment      | `CARRIER_NOT_ENABLED`                              |
   | configured, disabled                                                | existing_shipment | resolves; `created[0].credentials.apiKey === "k1"` |
   | sealed credentials lack `apiKey`                                    | existing_shipment | `CARRIER_NOT_CONFIGURED`                           |
   | sealed credentials were sealed for another tenant (copied envelope) | existing_shipment | `CARRIER_NOT_CONFIGURED`                           |

   **Decision (Opus):** a vault open failure reads as `CARRIER_NOT_CONFIGURED`, with no detail. The merchant re-enters the key; no envelope text leaves the resolver.

6. **Vault tests, in addition to the two above:**
   - `open("t-1", "bosta", "not-an-envelope")` rejects with exactly `"Carrier credentials could not be opened"`.
   - `InMemoryCarrierCredentialVault` has `backing === "stub"`, round-trips, and refuses another tenant with the same message.
   - `EnvelopeCarrierCredentialVault` has `backing === "real"`.
7. **Registry test, expected messages:**
   - a duplicate key → throws `/duplicate/i`;
   - `"Bosta"` and `"b"` → throw `/malformed/i`;
   - `credentialFields: []` → throws `/credentialFields/`;
   - `list()` returns registrations in input order;
   - `get("missing")` is `undefined`.
8. **`carrier-key.ts` test:**
   - `isWellFormedCarrierKey` is true for `"bosta"`, `"j_t-1"`;
   - false for `"Bosta"`, `"b"`, `"1bosta"`, `"bosta:webhook"`, and a 33-character key.
9. **Coverage:** also run `pnpm --filter @platform/shipping exec vitest run --coverage` in Step 4. Floors 69/69/72/76 must hold.
10. **Commit:** the files listed above plus the untracked ones, by path. Message as in Step 5. The WIP commit stays in history.

11. **Plan review 1, finding 1: the test-double contract.** `testing/carrier-doubles.ts` must end with exactly these exports. They replace the draft's `FakeCarrierBehaviour` and singular answers. Update `carrier-doubles.test.ts` to match.

    ```ts
    export interface FakeFailure {
      readonly fail: "rejected" | "unavailable" | "credentials_rejected";
      readonly code?: CarrierRejectionCode;
      readonly reason?: string;
      readonly timedOut?: boolean;
    }
    export interface FakeCarrierScript {
      /** Each queue is shifted once per call. An empty queue gives the default answer. */
      readonly prepare?: (CarrierProblem | null | FakeFailure)[]; // default null
      readonly create?: (CarrierDelivery | FakeFailure)[]; // default { deliveryId: `dlv-${reference}`, trackingNumber: `TN-${reference}` }
      readonly find?: (readonly CarrierDelivery[] | FakeFailure)[]; // default []
      readonly cancel?: ("cancelled" | "not_found" | FakeFailure)[]; // default "cancelled"
      readonly print?: (Uint8Array | FakeFailure)[]; // default the bytes of "%PDF-1.4 fake"
      readonly get?: (CarrierDeliveryStatus | FakeFailure)[]; // default state 10, target null
      readonly verify?: "ok" | "credentials_rejected" | "unavailable"; // default "ok"; applies to every call
    }
    /** Shared by every provider one registration builds, because the resolver builds a new provider per call. */
    export interface FakeCarrierRecord {
      readonly prepareCalls: {
        readonly request: CarrierParcelRequest;
        readonly openCountAtCall: number;
      }[];
      readonly createCalls: {
        readonly request: CarrierDeliveryRequest;
        readonly openCountAtCall: number;
      }[];
      readonly findCalls: string[];
      readonly findOpenCounts: number[];
      readonly cancelCalls: string[];
      readonly printCalls: [readonly string[], AwbOptions][];
      readonly getCalls: string[];
      verifyCalls: number;
      readonly verifyOpenCounts: number[];
    }
    export class FakeCarrierProvider implements CarrierProvider {
      constructor(
        key: string,
        script: FakeCarrierScript,
        record: FakeCarrierRecord,
        openCount: () => number,
      );
    }
    export interface FakeRegistration {
      readonly registration: CarrierRegistration;
      readonly created: CarrierBuildContext[];
      readonly providers: FakeCarrierProvider[];
      readonly record: FakeCarrierRecord;
    }
    export function fakeRegistration(
      options?: Partial<Omit<CarrierRegistration, "create">> & {
        readonly script?: FakeCarrierScript;
        /** e.g. () => unitOfWork.openCount from TrackingUnitOfWork. Default () => 0. */
        readonly openCount?: () => number;
      },
    ): FakeRegistration;
    export function testCarrierVault(kek?: string): EnvelopeCarrierCredentialVault;
    export function fixedClock(
      iso?: string,
    ): Clock & { advanceMs(ms: number): void; set(next: string | Date): void };
    export function sequentialIds(): IdGenerator;
    ```

    **How a `FakeFailure` behaves:** it is thrown as an `Error` with the message `"fake carrier failure"` and the own properties `carrierFailure = fail`, plus `code`, `reason` and `timedOut` when given, so `carrierFailureOf` reads it. A `FakeFailure` in the `prepare` queue is thrown the same way; a `CarrierProblem` there is returned. `verify` `"credentials_rejected"`/`"unavailable"` throws the matching failure. **Every call records `openCount()` at call time.**

    **How later tasks use it:**
    - In Tasks 4, 7 and 9, `fakeRegistration({ verify: X })` means `fakeRegistration({ script: { verify: X } })`.
    - A registration is passed as `.registration`.
    - Harness fields `h.provider.createCalls`/`findCalls`/… mean `h.reg.record.createCalls`/….
    - Task 7's `labelHarness({ create, find, prepare })` takes the queues of `FakeCarrierScript` (so `prepare` is a one-element array, e.g. `prepare: [{ code, reason }]`). Fix the Task 7 test literals accordingly (e.g. `prepare: [{ code: "ADDRESS_NOT_SHIPPABLE", reason: "PROVINCE_MISSING" }]`).

    **Helper tests:**
    - (a) script `create: [{ fail: "unavailable", timedOut: true }]` + `find: [[{ deliveryId: "d", trackingNumber: "t" }]]`. Provider 1's `createDelivery` rejects with `carrierFailureOf(e)` deep-equal to `{ carrierFailure: "unavailable", timedOut: true }`. A second provider from the same registration gets `[{ deliveryId: "d", trackingNumber: "t" }]` from `findDeliveriesByReference("1001-1")`. Its `createDelivery` then returns the default. `record.createCalls.length === 2` and `record.findCalls` deep-equals `["1001-1"]`.
    - (b) `verify: "credentials_rejected"` → `verifyCredentials()` rejects with `carrierFailure "credentials_rejected"`; `record.verifyCalls === 1`.
    - (c) `openCount: () => 3` → `record.createCalls[0].openCountAtCall === 3`.

---

### Task 4: Carrier settings use cases — read, update with verification, rotate, verify webhook

Model tier: **strong** (secrets and the webhook gate).

**Files:**

- Create: `services/shipping/src/application/carrier-settings.use-cases.ts`, `carrier-settings.use-cases.test.ts`
- Modify: `services/shipping/src/interfaces/shipping.controller.ts`, `src/composition.ts`, `src/index.ts`

**Interfaces:**

- Consumes: Task 3's registry, vault, settings repository, `webhookVaultKey`, `carrierFailureOf`, `CarrierError`; the `Clock`.
- Produces:

```ts
export interface CarrierSettingsEntryDto {
  readonly key: string;
  readonly displayName: string;
  /** a vault is composed (the Task 12 boot guard refuses stub vaults outside local) */
  readonly available: boolean;
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly config: Readonly<Record<string, unknown>> | null;
  readonly capabilities: CarrierCapabilities;
  readonly webhookUrl: string | null;
}
export interface CarrierSettingsDto { readonly carriers: readonly CarrierSettingsEntryDto[]; readonly version: number }
export interface EnabledCarriersDto { readonly carriers: readonly { readonly key: string; readonly displayName: string }[] }
export interface UpdateCarrierSettingsInput {
  readonly tenantId: string;
  readonly carrierKey: string;
  readonly enabled?: boolean;
  /** WRITE-ONLY; exactly the registration's credentialFields */
  readonly credentials?: Readonly<Record<string, string>>;
  readonly config?: unknown;
  /** Ruling 28; alone */
  readonly disconnect?: boolean;
}
export interface CarrierSettingsDeps {
  readonly settings: MerchantCarrierSettingsRepository;
  readonly registry: CarrierRegistry;
  readonly vault: CarrierCredentialVault | undefined;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly clock: Clock;
  /** 32 random bytes, base64url */
  readonly randomSecret: () => string;
}
export class GetCarrierSettings { execute(i: { tenantId: string }): Promise<Result<CarrierSettingsDto, DomainError>> }
export class ListEnabledCarriers { execute(i: { tenantId: string }): Promise<Result<EnabledCarriersDto, DomainError>> }
export class UpdateCarrierSettings { execute(i: UpdateCarrierSettingsInput): Promise<Result<CarrierSettingsDto, DomainError>> }
export class RotateCarrierWebhookSecret { execute(i: { tenantId: string; carrierKey: string }): Promise<Result<CarrierSettingsDto, DomainError>> }
export class VerifyCarrierWebhook {
  /** Never throws, never distinguishes why (spec §9a.1). */
  execute(i: { tenantId: string; carrierKey: string; presented: string | undefined }): Promise<boolean>;
}
export const MAX_CARRIER_SECRET_LENGTH = 512;

// ShippingController (new)
getCarrierSettings(i: { tenantId: string }): Promise<ControllerResponse>;
listEnabledCarriers(i: { tenantId: string }): Promise<ControllerResponse>;
updateCarrierSettings(i: UpdateCarrierSettingsInput): Promise<ControllerResponse>;
rotateCarrierWebhookSecret(i: { tenantId: string; carrierKey: string }): Promise<ControllerResponse>;
verifyCarrierWebhook(i: { tenantId: string; carrierKey: string; presented: string | undefined }): Promise<boolean>;
```

**`UpdateCarrierSettings` steps.** Validation happens before any write. The carrier call happens outside the transaction.

1. Unknown or malformed key → `CarrierError("CARRIER_UNKNOWN", …, 422)`.
2. Not available → `CARRIER_NOT_AVAILABLE` (409).
3. `disconnect` together with any other field → `ValidationError`.
4. Config goes through `parseConfig`, with `{}` when absent. A failure → `CarrierError("CARRIER_CONFIG_INVALID", reason, 422)`.
5. Credentials must be exactly `credentialFields`, each a trimmed non-empty string of ≤ 512 characters. Otherwise `CARRIER_CREDENTIALS_INVALID` (422), naming no value.
6. When credentials are given: `registration.create({ config, credentials, webhookHeaders: {} }).verifyCredentials()`.
   - `credentials_rejected` → `CARRIER_CREDENTIALS_REJECTED` (409);
   - `unavailable` → `CARRIER_UNAVAILABLE` (503).

   Then seal them.

7. If this is the first configuration (no stored entry), mint a webhook secret with `randomSecret()` and seal it under `webhookVaultKey(key)`.
8. Transaction: read (or `empty()`), apply `withCarrier` / `withEnabled` / `withoutCarrier`, save.
   - A config-only change on a configured carrier keeps the sealed credentials.
   - A config change on an unconfigured carrier without credentials → `CARRIER_NOT_CONFIGURED` (409).

**`VerifyCarrierWebhook`:**

- It returns `false` for an empty or over-512-character `presented`, a missing row or carrier, no vault, or an open failure.
- It compares `sha256(presented)` with `sha256(current)` through `timingSafeEqual`. When `now < previousValidUntil`, it compares with `previous` the same way.
- It catches every error.

- [ ] **Step 1: Write the failing tests** (`carrier-settings.use-cases.test.ts`, using `carrier-doubles.ts`):

```ts
describe("UpdateCarrierSettings (§8.1, Ruling 8)", () => {
  it("verifies the key before saving; a rejected key saves nothing", async () => {
    const h = settingsHarness({ verify: "credentials_rejected" });
    const r = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      credentials: { apiKey: "bad" },
    });
    expect(!r.ok && r.error.code).toBe("CARRIER_CREDENTIALS_REJECTED");
    expect(await h.settings.get("t-1")).toBeNull();
  });
  it("a valid key is sealed, configured, mints a webhook secret, and is never returned", async () => {
    const h = settingsHarness({ verify: "ok" });
    const r = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      credentials: { apiKey: "bosta-key-123" },
      config: { awbFormat: "A4" },
      enabled: true,
    });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain("bosta-key-123");
    const entry = r.ok ? r.value.carriers.find((c) => c.key === "bosta") : undefined;
    expect(entry).toMatchObject({ enabled: true, configured: true, config: { awbFormat: "A4" } });
    expect(h.storedWebhookSecret("t-1")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("credentials must be exactly the declared fields; the message names no value", async () => {
    const h = settingsHarness({ verify: "ok" });
    const r = await h.update.execute({
      tenantId: "t-1",
      carrierKey: "bosta",
      credentials: { apiKey: "x", extra: "secret-y" },
    });
    expect(!r.ok && r.error.code).toBe("CARRIER_CREDENTIALS_INVALID");
    expect(!r.ok && r.error.message).not.toContain("secret-y");
  });
  it("disconnect removes credentials and secrets (Ruling 28)", async () => {
    /* … */
  });
  it("a stale version is a 409 ConcurrencyError, nothing lost (Ruling 29)", async () => {
    /* … */
  });
});

describe("VerifyCarrierWebhook (§9a.1, Review Focus 3)", () => {
  it("accepts the tenant's own secret only; tenant B's secret is refused for tenant A", async () => {
    const h = await configuredHarness(["t-1", "t-2"]);
    expect(
      await h.verify.execute({
        tenantId: "t-1",
        carrierKey: "bosta",
        presented: h.secretOf("t-1"),
      }),
    ).toBe(true);
    expect(
      await h.verify.execute({
        tenantId: "t-1",
        carrierKey: "bosta",
        presented: h.secretOf("t-2"),
      }),
    ).toBe(false);
    expect(
      await h.verify.execute({
        tenantId: "t-3",
        carrierKey: "bosta",
        presented: h.secretOf("t-1"),
      }),
    ).toBe(false);
    expect(
      await h.verify.execute({ tenantId: "t-1", carrierKey: "bosta", presented: undefined }),
    ).toBe(false);
  });
  it("the previous secret works for 7 days after a rotation, then not", async () => {
    const h = await configuredHarness(["t-1"]);
    const old = h.secretOf("t-1");
    await h.rotate.execute({ tenantId: "t-1", carrierKey: "bosta" });
    expect(await h.verify.execute({ tenantId: "t-1", carrierKey: "bosta", presented: old })).toBe(
      true,
    );
    expect(
      await h.verify.execute({
        tenantId: "t-1",
        carrierKey: "bosta",
        presented: h.secretOf("t-1"),
      }),
    ).toBe(true);
    h.clock.advanceMs(PREVIOUS_WEBHOOK_SECRET_TTL_MS + 1);
    expect(await h.verify.execute({ tenantId: "t-1", carrierKey: "bosta", presented: old })).toBe(
      false,
    );
  });
});
```

Also add "ListEnabledCarriers lists only enabled + configured + available carriers, with no config".

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/shipping exec vitest run src/application/carrier-settings.use-cases.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** the use cases, the controller methods and their composition wiring. `randomSecret` defaults to `() => randomBytes(32).toString("base64url")` in `wireShipping`, overridable through `ShippingWiringDeps.randomSecret?`.

- [ ] **Step 4: Run** `pnpm --filter @platform/shipping test && pnpm --filter @platform/shipping typecheck && pnpm --filter @platform/shipping lint`. Expected: PASS.

- [ ] **Step 5: Commit** with `feat(shipping): carrier settings with verified, sealed credentials and webhook secrets`.

**Amendments (binding) — implementer: sonnet. Review depth: strong.**

1. **`randomSecret`** in tests is a deterministic function returning 43-character base64url strings (e.g. `"s".repeat(42) + n`).
2. **`UpdateCarrierSettings`, cases to add or fill.** The harness uses the in-memory repository, `testCarrierVault()`, `fakeRegistration({ verify })`, `fixedClock()` and `TrackingUnitOfWork`. Each row is input → expected; "unchanged" means `await h.settings.get("t-1")` deep-equals its value before the call.

   | Input                                                                                         | Expected                                                                                                                                   |
   | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
   | `carrierKey: "aramex"`                                                                        | err `CARRIER_UNKNOWN`, `httpStatus 422`; nothing saved                                                                                     |
   | `carrierKey: "Bosta"`                                                                         | err `CARRIER_UNKNOWN`, 422                                                                                                                 |
   | vault `undefined`                                                                             | err `CARRIER_NOT_AVAILABLE`, 409                                                                                                           |
   | `{ disconnect: true, enabled: true }`                                                         | err code `VALIDATION` (`ValidationError`)                                                                                                  |
   | `config` that `parseConfig` refuses with `reason: "awbFormat"`                                | err `CARRIER_CONFIG_INVALID`, 422, `reason "awbFormat"`                                                                                    |
   | `credentials: { apiKey: "   " }` / 513-char apiKey / `{}`                                     | err `CARRIER_CREDENTIALS_INVALID`, 422; the message doesn't contain the value                                                              |
   | verify → `unavailable`                                                                        | err `CARRIER_UNAVAILABLE`, 503; nothing saved                                                                                              |
   | configured carrier, then `{ config: { awbFormat: "A4" } }` only                               | ok; `sealedCredentials` string identical to before; `verifyCredentials` not called again                                                   |
   | unconfigured, `{ config: {...} }` only                                                        | err `CARRIER_NOT_CONFIGURED`, 409                                                                                                          |
   | unconfigured, `{ enabled: true }` only                                                        | err `CARRIER_NOT_CONFIGURED`, 409                                                                                                          |
   | configured, second `{ credentials: { apiKey: "k2" } }`                                        | ok; webhook secret unchanged (`storedWebhookSecret` same as before); credentials reopen as `k2`                                            |
   | **disconnect** (fill): configured + enabled, then `{ disconnect: true }`                      | ok; DTO entry `{ configured: false, enabled: false, config: null }`; `settings.carrier("bosta")` is `undefined`; `enabledCarriers` is `[]` |
   | **stale version** (fill): repository wrapper whose `save` rejects `new ConcurrencyError("x")` | `r.ok === false`, `r.error` is the `ConcurrencyError` (presenter → 409); stored settings unchanged                                         |
   | "verifies outside the transaction"                                                            | the fake provider records `TrackingUnitOfWork`'s open count at `verifyCredentials` → `0`                                                   |

3. **`RotateCarrierWebhookSecret`:**
   - unconfigured → `CARRIER_NOT_CONFIGURED` (409);
   - vault undefined → `CARRIER_NOT_AVAILABLE` (409);
   - success → previous = old sealed secret, `previousValidUntil = now + 7 d`.
4. **`GetCarrierSettings`:**
   - returns one entry per registration, in registry order;
   - an unconfigured entry is `{ configured: false, enabled: false, config: null, available: vault !== undefined, webhookUrl: registration.webhookUrl, capabilities }`;
   - `version` is 0 when no row exists;
   - `JSON.stringify(result)` never contains the sealed credentials or the webhook secret.
5. **`ListEnabledCarriers`:**
   - lists only carriers that are enabled, configured **and** available (a vault is composed);
   - with no vault → `{ carriers: [] }`;
   - each item has exactly the keys `key` and `displayName`.
6. **`VerifyCarrierWebhook`:** add the cases `presented` of 513 characters → `false`, `""` → `false`, and a vault whose `open` throws → `false` (no throw).
7. **Controller:** the four `ControllerResponse` methods go through the existing `present`/presenter; `verifyCarrierWebhook` returns the boolean. Export the use cases, the DTO types and `MAX_CARRIER_SECRET_LENGTH` from `src/index.ts`.
8. **Coverage:** shipping floors hold (`vitest run --coverage` in Step 4).

9. **Plan review 1, finding 2: an omitted config never resets.** This replaces "with `{}` when absent".
   - `config` absent **and** a stored entry exists → keep `stored.config` unchanged (no `parseConfig` call).
   - `config` absent on a first configuration → `parseConfig(undefined)` (registration defaults).
   - `config` present → `parseConfig(config)`.

   **Verification and version handling:**
   - Before the external verify, read the settings once (outside any transaction) to learn whether a stored entry exists and its config.
   - The write transaction re-reads, applies, and saves with the version it read, so a concurrent change → `ConcurrencyError` (409). No retry: the merchant re-submits.
   - Two stored-entry checks are made:
     - the entry existed at the pre-read but is gone in the transaction (disconnected meanwhile) → `ConcurrencyError`;
     - a first configuration finds an entry in the transaction → `ConcurrencyError`.

   **Tests:** configured with `config: { awbFormat: "A4", awbLanguage: "en" }`, then
   - (a) `{ credentials: { apiKey: "k2" } }` only;
   - (b) `{ enabled: false }` only.

   After each, the DTO entry's `config` still deep-equals `{ awbFormat: "A4", awbLanguage: "en" }`.

10. **Plan review 2: the pre-read snapshot is version-guarded.**
    - The pre-read captures `preReadVersion = settings?.version ?? 0` together with the config used for verification.
    - Inside the write transaction, **before applying any change**, compare the re-read version (missing row = 0) with `preReadVersion`. On a mismatch, return the `ConcurrencyError` (409) with no save and no retry. This check covers a disconnect, a reconnect or any other write made during verification.
    - The repository's save-time guard (`updateMany where version`) still covers changes after the transaction's read.
    - Requests without credentials make no external call but run the same check.
    - **Interleaving test:** request A's `verifyCredentials` is held on a deferred promise. While it waits, request B saves `config: { awbFormat: "A6" }` (version → n+1). Then A's verification resolves. Expected:
      - A returns the `ConcurrencyError`, and its repository `save` was not called;
      - the stored settings deep-equal those after B (config A6, B's sealed credentials and webhook secret unchanged).
    - **Second interleaving test:** during A's held verification, B disconnects and C reconnects. A → `ConcurrencyError`, no save by A.

---

### Task 5: `@platform/carrier-bosta` — address, phone, name, COD rules, state map and webhook parser

Model tier: **strong** (every rule here protects money or a delivery).

**Files:**

- Create: `packages/carrier-bosta/package.json`. Dependencies: `@platform/regions`. devDependencies: as in `psp-paymob`.
- Create: `packages/carrier-bosta/tsconfig.json`, `vitest.config.ts` (thresholds 80/80/80/80)
- Create: `packages/carrier-bosta/src/errors.ts`, `config.ts`, `phone.ts`, `governorates.ts`, `delivery-request.ts`, `states.ts`, `webhook.ts` (+ a `.test.ts` beside each), `src/index.ts`
- Create: `packages/carrier-bosta/src/__fixtures__/webhook.state-24.json` and `webhook.state-47.json`, copied verbatim from F13's two examples.

**Interfaces:**

- Consumes: `PROVINCES.EG` (`@platform/regions`).
- Produces:

```ts
// errors.ts — carries Ruling 20's discriminant
export type BostaFailureKind = "rejected" | "unavailable" | "credentials_rejected";
export class BostaApiError extends Error {
  readonly carrierFailure: BostaFailureKind;
  readonly code?: string; // a CarrierRejectionCode string
  readonly reason?: string; // allow-listed, e.g. "DISTRICT_NOT_FOUND"
  readonly status: number; // HTTP status, 0 for network/timeout
  readonly timedOut: boolean;
  constructor(init: {
    carrierFailure: BostaFailureKind;
    status: number;
    message: string;
    code?: string;
    reason?: string;
    timedOut?: boolean;
  });
}

// config.ts
export interface BostaConfig {
  readonly awbFormat: "A6" | "A4";
  readonly awbLanguage: "ar" | "en";
  readonly allowToOpenPackage: boolean;
}
export const DEFAULT_BOSTA_CONFIG: BostaConfig; // { A6, ar, false }
export function parseBostaConfig(
  raw: unknown,
):
  | { readonly ok: true; readonly value: BostaConfig }
  | { readonly ok: false; readonly reason: string }; // fills defaults, drops unknown keys

// phone.ts — Ruling 17
export function toBostaPhone(raw: string | undefined): string | null;

// governorates.ts — Ruling 10
export interface BostaCity {
  readonly _id: string;
  readonly name: string;
  readonly nameAr?: string;
  readonly alias?: string;
  readonly code?: string;
  readonly dropOffAvailability?: boolean;
}
export function normalizeArabic(value: string): string;
export function matchBostaCity(provinceIso: string, cities: readonly BostaCity[]): BostaCity | null;
export const BOSTA_ENGLISH_ALIASES: Readonly<Record<string, readonly string[]>>; // ISO → extra spellings

// delivery-request.ts
export interface BostaParcel {
  /* identical shape to shipping's CarrierParcelRequest */
}
export interface BostaProblem {
  readonly code: string;
  readonly reason?: string;
}
export const BOSTA_COD_LIMIT_MINOR = 3_000_000;
export const DESCRIPTION_MAX = 200;
export function checkParcel(parcel: BostaParcel, config: BostaConfig): BostaProblem | null; // no network
export function splitReceiverName(name: string): {
  readonly firstName: string;
  readonly lastName: string;
};
export function describeItems(description: string): string; // trims, clips to 200 with "…"
export function buildDeliveryPayload(input: {
  readonly parcel: BostaParcel;
  readonly reference: string;
  readonly city: BostaCity;
  readonly config: BostaConfig;
  readonly webhookUrl: string | null;
  readonly webhookHeaders: Readonly<Record<string, string>>;
}): Record<string, unknown>;

// states.ts — §8.2, Ruling 23
export type BostaTarget =
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "delivery_failed"
  | "returned"
  | "cancelled"
  | "exception";
export function mapBostaState(
  state: number,
  type: string | undefined,
): { readonly target: BostaTarget | null; readonly label: string };
export function bostaScanText(
  state: number,
  type: string | undefined,
  exceptionReason: string | undefined,
): string; // Ruling 22

// webhook.ts
export interface BostaWebhook {
  readonly trackingNumber: string;
  readonly state: number;
  readonly type?: string;
  readonly timeStamp?: number;
  readonly exceptionReason?: string;
  readonly exceptionCode?: number;
  readonly businessReference?: string;
  readonly cod?: number;
  readonly numberOfAttempts?: number;
}
export const BOSTA_WEBHOOK_MAX_BYTES = 16_384;
/** Allow-listed fields only; null when not a Bosta delivery update. */
export function parseBostaWebhook(raw: Uint8Array): BostaWebhook | null;
/** `${trackingNumber}:${state}:${timeStamp ?? "none"}` (spec §8.5). */
export function bostaWebhookEventId(webhook: BostaWebhook): string;
```

**What `checkParcel` checks, in order.** It returns the first problem:

| Check                                                          | Problem                                                                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `currency !== "EGP"`                                           | `CURRENCY_NOT_SUPPORTED`                                               |
| COD not a safe integer `0 … 3_000_000`                         | `COD_INVALID` (negative or not an integer) / `COD_ABOVE_CARRIER_LIMIT` |
| `country !== "EG"`                                             | `ADDRESS_NOT_SHIPPABLE` / `COUNTRY_NOT_SUPPORTED`                      |
| no `province`                                                  | `ADDRESS_NOT_SHIPPABLE` / `PROVINCE_MISSING`                           |
| province not in `PROVINCES.EG`                                 | `ADDRESS_NOT_SHIPPABLE` / `PROVINCE_UNKNOWN`                           |
| `city.trim()` empty                                            | `ADDRESS_NOT_SHIPPABLE` / `DISTRICT_MISSING`                           |
| `[line1, line2].filter(Boolean).join(", ").trim().length <= 5` | `ADDRESS_NOT_SHIPPABLE` / `ADDRESS_LINE_TOO_SHORT`                     |
| `recipient.name.trim()` empty                                  | `ADDRESS_NOT_SHIPPABLE` / `RECIPIENT_MISSING`                          |
| `toBostaPhone(phone) === null`                                 | `PHONE_NOT_SHIPPABLE`                                                  |
| `config.allowToOpenPackage` and no https image                 | `OPEN_PACKAGE_NEEDS_IMAGES`                                            |

**The payload `buildDeliveryPayload` produces:**

```ts
{
  type: 10,
  specs: { packageType: "Parcel", size: "SMALL", packageDetails: { itemsCount, description: describeItems(description) } },
  cod: codAmountMinor / 100,
  dropOffAddress: { city: city.name, cityId: city._id, districtName: address.city.trim(), firstLine },
  receiver: { firstName, lastName, phone: toBostaPhone(phone) },
  businessReference: reference,
  uniqueBusinessReference: reference,
  allowToOpenPackage: config.allowToOpenPackage,
  ...(config.allowToOpenPackage
    ? { deliveryImages: [{ type: "ALLOW_TO_OPEN_THE_PACKAGE", images: httpsImages.slice(0, 10) }] }
    : {}),
  escrowInfo: { isExcluded: true },
  ...(webhookUrl !== null ? { webhookUrl, webhookCustomHeaders: webhookHeaders } : {}),
}
```

**`toBostaPhone`** (Ruling 17):

```ts
export function toBostaPhone(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const ascii = raw.replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0x0f));
  const compact = ascii.replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(compact)) return null;
  let national = compact.replace(/^\+/, "");
  if (national.startsWith("0020")) national = national.slice(4);
  else if (national.startsWith("20") && national.length === 12) national = national.slice(2);
  if (national.length === 10 && national.startsWith("1")) national = `0${national}`;
  return /^01[0125]\d{8}$/.test(national) ? national : null;
}
```

**The state map** (`mapBostaState`; labels from F14):

| State              | Target                                         |
| ------------------ | ---------------------------------------------- |
| 10, 11, 20         | `null`                                         |
| 21, 24, 30         | `in_transit`                                   |
| 41, type `SEND`    | `out_for_delivery`                             |
| 41, any other type | `null`                                         |
| 45                 | `delivered`                                    |
| 47                 | `delivery_failed`                              |
| 46, 60             | `returned`                                     |
| 48, 49             | `cancelled`                                    |
| 100, 101           | `exception`                                    |
| anything else      | `null`, label `"Bosta state <n>"` when unknown |

**`parseBostaWebhook`** rules:

- The input must be ≤ 16 KiB and a JSON object.
- `trackingNumber` is a string or a finite integer, turned into a string matching `/^[A-Za-z0-9-]{1,32}$/`.
- `state` is an integer.
- `type` is a string of ≤ 40 characters.
- `timeStamp` is finite.
- `exceptionReason` is clipped to 200 characters.
- Every other key is dropped.

- [ ] **Step 1: Write the failing tests** (a selection; each file has one `describe`):

```ts
// phone.test.ts
it.each([
  ["01065685435", "01065685435"], // F2's documented receiver phone
  ["+201065685435", "01065685435"],
  ["00201065685435", "01065685435"],
  ["201065685435", "01065685435"],
  ["1065685435", "01065685435"],
  ["٠١٠٦٥٦٨٥٤٣٥", "01065685435"],
  ["010 6568-5435", "01065685435"],
  ["01565685435", "01565685435"],
])("%s → %s", (raw, out) => expect(toBostaPhone(raw)).toBe(out));
it.each(["", "0226385555", "01365685435", "+966501234567", "0106568543", "phone", undefined])(
  "refuses %j",
  (raw) => expect(toBostaPhone(raw)).toBeNull(),
);

// delivery-request.test.ts
const parcel = (over: Partial<BostaParcel> = {}): BostaParcel => ({
  recipient: { name: "Sasuke Uchiha", phone: "01065685435" },
  address: { line1: "Helwan street x", city: "Helwan", province: "EG-C", country: "EG" },
  codAmountMinor: 5000,
  currency: "EGP",
  itemsCount: 2,
  description: "Desc.",
  packageImages: [],
  ...over,
});
describe("COD (Review Focus 1, spec §8.2)", () => {
  it("converts minor to EGP with two decimals and accepts exactly 30,000", () => {
    expect(buildDeliveryPayload(payloadInput(parcel({ codAmountMinor: 1234 }))).cod).toBe(12.34);
    expect(checkParcel(parcel({ codAmountMinor: 3_000_000 }), DEFAULT_BOSTA_CONFIG)).toBeNull();
  });
  it("refuses 3,000,001, negatives and fractions before any call", () => {
    expect(checkParcel(parcel({ codAmountMinor: 3_000_001 }), DEFAULT_BOSTA_CONFIG)?.code).toBe(
      "COD_ABOVE_CARRIER_LIMIT",
    );
    expect(checkParcel(parcel({ codAmountMinor: -1 }), DEFAULT_BOSTA_CONFIG)?.code).toBe(
      "COD_INVALID",
    );
    expect(checkParcel(parcel({ codAmountMinor: 10.5 }), DEFAULT_BOSTA_CONFIG)?.code).toBe(
      "COD_INVALID",
    );
  });
});
describe("addresses (Review Focus 4, spec §8.3)", () => {
  it.each([
    [
      { address: { line1: "Helwan street x", city: "Helwan", country: "SA", province: "SA-01" } },
      "COUNTRY_NOT_SUPPORTED",
    ],
    [{ address: { line1: "Helwan street x", city: "Helwan", country: "EG" } }, "PROVINCE_MISSING"],
    [
      { address: { line1: "Helwan street x", city: "Helwan", country: "EG", province: "EG-ZZ" } },
      "PROVINCE_UNKNOWN",
    ],
    [
      { address: { line1: "St 5", city: "Helwan", country: "EG", province: "EG-C" } },
      "ADDRESS_LINE_TOO_SHORT",
    ],
    [{ recipient: { name: "  ", phone: "01065685435" } }, "RECIPIENT_MISSING"],
  ])("each unshippable address names its reason (%#)", (over, reason) => {
    expect(checkParcel(parcel(over as Partial<BostaParcel>), DEFAULT_BOSTA_CONFIG)).toEqual({
      code: "ADDRESS_NOT_SHIPPABLE",
      reason,
    });
  });
  it("line2 joins line1 to pass the 5-character rule", () => {
    expect(
      checkParcel(
        parcel({
          address: {
            line1: "St 5",
            line2: "Flat 2",
            city: "Helwan",
            province: "EG-C",
            country: "EG",
          },
        }),
        DEFAULT_BOSTA_CONFIG,
      ),
    ).toBeNull();
  });
});
it("builds the documented payload: second address format, escrow excluded, webhook headers, unique reference", () => {
  const body = buildDeliveryPayload({
    parcel: parcel(),
    reference: "1001-1",
    city: { _id: "FceDyHXwpSYYF9zGW", name: "Cairo" },
    config: DEFAULT_BOSTA_CONFIG,
    webhookUrl: "https://api.example/api/v1/public/shipping/webhook/bosta",
    webhookHeaders: { "x-tenant-id": "t-1", Authorization: "s3cret" },
  });
  expect(body).toMatchObject({
    type: 10,
    specs: {
      packageType: "Parcel",
      size: "SMALL",
      packageDetails: { itemsCount: 2, description: "Desc." },
    },
    cod: 50,
    dropOffAddress: {
      city: "Cairo",
      cityId: "FceDyHXwpSYYF9zGW",
      districtName: "Helwan",
      firstLine: "Helwan street x",
    },
    receiver: { firstName: "Sasuke", lastName: "Uchiha", phone: "01065685435" },
    businessReference: "1001-1",
    uniqueBusinessReference: "1001-1",
    allowToOpenPackage: false,
    escrowInfo: { isExcluded: true },
    webhookCustomHeaders: { "x-tenant-id": "t-1", Authorization: "s3cret" },
  });
  expect(body).not.toHaveProperty("deliveryImages");
  expect(body).not.toHaveProperty("goodsInfo");
});
it("allowToOpenPackage sends up to 10 https images, else OPEN_PACKAGE_NEEDS_IMAGES (F5)", () => {
  /* … */
});
it('a single-word name gets lastName "-" (spec §8.3)', () =>
  expect(splitReceiverName("Ahmed")).toEqual({ firstName: "Ahmed", lastName: "-" }));

// governorates.test.ts — uses F10's documented rows plus rows marked as modelled
it("matches by Arabic name first, then English alias; skips cities without drop-off", () => {
  const cities: BostaCity[] = [
    {
      _id: "FceDyHXwpSYYF9zGW",
      name: "Cairo",
      nameAr: "القاهرة",
      code: "EG-01",
      dropOffAvailability: true,
    },
    {
      _id: "Jrb6X6ucjiYgMP4T7",
      name: "Alexandria",
      nameAr: "الإسكندرية",
      code: "EG-02",
      dropOffAvailability: true,
    },
    { _id: "modelled-kfs", name: "Kafr Alsheikh", nameAr: "كفر الشيخ", dropOffAvailability: true },
    { _id: "modelled-red", name: "Red Sea", nameAr: "البحر الاحمر", dropOffAvailability: false },
  ];
  expect(matchBostaCity("EG-C", cities)?._id).toBe("FceDyHXwpSYYF9zGW");
  expect(matchBostaCity("EG-ALX", cities)?._id).toBe("Jrb6X6ucjiYgMP4T7");
  expect(matchBostaCity("EG-KFS", cities)?._id).toBe("modelled-kfs");
  expect(matchBostaCity("EG-BA", cities)).toBeNull();
  expect(matchBostaCity("EG-SUZ", cities)).toBeNull();
});
it("every one of the 27 EG provinces has a candidate entry", () => {
  expect(PROVINCES.EG!.length).toBe(27);
});

// states.test.ts — one row per table line (spec §8.2 "a test per row")
it.each([
  [10, "SEND", null],
  [11, "SEND", null],
  [20, "SEND", null],
  [21, "SEND", "in_transit"],
  [24, "SEND", "in_transit"],
  [30, "SEND", "in_transit"],
  [41, "SEND", "out_for_delivery"],
  [41, "RTO", null],
  [45, "SEND", "delivered"],
  [47, "SEND", "delivery_failed"],
  [46, "RTO", "returned"],
  [60, "FXF_SEND", "returned"],
  [48, "SEND", "cancelled"],
  [49, "SEND", "cancelled"],
  [100, "SEND", "exception"],
  [101, "SEND", "exception"],
  [102, "SEND", null],
  [999, "SEND", null],
])("state %i (%s) → %s", (state, type, target) =>
  expect(mapBostaState(state, type).target).toBe(target),
);

// webhook.test.ts
it("parses F13's documented examples, number tracking numbers become strings", () => {
  const parsed = parseBostaWebhook(bytesOf(webhook24));
  expect(parsed).toEqual({
    trackingNumber: "48089608",
    state: 24,
    type: "SEND",
    timeStamp: 1689252908261,
    numberOfAttempts: 0,
  });
  expect(bostaWebhookEventId(parsed!)).toBe("48089608:24:1689252908261");
  expect(parseBostaWebhook(bytesOf(webhook47))?.exceptionReason).toMatch(/^Postponed/);
});
it("drops unknown keys and refuses non-objects, missing fields and oversize bodies", () => {
  /* … */
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm install --offline && pnpm --filter @platform/carrier-bosta test`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement** the files.
  - **`BOSTA_ENGLISH_ALIASES`** holds at least: `EG-KFS: ["kafr alsheikh", "kafr el-sheikh"]`, `EG-MNF: ["menofia", "monofia"]`, `EG-SHR: ["sharkia", "sharqia", "el sharqia"]`, `EG-KB: ["qalyubia", "kalyubia"]`, `EG-BH: ["behira", "beheira"]`, `EG-BNS: ["bani suif", "beni suef"]`, `EG-FYM: ["fayoum", "faiyum"]`, `EG-PTS: ["port said"]`, `EG-JS: ["south sinai"]`, `EG-SIN: ["north sinai"]`, `EG-WAD: ["new valley", "el wadi el gedid"]`.
  - **`normalizeArabic`:** strip U+0640 and whitespace; map `[أإآ]`→`ا`, `ة`→`ه`, `ى`→`ي`.
  - **`index.ts`** exports everything above.

- [ ] **Step 4: Run** `pnpm --filter @platform/carrier-bosta test && pnpm --filter @platform/carrier-bosta exec vitest run --coverage && pnpm --filter @platform/carrier-bosta typecheck && pnpm --filter @platform/carrier-bosta lint`. Expected: PASS, coverage ≥ 80.

- [ ] **Step 5: Commit** `packages/carrier-bosta` and `pnpm-lock.yaml` with `feat(carrier-bosta): egyptian address, phone, cod and state rules for bosta`.

**Amendments (binding) — implementer: terra. Review depth: strong.**

1. **F3:**

   ```ts
   export type BostaRejectionCode =
     | "ADDRESS_NOT_SHIPPABLE"
     | "PHONE_NOT_SHIPPABLE"
     | "COD_ABOVE_CARRIER_LIMIT"
     | "COD_INVALID"
     | "CURRENCY_NOT_SUPPORTED"
     | "OPEN_PACKAGE_NEEDS_IMAGES"
     | "CARRIER_REJECTED"
     | "CARRIER_CANCEL_REFUSED";
   ```

   `BostaProblem.code` and `BostaApiError.code` are typed `BostaRejectionCode` (not `string`). Export the type from `index.ts`.

2. **F15 — the state map is type-gated (replaces the 21/24/30 and 47 rows):**
   - 21, 24, 30 → `in_transit`, and 47 → `delivery_failed`, **only when** `type` is `"SEND"`, `"FXF_SEND"` or `undefined`.
   - Any other type gives `target: null` (a scan).
   - 41 stays `SEND`-only.

   Add these rows to `states.test.ts`:
   - `[24, "RTO", null]`
   - `[47, "RTO", null]`
   - `[24, undefined, "in_transit"]`
   - `[30, "FXF_SEND", "in_transit"]`
   - `[21, "CRP", null]`

3. **Labels** (`label` from `mapBostaState`, from F14):

   | State | Label                                                               |
   | ----- | ------------------------------------------------------------------- |
   | 10    | `"Pickup requested"`                                                |
   | 11    | `"Waiting for route"`                                               |
   | 20    | `"Route assigned"`                                                  |
   | 21    | `"Picked up from business"`                                         |
   | 22    | `"Picking up from consignee"`                                       |
   | 23    | `"Picked up from consignee"`                                        |
   | 24    | `"Received at warehouse"`                                           |
   | 25    | `"Fulfilled"`                                                       |
   | 30    | `"In transit between hubs"`                                         |
   | 40    | `"Picking up"`                                                      |
   | 41    | `"Out for delivery"` (type SEND) / `"Out for return"` (other types) |
   | 45    | `"Delivered"`                                                       |
   | 46    | `"Returned to business"`                                            |
   | 47    | `"Exception"`                                                       |
   | 48    | `"Terminated"`                                                      |
   | 49    | `"Canceled"`                                                        |
   | 60    | `"Returned to stock"`                                               |
   | 100   | `"Lost"`                                                            |
   | 101   | `"Damaged"`                                                         |
   | 102   | `"Investigation"`                                                   |
   | 103   | `"Awaiting your action"`                                            |
   | 104   | `"Archived"`                                                        |
   | 105   | `"On hold"`                                                         |
   | other | `"Bosta state <n>"`                                                 |

   `bostaScanText`:
   - is the label;
   - for 47 with a non-empty `exceptionReason` it is `"Exception: <reason>"`, clipped so the whole string is ≤ 200 characters.

   Tests:
   - `bostaScanText(24, "SEND", undefined) === "Received at warehouse"`;
   - `bostaScanText(47, "SEND", "Postponed")` → `"Exception: Postponed"`;
   - a 300-character reason → length 200;
   - `bostaScanText(999, "SEND", undefined) === "Bosta state 999"`.

4. **`parseBostaConfig` tests:**
   - `undefined` / `{}` → ok with `DEFAULT_BOSTA_CONFIG`;
   - `{ awbFormat: "A4", extra: 1 }` → ok `{ awbFormat: "A4", awbLanguage: "ar", allowToOpenPackage: false }` (no `extra`);
   - `{ awbFormat: "Z" }` → `{ ok: false, reason: "awbFormat" }`;
   - `{ awbLanguage: "fr" }` → reason `"awbLanguage"`;
   - `{ allowToOpenPackage: "yes" }` → reason `"allowToOpenPackage"`;
   - `"x"` and `[]` → reason `"config"`.
5. **Fill "allowToOpenPackage …" (F5, Ruling 15).** `cfg = { ...DEFAULT_BOSTA_CONFIG, allowToOpenPackage: true }`.
   - `packageImages = ["http://a/x.jpg", "https://a/1.jpg", "https://a/1.jpg", ...11 more distinct https URLs]` → `checkParcel` is `null`.
   - The payload's `deliveryImages` deep-equals `[{ type: "ALLOW_TO_OPEN_THE_PACKAGE", images: <the first 10 distinct https URLs, in order> }]`, with no http URL and `allowToOpenPackage: true`.
   - `packageImages = ["http://a/x.jpg"]` → `checkParcel` deep-equals `{ code: "OPEN_PACKAGE_NEEDS_IMAGES" }`.
6. **Fill "drops unknown keys …":**
   - `{ ...webhook24, extra: "x" }` → deep-equals the same object as the webhook24 case;
   - `parseBostaWebhook` returns `null` for each of these: `[1]`, `"str"`, the bytes `"{not json"`, an object without `trackingNumber`, `state: "24"` (a string), `trackingNumber: "a b"`, and a valid object padded to 16,385 bytes;
   - an `exceptionReason` of 300 characters comes back as 200.
7. **More checks:**
   - `checkParcel(parcel({ currency: "USD" }))` → `{ code: "CURRENCY_NOT_SUPPORTED" }`;
   - `address.city: " "` → reason `DISTRICT_MISSING`;
   - a bad phone → `{ code: "PHONE_NOT_SHIPPABLE" }`;
   - `describeItems` of 250 characters → 200 characters ending in `"…"`;
   - `buildDeliveryPayload` with `webhookUrl: null` has neither `webhookUrl` nor `webhookCustomHeaders`.
8. **`governorates.test.ts`:** also check that every one of the 27 `PROVINCES.EG` ISO codes appears in the candidate table (Arabic name from regions plus `BOSTA_ENGLISH_ALIASES` where listed). The test title already promises this; assert it by iterating the 27 codes.

---

### Task 6: `@platform/carrier-bosta` — HTTP client, city directory and `BostaCarrierProvider`

Model tier: **strong** (no body may leak; every failure must be classified right).

**Files:**

- Create: `packages/carrier-bosta/src/http.ts`, `cities.ts`, `client.ts`, `provider.ts` (+ `client.test.ts`, `cities.test.ts`, `bosta-carrier-provider.test.ts`)
- Create these fixtures:

  | Fixture                         | Source                                            |
  | ------------------------------- | ------------------------------------------------- |
  | `create-delivery.response.json` | F3, verbatim                                      |
  | `error.401.json`                | F3                                                |
  | `error.3003.modelled.json`      | F3 envelope + F6 code                             |
  | `terminate.response.json`       | F8                                                |
  | `terminate.404.json`            | F8                                                |
  | `get-delivery.response.json`    | F9, trimmed to the documented keys                |
  | `cities.response.json`          | F10's two documented rows                         |
  | `search.single.json`            | F7's documented example                           |
  | `search.list.modelled.json`     | U2                                                |
  | `mass-awb.modelled.json`        | U1; `data` = base64 of a 32-byte `%PDF-1.4…%%EOF` |

- Modify: `packages/carrier-bosta/src/index.ts`

**Interfaces:**

- Consumes: Task 5 (`BostaApiError`, `checkParcel`, `buildDeliveryPayload`, `matchBostaCity`, `mapBostaState`, `BostaConfig`).
- Produces:

```ts
// http.ts
export type HttpFetch = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly status: number;
  readonly headers?: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;
export const BOSTA_BASE_URL = "https://app.bosta.co/api/v2";
export const DEFAULT_TIMEOUT_MS = 10_000;

// cities.ts — Ruling 9 (process-wide; no tenant)
export const EGYPT_COUNTRY_ID = "60e4482c7cb7d4bc4849c4d5";
export const CITY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export class BostaCityDirectory {
  constructor(now?: () => number);
  /** Cached per countryId; a failed fetch is never cached. */
  cities(
    countryId: string,
    fetchList: () => Promise<readonly BostaCity[]>,
  ): Promise<readonly BostaCity[]>;
}

// client.ts
export interface BostaClientOptions {
  readonly apiKey: string;
  readonly fetch: HttpFetch;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
}
export class BostaClient {
  constructor(options: BostaClientOptions);
  createDelivery(
    payload: Record<string, unknown>,
  ): Promise<{ deliveryId: string; trackingNumber: string }>;
  searchByBusinessReference(
    reference: string,
  ): Promise<readonly { deliveryId: string; trackingNumber: string }[]>; // exact matches only
  terminate(trackingNumber: string): Promise<"cancelled" | "not_found">;
  getDelivery(
    trackingNumber: string,
  ): Promise<{ trackingNumber: string; stateCode: number; stateLabel: string; type?: string }>;
  massAwb(
    trackingNumbers: readonly string[],
    format: "A6" | "A4",
    lang: "ar" | "en",
  ): Promise<Uint8Array>;
  listCities(countryId: string): Promise<readonly BostaCity[]>;
  /** GET /pickup-locations; body discarded (Ruling 8) */
  verifyKey(): Promise<void>;
}
export function parseSearchResponse(
  body: unknown,
  reference: string,
): readonly { deliveryId: string; trackingNumber: string }[]; // U2
export function parseAwbResponse(bytes: Uint8Array): Uint8Array; // U1
export const MASS_AWB_MAX = 50;

// provider.ts — satisfies @platform/shipping's CarrierProvider structurally (Ruling 20)
export interface BostaProviderOptions {
  readonly client: BostaClient;
  readonly cities: BostaCityDirectory;
  readonly config: BostaConfig;
  readonly webhookUrl: string | null;
  readonly webhookHeaders: Readonly<Record<string, string>>;
}
export class BostaCarrierProvider {
  readonly key: "bosta";
  constructor(options: BostaProviderOptions);
  prepare(parcel: BostaParcel): Promise<BostaProblem | null>; // checkParcel, then city match (CITY_NOT_FOUND)
  createDelivery(
    request: BostaParcel & { readonly reference: string },
  ): Promise<{ deliveryId: string; trackingNumber: string }>;
  findDeliveriesByReference(
    reference: string,
  ): Promise<readonly { deliveryId: string; trackingNumber: string }[]>;
  cancelDelivery(trackingNumber: string): Promise<"cancelled" | "not_found">;
  printAwbs(
    trackingNumbers: readonly string[],
    options: { format?: "A4" | "A6"; lang?: "ar" | "en" },
  ): Promise<Uint8Array>; // defaults from config
  getDelivery(trackingNumber: string): Promise<{
    trackingNumber: string;
    stateCode: number;
    stateLabel: string;
    target: BostaTarget | null;
  }>;
  verifyCredentials(): Promise<void>;
}
```

**How every client request is sent and failures are classified:**

- Each request sends `Authorization: <apiKey>` (F1) and `Content-Type: application/json`. It runs under an `AbortController` timeout and clears the timer in `finally`.
- Abort → `BostaApiError({ carrierFailure: "unavailable", status: 0, timedOut: true, message: "Bosta request timed out" })`.
- Network error → `unavailable`, status 0.
- 401/403 → `credentials_rejected`.
- 5xx or a non-JSON body → `unavailable`.
- 400/404/422 → `rejected`. `code` and `reason` come from the errorCode table:

  | errorCode        | code / reason                               |
  | ---------------- | ------------------------------------------- |
  | 3001             | `ADDRESS_NOT_SHIPPABLE` / `CITY_NOT_FOUND`  |
  | 3002             | `ZONE_NOT_FOUND`                            |
  | 3003             | `DISTRICT_NOT_FOUND`                        |
  | 3004             | `STREET_NOT_FOUND`                          |
  | 3009             | `ADDRESS_INCOMPLETE`                        |
  | 3007             | `COD_ABOVE_CARRIER_LIMIT`                   |
  | 2150, 2151, 2152 | `OPEN_PACKAGE_NEEDS_IMAGES`                 |
  | 1073             | `CARRIER_REJECTED` / `NO_BUSINESS_LOCATION` |
  | anything else    | `CARRIER_REJECTED`                          |

- `success: false` on a 2xx is classified as `rejected` too.
- **Error messages are fixed English sentences.** They contain no body text, no `message` field and no key, e.g. `"Bosta refused the delivery (HTTP 400, errorCode 3003)"`.

**`massAwb`** throws a plain `Error` before sending when `trackingNumbers.length` is 0 or more than 50. It reads `arrayBuffer()` and returns `parseAwbResponse(bytes)`:

- if the bytes start with `%PDF-`, return them;
- else UTF-8-decode and JSON-parse them, take `data` (a string) or `data.data`, strip `^data:application/pdf;base64,` and base64-decode;
- the result must start with `%PDF-`, else throw `unavailable` with `"Bosta AWB response was not a PDF"`.

- [ ] **Step 1: Write the failing tests** (`bosta-carrier-provider.test.ts`; `fetch` is a `vi.fn<HttpFetch>()` returning fixtures):

```ts
const ok = (status: number, body: unknown) => ({
  status,
  text: () => Promise.resolve(JSON.stringify(body)),
  arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(body)).buffer),
});

it("POSTs /deliveries?apiVersion=1 with the raw key and returns _id + trackingNumber (F1–F3)", async () => {
  const fetch = vi
    .fn<HttpFetch>()
    .mockResolvedValueOnce(ok(200, cities)) // GET /cities?countryId=60e4…
    .mockResolvedValueOnce(ok(200, createResponse)); // POST /deliveries?apiVersion=1
  const provider = bosta(fetch);
  const created = await provider.createDelivery({ ...parcel(), reference: "1001-1" });
  expect(created).toEqual({ deliveryId: "Lx9vyKBqAeiIcERQKfn6I", trackingNumber: "5108002" });
  const [url, init] = fetch.mock.calls[1]!;
  expect(url).toBe("https://app.bosta.co/api/v2/deliveries?apiVersion=1");
  expect(init?.headers?.Authorization).toBe("bosta-api-key");
  expect(fetch.mock.calls[0]![0]).toBe(
    "https://app.bosta.co/api/v2/cities?countryId=60e4482c7cb7d4bc4849c4d5",
  );
});
it("3003 is ADDRESS_NOT_SHIPPABLE/DISTRICT_NOT_FOUND without the body (Review Focus 4)", async () => {
  const fetch = vi
    .fn<HttpFetch>()
    .mockResolvedValueOnce(ok(200, cities))
    .mockResolvedValueOnce(ok(400, error3003));
  const failure = await bosta(fetch)
    .createDelivery({ ...parcel(), reference: "1001-1" })
    .catch((e: unknown) => e);
  expect(failure).toMatchObject({
    carrierFailure: "rejected",
    code: "ADDRESS_NOT_SHIPPABLE",
    reason: "DISTRICT_NOT_FOUND",
  });
  expect(String((failure as Error).message)).not.toContain(error3003.message);
});
it("401 is credentials_rejected; 500, a timeout and non-JSON are unavailable", async () => {
  /* … uses vi.useFakeTimers for the 10 s abort */
});
it("prepare finds no city → ADDRESS_NOT_SHIPPABLE/CITY_NOT_FOUND, and makes no create call", async () => {
  /* … */
});
it("the city list is fetched once per country across two tenants' providers, and a failure is not cached", async () => {
  /* … */
});
it("search keeps only exact businessReference matches, from any of the three shapes (U2)", () => {
  expect(parseSearchResponse(searchSingle, "12345678")).toEqual([
    { deliveryId: "Lx9vyKBqAeiIcERQKfn6I", trackingNumber: "5108002" },
  ]);
  expect(parseSearchResponse(searchSingle, "1234567")).toEqual([]);
  expect(
    parseSearchResponse({ data: { deliveries: [searchSingle.data] } }, "12345678"),
  ).toHaveLength(1);
  expect(
    parseSearchResponse({ data: [searchSingle.data, searchSingle.data] }, "12345678"),
  ).toHaveLength(2);
});
it("terminate: 200 cancelled, 404/1066 not_found, 400 rejected CARRIER_CANCEL_REFUSED (F8, Ruling 1)", async () => {
  /* … DELETE /deliveries/business/5108002/terminate */
});
it("mass-awb joins tracking numbers with commas, decodes base64 and refuses >50 (F12, U1)", async () => {
  const fetch = vi.fn<HttpFetch>().mockResolvedValueOnce(ok(200, massAwb));
  const pdf = await bosta(fetch).printAwbs(["77873113", "77873114"], {});
  expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
  expect(JSON.parse(fetch.mock.calls[0]![1]!.body!)).toEqual({
    trackingNumbers: "77873113,77873114",
    requestedAwbType: "A6",
    lang: "ar",
  });
  await expect(
    bosta(fetch).printAwbs(
      Array.from({ length: 51 }, (_, i) => String(i)),
      {},
    ),
  ).rejects.toThrow(/50/);
});
it("verifyCredentials calls GET /pickup-locations (Ruling 8)", async () => {
  /* … */
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/carrier-bosta exec vitest run src/bosta-carrier-provider.test.ts src/client.test.ts src/cities.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement** the client, the directory and the provider.
  - `prepare` resolves the cities with `cities.cities(EGYPT_COUNTRY_ID, () => client.listCities(EGYPT_COUNTRY_ID))`. A city-fetch failure propagates as `unavailable`; it is never a problem.
  - `createDelivery` re-runs `prepare`, so a problem throws `rejected` with that code. Then it builds the payload and posts it.

- [ ] **Step 4: Run** the package's test, coverage, typecheck and lint commands (as in Task 5). Expected: PASS, coverage ≥ 80.

- [ ] **Step 5: Commit** with `feat(carrier-bosta): bosta rest client, cached city directory and carrier provider`.

**Amendments (binding) — implementer: sonnet. Review depth: strong.**

1. **F1 — `parseSearchResponse` accepts only recognised shapes (replaces "accepts all three").** For `body` (already JSON-parsed):
   - `body.success === false` → throw `BostaApiError({ carrierFailure: "unavailable", status: 200, message: "Bosta search response not recognised" })`.
   - `Array.isArray(body.data)` → use it.
   - `Array.isArray(body.data?.deliveries)` → use it.
   - `body.data` is an object with a string `_id` → `[body.data]`.
   - Anything else (`data: null`, `data: { list: [] }`, a string, a number) → the same throw.
   - From the recognised list, keep the items whose `businessReference === reference` and that have string `_id` and `trackingNumber` (a numeric `trackingNumber` becomes `String(n)`).
   - `{ data: [] }` and `{ data: { deliveries: [] } }` → `[]`.

   Test "an unknown shape throws, never []": each bad shape above rejects with `{ carrierFailure: "unavailable" }`. `searchByBusinessReference` with a 401 → `credentials_rejected` (Task 7 treats that as unknown).

2. **F14.** `errorCode` is read as `Number(body.errorCode)`. Test: `{ success: false, errorCode: "3003" }` with 400 → the same classification as the number 3003.
3. **F3 compile check** in `bosta-carrier-provider.test.ts`: `const problem: { readonly code: BostaRejectionCode; readonly reason?: string } | null = await bosta(fetch).prepare(parcel());`. It must type-check (`typecheck` in Step 4).
4. **Fill the empty tests.** Expected values:
   - **401/500/timeout/non-JSON:**
     - 401 fixture → rejects `{ carrierFailure: "credentials_rejected", status: 401 }`;
     - 500 → `{ carrierFailure: "unavailable", status: 500 }`;
     - 200 with body `"<html>"` → `{ carrierFailure: "unavailable" }`;
     - fetch rejecting `new TypeError("fetch failed")` → `{ carrierFailure: "unavailable", status: 0, timedOut: false }`;
     - timeout: `vi.useFakeTimers()`, with a fetch that resolves only when its `signal` aborts (it rejects with an `AbortError` on abort); advance 10,000 ms → rejects `{ carrierFailure: "unavailable", status: 0, timedOut: true }` with message `"Bosta request timed out"`;
     - no error message contains the fixture's `message` text or the API key.
   - **Prepare finds no city.** Cities fixture = Cairo and Alexandria only; `parcel({ address: { ..., province: "EG-SUZ" } })`.
     - `prepare` → `{ code: "ADDRESS_NOT_SHIPPABLE", reason: "CITY_NOT_FOUND" }`.
     - `createDelivery` with that parcel rejects `{ carrierFailure: "rejected", code: "ADDRESS_NOT_SHIPPABLE", reason: "CITY_NOT_FOUND" }`.
     - `fetch` was called only for `/cities` (1 call per provider when the directory is fresh).
   - **City cache.** One `BostaCityDirectory(() => now)` shared by two providers with different API keys.
     - Both `prepare` calls → `fetch` was called for `/cities` once.
     - Advance `now` by `CITY_CACHE_TTL_MS + 1` → the next `prepare` fetches again.
     - A first `fetchList` that rejects is not cached: the second call fetches again and succeeds.
   - **Terminate:**
     - 200 fixture → `"cancelled"`, method `DELETE`, URL `https://app.bosta.co/api/v2/deliveries/business/5108002/terminate`;
     - 404 with errorCode 1066 → `"not_found"`;
     - 404 without 1066, or 400 → rejects `{ carrierFailure: "rejected", code: "CARRIER_CANCEL_REFUSED" }`;
     - 503 → `unavailable`.
   - **verifyCredentials:**
     - `GET https://app.bosta.co/api/v2/pickup-locations` with header `Authorization` equal to the raw key;
     - 200 → resolves `undefined` (the body is never parsed: give it `"not json"` and it still resolves);
     - 401 and 403 → `credentials_rejected`;
     - 500 → `unavailable`.
   - **Mass-AWB, more cases:**
     - `[]` → rejects `/50|empty|1/` before any fetch;
     - a response that is raw `%PDF-1.4…` bytes → returned unchanged;
     - `{ data: { data: "<base64>" } }` and `{ data: "data:application/pdf;base64,<base64>" }` → decoded PDF;
     - `{ data: "aGVsbG8=" }` → rejects `{ carrierFailure: "unavailable" }` with message `"Bosta AWB response was not a PDF"`.
   - **getDelivery:** the fixture → `{ trackingNumber: <fixture tn as string>, stateCode: <fixture code>, stateLabel: mapBostaState(code, type).label, target: mapBostaState(code, type).target }`.
5. **`createDelivery` with `webhookUrl: null`:** the posted body has no `webhookUrl` key.

6. **Plan review 1, finding 3: an unreadable matching row is never treated as absence.**
   - Within a recognised list, each element must be an object.
   - An element whose `businessReference` is not a string → throw `unavailable` ("Bosta search response not recognised").
   - An element whose `businessReference === reference` but whose `_id` is not a non-empty string, or whose `trackingNumber` is neither a non-empty string nor a finite number → the same throw.
   - Only well-formed **non-matching** elements are dropped.

   Tests:
   - `{ data: [{ businessReference: "1001-1", _id: "live", trackingNumber: null }] }` with reference `"1001-1"` → throws `unavailable` (never `[]`);
   - `{ data: [42] }` → throws;
   - `{ data: [{ businessReference: "other", _id: "x", trackingNumber: "1" }] }` → `[]`.

   (Task 7 adds the consumer test.)

---

### Task 7: Extended `CreateLabel`, `CancelCarrierShipment`, `PrintCarrierAwbs`, `GetShipment`

Model tier: **strong** (Review Focus 2).

**Files:**

- Create: `services/shipping/src/application/create-label.carrier.test.ts`
- Create: `services/shipping/src/application/carrier-shipment.use-cases.ts`, `carrier-shipment.use-cases.test.ts`
- Modify: `services/shipping/src/application/shipment-lifecycle.use-cases.ts`, `src/interfaces/shipping.controller.ts`, `src/composition.ts`, `src/index.ts`

**Interfaces:**

- Consumes: Task 1 (`beginLabelAttempt`, `failLabelAttempt`, `markCarrierResultUnknown`, `pendingLabelAttempt`, `nextLabelReference`, `CarrierError`); Task 3 (`CarrierResolver`, `CarrierResolutionError`, `carrierFailureOf`, `CarrierParcelRequest`).
- Produces:

```ts
// shipment-lifecycle.use-cases.ts
export interface CarrierLabelDetails extends CarrierParcelRequest {
  readonly carrierKey: string;
  /** The order number; CreateLabel appends "-<seq>" (Ruling 4). */
  readonly reference: string;
}
export interface CreateLabelInput extends ShipmentIdInput { readonly carrier?: CarrierLabelDetails }
export interface CreateLabelOutput extends ShipmentStatusOutput {
  readonly trackingNumber?: string; readonly carrierDeliveryId?: string; readonly carrierKey?: string;
}
export interface CreateLabelDeps extends ShipmentLifecycleDeps {
  readonly carrierProvider: CarrierProviderPort; // legacy path, unchanged
  readonly carriers?: CarrierResolver;
}
export const IN_FLIGHT_GRACE_MS = 120_000; // Ruling 5
export class CreateLabel { execute(input: CreateLabelInput): Promise<Result<CreateLabelOutput, DomainError>> }

// carrier-shipment.use-cases.ts
export interface CarrierShipmentDeps extends ShipmentLifecycleDeps { readonly carriers: CarrierResolver }
export class CancelCarrierShipment {
  execute(i: ShipmentIdInput): Promise<Result<ShipmentStatusOutput & { readonly fulfillmentRef: string }, DomainError>>;
}
export interface PrintCarrierAwbsInput {
  readonly tenantId: string; readonly shipmentIds: readonly string[]; readonly format?: "A4" | "A6"; readonly lang?: "ar" | "en";
}
export class PrintCarrierAwbs { execute(i: PrintCarrierAwbsInput): Promise<Result<{ readonly pdf: Uint8Array }, DomainError>> }
export class GetShipment { execute(i: ShipmentIdInput): Promise<Result<Shipment, DomainError>> }

// ShippingController
createLabel(input: CreateLabelInput): Promise<ControllerResponse>; // widened
cancelCarrierShipment(input: ShipmentIdInput): Promise<ControllerResponse>;
printCarrierAwbs(input: PrintCarrierAwbsInput): Promise<ControllerResponse>; // body { pdf: Uint8Array }
getShipment(input: ShipmentIdInput): Promise<ControllerResponse>; // body Shipment
```

**`CreateLabel` carrier path** (`input.carrier` set; without it, the legacy path is byte-for-byte unchanged):

1. **Resolve.** `carriers.resolve(tenantId, carrierKey, "new_shipment")`. A `CarrierResolutionError(code)` → `CarrierError(code, …, 409)`. If `deps.carriers` is undefined → `CARRIER_NOT_AVAILABLE`.
2. **Prepare** (outside any transaction): `provider.prepare(parcel)`. A problem → `CarrierError(problem.code, …, 422, problem.reason)`, and **nothing is written**. An `unavailable` failure → `CARRIER_UNAVAILABLE` (503).
3. **Precheck** (one transaction, inside `withConcurrencyRetry`):
   - not found → `NotFoundError`;
   - `label_created` → return `{ status, trackingNumber, carrierDeliveryId, carrierKey }` and stop (Ruling 35);
   - `exception` → `SHIPMENT_NEEDS_REVIEW` (409, Ruling 42);
   - an open pending attempt → `{ mode: "resume", reference, startedAt }`;
   - otherwise `canTransitionShipment(status, "label_created")` must hold, else `BusinessRuleError`. Then `reference = nextLabelReference(details.reference)` and `beginLabelAttempt(reference, now)`. Save → `{ mode: "fresh", reference }`.
4. **Resume:**
   - `now − startedAt < 120 s` → `CARRIER_CREATE_IN_PROGRESS` (409), with no carrier call;
   - otherwise `findDeliveriesByReference(reference)`. Exactly 1 → settle success. More than 1, or any failure → unknown (step 6). 0 → create (step 5) with `resumed = true`.
5. **Create.** `createDelivery({ ...parcel, reference })`:
   - success → settle success;
   - `rejected`, not resumed → append `failLabelAttempt(reference)`. Return `CarrierError(failure.code ?? "CARRIER_REJECTED", …, 422, failure.reason)`;
   - `rejected`, resumed → unknown (Ruling 3);
   - `credentials_rejected` → `failLabelAttempt` and `CARRIER_CREDENTIALS_REJECTED` (409);
   - `unavailable` → the attempt **stays pending**; return `CARRIER_TIMEOUT` when `timedOut`, else `CARRIER_UNAVAILABLE` (503).
6. **Unknown.** A transaction calls `markCarrierResultUnknown(reference, …)` and saves. Return `CARRIER_RESULT_UNKNOWN` (409).

**Settle success:** re-read the shipment. If it isn't `label_created`, build the label and call `createLabel(...)`:

- `ShippingLabel.create(deliveryId, trackingNumber, deliveryId)`;
- `Carrier.create(carrierKey)`;
- `CarrierService.create("standard")`;
- `TrackingNumber.create(trackingNumber)`;
- with `reference`.

Save, then return.

**`CancelCarrierShipment`** (Ruling 1):

- **Precheck:** not found → 404. `voided` → idempotent ok. No label or no carrier → `ValidationError`. A status other than `label_created` → `CARRIER_CANCEL_NOT_ALLOWED` (409).
- **Call:** `resolve(…, "existing_shipment")`, then `cancelDelivery(tn)`. `cancelled` and `not_found` both go on to settle. `rejected` → `CARRIER_CANCEL_REFUSED` (409). `unavailable` → `CARRIER_UNAVAILABLE` (503).
- **Settle:** `voidLabel`.

**`PrintCarrierAwbs`:**

- 1–50 ids, deduplicated.
- Each shipment loads tenant-scoped; a missing one → `NotFoundError`, so another tenant's id reads as "not found".
- Each needs a label and a status other than `created` / `voided` / `cancelled`, else `AWB_NOT_AVAILABLE` (409).
- One carrier for all, else `AWB_MIXED_CARRIERS` (422).
- Then `resolve(existing_shipment)` and `printAwbs`.

- [ ] **Step 1: Write the failing tests** (`create-label.carrier.test.ts`). Use `PostgresLikeShipmentRepository` / `TrackingUnitOfWork` from `testing/shipping-doubles.ts`. `FakeCarrierProvider` comes from `testing/carrier-doubles.ts`; it records `prepare`/`create`/`find` calls with `openCountAtCall` and scripts each result.

```ts
const details = (over: Partial<CarrierLabelDetails> = {}): CarrierLabelDetails => ({
  carrierKey: "bosta",
  reference: "1001",
  recipient: { name: "Sasuke Uchiha", phone: "01065685435" },
  address: { line1: "Helwan street x", city: "Helwan", province: "EG-C", country: "EG" },
  codAmountMinor: 5000,
  currency: "EGP",
  itemsCount: 2,
  description: "Desc.",
  packageImages: [],
  ...over,
});

describe("CreateLabel carrier path (spec §8.6, §9a.5)", () => {
  it("creates outside any transaction, sends <order>-1 and settles label_created", async () => {
    const h = await labelHarness({ create: [{ deliveryId: "del-1", trackingNumber: "5108002" }] });
    const r = await h.createLabel.execute({
      tenantId: T,
      shipmentId: h.shipmentId,
      carrier: details(),
    });
    expect(r.ok && r.value).toMatchObject({
      status: "label_created",
      trackingNumber: "5108002",
      carrierDeliveryId: "del-1",
    });
    expect(h.provider.createCalls.map((c) => [c.request.reference, c.openCountAtCall])).toEqual([
      ["1001-1", 0],
    ]);
  });

  it("a prepare problem writes no attempt (Review Focus 4)", async () => {
    const h = await labelHarness({
      prepare: { code: "ADDRESS_NOT_SHIPPABLE", reason: "PROVINCE_MISSING" },
    });
    const r = await h.createLabel.execute({
      tenantId: T,
      shipmentId: h.shipmentId,
      carrier: details(),
    });
    expect(!r.ok && r.error).toMatchObject({
      code: "ADDRESS_NOT_SHIPPABLE",
      reason: "PROVINCE_MISSING",
      httpStatus: 422,
    });
    expect((await h.shipment()).attempts).toHaveLength(0);
    expect(h.provider.createCalls).toHaveLength(0);
  });

  it("a timeout leaves the attempt pending; the retry finds the delivery by reference and creates nothing (Review Focus 2)", async () => {
    const h = await labelHarness({
      create: [{ fail: "unavailable", timedOut: true }],
      find: [[{ deliveryId: "del-1", trackingNumber: "5108002" }]],
    });
    const first = await h.createLabel.execute({
      tenantId: T,
      shipmentId: h.shipmentId,
      carrier: details(),
    });
    expect(!first.ok && first.error.code).toBe("CARRIER_TIMEOUT");
    expect((await h.shipment()).pendingLabelAttempt()?.reference).toBe("1001-1");
    h.clock.advanceMs(IN_FLIGHT_GRACE_MS + 1);
    const retry = await h.createLabel.execute({
      tenantId: T,
      shipmentId: h.shipmentId,
      carrier: details(),
    });
    expect(retry.ok && retry.value.trackingNumber).toBe("5108002");
    expect(h.provider.findCalls).toEqual(["1001-1"]);
    expect(h.provider.createCalls).toHaveLength(1);
  });

  it("a retry inside 120 s is CARRIER_CREATE_IN_PROGRESS with no Bosta call (Ruling 5)", async () => {
    const h = await labelHarness({ create: [{ fail: "unavailable", timedOut: true }] });
    await h.createLabel.execute({ tenantId: T, shipmentId: h.shipmentId, carrier: details() });
    const r = await h.createLabel.execute({
      tenantId: T,
      shipmentId: h.shipmentId,
      carrier: details(),
    });
    expect(!r.ok && r.error.code).toBe("CARRIER_CREATE_IN_PROGRESS");
    expect(h.provider.findCalls).toHaveLength(0);
    expect(h.provider.createCalls).toHaveLength(1);
  });

  it("an ambiguous search parks the shipment; Retry ships as -2 (Ruling 2, 42)", async () => {
    const h = await labelHarness({
      create: [
        { fail: "unavailable", timedOut: true },
        { deliveryId: "del-2", trackingNumber: "5108003" },
      ],
      find: [
        [
          { deliveryId: "a", trackingNumber: "1" },
          { deliveryId: "b", trackingNumber: "2" },
        ],
      ],
    });
    await h.createLabel.execute({ tenantId: T, shipmentId: h.shipmentId, carrier: details() });
    h.clock.advanceMs(IN_FLIGHT_GRACE_MS + 1);
    const parked = await h.createLabel.execute({
      tenantId: T,
      shipmentId: h.shipmentId,
      carrier: details(),
    });
    expect(!parked.ok && parked.error.code).toBe("CARRIER_RESULT_UNKNOWN");
    expect((await h.shipment()).needsCarrierReview).toBe(true);
    const blocked = await h.createLabel.execute({
      tenantId: T,
      shipmentId: h.shipmentId,
      carrier: details(),
    });
    expect(!blocked.ok && blocked.error.code).toBe("SHIPMENT_NEEDS_REVIEW");
    await h.retry.execute({ tenantId: T, shipmentId: h.shipmentId });
    const shipped = await h.createLabel.execute({
      tenantId: T,
      shipmentId: h.shipmentId,
      carrier: details(),
    });
    expect(shipped.ok && shipped.value.trackingNumber).toBe("5108003");
    expect(h.provider.createCalls.map((c) => c.request.reference)).toEqual(["1001-1", "1001-2"]);
  });

  it("a 4xx closes the attempt as failed and returns the carrier's code; a resumed 4xx is unknown (Ruling 3, 6)", async () => {
    /* … */
  });
  it("a disabled carrier is CARRIER_NOT_ENABLED and nothing is written", async () => {
    /* … */
  });
  it("without `carrier` the legacy in-memory path is unchanged", async () => {
    /* … */
  });
});
```

`carrier-shipment.use-cases.test.ts`:

- "cancel before pickup terminates then voids";
- "terminate 404 still voids";
- "after pickup (in_transit) is CARRIER_CANCEL_NOT_ALLOWED with no carrier call";
- "print refuses a voided shipment and another tenant's id (NOT_FOUND)";
- "print passes config defaults when no format is given".

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/shipping exec vitest run src/application/create-label.carrier.test.ts src/application/carrier-shipment.use-cases.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** as specified. `buildController` passes `carriers: resolver` into `CreateLabel`, `CancelCarrierShipment` and `PrintCarrierAwbs`. Add `GetShipment` and the controller methods.

- [ ] **Step 4: Run** `pnpm --filter @platform/shipping test && pnpm --filter @platform/shipping exec vitest run --coverage && pnpm --filter @platform/shipping typecheck && pnpm --filter @platform/shipping lint`. Expected: PASS, floors held.

- [ ] **Step 5: Commit** with `feat(shipping): carrier labels with durable in-flight attempts, cancel and waybills`.

**Amendments (binding) — implementer: terra. Review depth: strong.**

1. **F12 — a new `CreateLabel` carrier-path order. It replaces steps 1–3 above; steps 4–6 keep their content.**
   - **Step 0, read-only precheck** (one `unitOfWork.run`, no write):
     - not found → `NotFoundError`;
     - `label_created` → return `{ status, trackingNumber, carrierDeliveryId, carrierKey }` with **no resolve and no prepare** (Ruling 35);
     - `exception` → `CarrierError("SHIPMENT_NEEDS_REVIEW", …, 409)`;
     - an open pending attempt → **resume path**;
     - otherwise → **fresh path**.
   - **Resume path:**
     - `resolve(tenantId, carrierKey, "existing_shipment")`;
     - then step 4 (grace check, then `findDeliveriesByReference`), with **no `prepare`**.
     - On a recognised 0-match, run `prepare` first. A problem → `failLabelAttempt(reference)` in a transaction and return `CarrierError(problem.code, …, 422, problem.reason)`. No problem → step 5 with `resumed = true`.
   - **Fresh path:**
     - `resolve(…, "new_shipment")`, then `prepare`. A problem → 422 and nothing written; `unavailable` → 503.
     - Then the begin transaction (inside `withConcurrencyRetry`) re-reads the shipment:
       - now `label_created` → return the stored label;
       - now has an open pending attempt → `CARRIER_CREATE_IN_PROGRESS` (409);
       - `!canTransitionShipment(status, "label_created")` → `BusinessRuleError`;
       - else `beginLabelAttempt(nextLabelReference(details.reference), now)` and save.
     - Then step 5 with `resumed = false`.
2. **F1.** In step 4, **any** search failure, `credentials_rejected` and `rejected` included, goes to step 6 (unknown), never to step 5.
3. **T1 review carry — settle success guard.** The settle transaction re-reads the shipment:
   - `label_created` → return the stored label, no write;
   - `pendingLabelAttempt()?.reference !== reference` (a Retry closed it meanwhile) → write nothing and return `CarrierError("CARRIER_RESULT_UNKNOWN", …, 409)`;
   - else `createLabel(...)`.
4. **F2 — legacy paths refuse carrier-managed shipments.** "Carrier-managed" means `shipment.carrier` is set and `registry.has(carrier)`.
   - `VoidLabelDeps` and the `AdvanceShipment` deps gain `isCarrierManaged: (carrierKey: string) => boolean`. `buildController` passes `(k) => carrierRegistry.has(k)`; it defaults to `() => false` when absent.
   - `VoidLabel` on a carrier-managed shipment → `CarrierError("CARRIER_USE_CANCEL", "Use the carrier cancel for this shipment", 409)`, with no change and no provider call.
   - `AdvanceShipment` on a carrier-managed shipment allows **only `voided → created`** (Task 11 uses it to re-ship). Every other target → the same `CARRIER_USE_CANCEL`.
   - `exception → created` stays with `RetryShipment`.
5. **Fill the empty tests, and add these.** Expected values:
   - **4xx closes / resumed 4xx is unknown:**
     - (a) `create: [{ fail: "rejected", code: "ADDRESS_NOT_SHIPPABLE", reason: "DISTRICT_NOT_FOUND" }]` → err `{ code: "ADDRESS_NOT_SHIPPABLE", reason: "DISTRICT_NOT_FOUND", httpStatus: 422 }`. The label attempts are `[pending "1001-1", failed "1001-1"]`, `pendingLabelAttempt()` is `undefined`, and the status is `created`. A next call with `create` succeeding sends reference `"1001-2"`.
     - (b) `create: [timeout, { fail: "rejected" }]`, `find: [[]]`, with the clock advanced past the grace → the retry returns `CARRIER_RESULT_UNKNOWN`, `needsCarrierReview === true`, and the create references are `["1001-1", "1001-1"]`.
   - **Disabled carrier:** the harness has bosta configured but disabled → `CARRIER_NOT_ENABLED`, `httpStatus 409`; 0 attempts; 0 `prepare` calls.
   - **Legacy path:** no `carrier` field → status `label_created` via `deps.carrierProvider`; the `FakeCarrierProvider` has 0 calls of any kind.
   - **Credentials rejected:** `create: [{ fail: "credentials_rejected" }]` → `CARRIER_CREDENTIALS_REJECTED` (409); attempt closed as failed.
   - **Unavailable:** `create: [{ fail: "unavailable" }]` (not timed out) → `CARRIER_UNAVAILABLE` (503); attempt still pending.
   - **Prepare unavailable:** `prepare` throws `{ carrierFailure: "unavailable" }` → `CARRIER_UNAVAILABLE` (503); 0 attempts.
   - **F12:** "an already-labelled shipment returns its label with the carrier disabled": ok, 0 resolve calls. "A pending attempt resumes with the carrier disabled": past the grace, `find` returns 1 → ok with that tracking number.
   - **F1:** "a 401 on search is CARRIER_RESULT_UNKNOWN with no create call": `find: [{ fail: "credentials_rejected" }]` → unknown; `createCalls` length 1 (the original timed-out one).
   - **Settle guard:** after a pending attempt `"1001-1"`, a test-only hook between the carrier call and the settle runs `retry` on the stored shipment → the result is `CARRIER_RESULT_UNKNOWN` and no label is stored. If the harness can't interleave, use a repository double whose second `findById` returns the retried shipment.
   - **No call inside a transaction:** every recorded `openCountAtCall` for prepare/create/find is `0`.
   - **F2:**
     - "legacy void on a bosta shipment is refused and makes no change": `CARRIER_USE_CANCEL`; status still `label_created`.
     - "advance voided → created is allowed for a bosta shipment; label_created → in_transit is CARRIER_USE_CANCEL".
     - "a shipment whose carrier isn't registered keeps the old void".
6. **`carrier-shipment.use-cases.test.ts`, expected values:**
   - cancel `label_created` → `cancelCalls` `["5108002"]`; result `{ status: "voided", fulfillmentRef }`;
   - terminate `"not_found"` → `voided`;
   - `in_transit` → `CARRIER_CANCEL_NOT_ALLOWED` (409), 0 cancel calls;
   - already `voided` → ok `voided`, 0 calls;
   - `rejected` → `CARRIER_CANCEL_REFUSED` (409), status unchanged;
   - `unavailable` → `CARRIER_UNAVAILABLE` (503), unchanged;
   - a disabled-but-configured carrier still cancels (`existing_shipment`).
   - **Print:**
     - `[]` or 51 ids → `ValidationError`;
     - `[id, id]` → `printCalls` deep-equals `[[["5108002"], {}]]`;
     - a `voided` shipment → `AWB_NOT_AVAILABLE` (409);
     - another tenant's id → `NOT_FOUND`;
     - two carriers → `AWB_MIXED_CARRIERS` (422);
     - `{ format: "A4" }` → the provider receives `{ format: "A4" }`.
     - (The config defaults are applied by the provider, Task 6. This test asserts the use case passes `{}` through when no format is given.)
7. **Presenter:** `CARRIER_USE_CANCEL` and the other new codes are `CarrierError`s, so they need no new presenter branch. Add one presenter test for `CARRIER_USE_CANCEL` → 409 and `body.code`.

8. **Plan review 1, finding 4: a resumed 401/403 is unknown.** Step 5 becomes:
   - `credentials_rejected` **not resumed** → `failLabelAttempt` and `CARRIER_CREDENTIALS_REJECTED` (409).
   - `credentials_rejected` **resumed** → step 6 (unknown); the attempt stays open, and the shipment goes to review.

   Test both: (fresh) as in amendment 5; (resumed) `create: [timeout, { fail: "credentials_rejected" }]`, `find: [[]]`, past the grace → `CARRIER_RESULT_UNKNOWN` and `needsCarrierReview === true`.

9. **Plan review 1, finding 5: the legacy label path gets a safety check.** This amends "byte-for-byte unchanged". When `input.carrier` is absent, before any provider call, the precheck refuses with `CarrierError("CARRIER_USE_CANCEL", "Use the carrier flow for this shipment", 409)`, with no write and no provider call, when either:
   - (a) the shipment has an open pending label attempt (`pendingLabelAttempt() !== undefined`); or
   - (b) the shipment is carrier-managed (`shipment.carrier` set and `isCarrierManaged(carrier)`); or its label attempts include any carrier attempt whose `reference` matches `/-\d+$/` (a real-carrier history after a void/retry).

   Every other shipment keeps the old behaviour exactly.

   Tests:
   - "pending timeout then legacy label → CARRIER_USE_CANCEL; deps.carrierProvider not called; attempts unchanged";
   - "a carrier label voided by CancelCarrierShipment, advanced to created, then legacy label → refused";
   - "an unmanaged shipment still labels through the legacy provider".

10. **Plan review 1, finding 3 (consumer):** `find: [{ fail: "unavailable" }]` past the grace → `CARRIER_RESULT_UNKNOWN`, and `record.createCalls.length === 1`.

---

### Task 8: Prisma processed-webhook store and the extended `RecordCarrierWebhook`

Model tier: **standard**.

**Files:**

- Create: `services/shipping/src/infrastructure/prisma-processed-carrier-webhook-store.ts`
- Create: `services/shipping/src/application/record-carrier-webhook.use-case.test.ts`
- Modify: `services/shipping/src/application/record-carrier-webhook.use-case.ts`, `src/composition.ts` (the Prisma branch uses the new store), `src/index.ts`, `apps/admin/src/http/shipping-routes.ts` (the existing `/shipments/:shipmentId/webhook` still passes `shipmentId`)

**Interfaces:**

- Consumes: Task 1 (`carrierPathTo`, `findByTrackingNumber`).
- Produces:

```ts
export interface RecordCarrierWebhookInput {
  readonly tenantId: string;
  readonly carrier: string;
  readonly eventId: string;
  readonly kind: string;
  /** Exactly one of shipmentId / trackingNumber. */
  readonly shipmentId?: string;
  readonly trackingNumber?: string;
  /** Carrier-mapped target; when set it wins over KIND_TO_STATUS. */
  readonly toStatus?: ShipmentStatusValue;
  readonly scan?: {
    readonly description: string;
    readonly location?: string;
    readonly occurredAt: Date;
  };
  /** For delivery_failed / exception attempts. */
  readonly reason?: string;
}
export interface RecordCarrierWebhookOutput {
  readonly shipmentId: string;
  readonly fulfillmentRef: string;
  readonly status: string;
  readonly duplicate: boolean;
  /** The statuses entered, in order; [] for a scan only. */
  readonly transitions: readonly ShipmentStatusValue[];
}
export class PrismaProcessedCarrierWebhookStore implements ProcessedCarrierWebhookStore {
  constructor(prisma: Database);
}
```

**How a webhook is recorded:**

- **Shipment lookup:** by `shipmentId` (legacy), or by `findByTrackingNumber(carrier, trackingNumber, tenantId)`. Neither → `NotFoundError`.
- **Dedupe:** unchanged (`hasProcessed` → `duplicate: true`).
- **Apply:**
  1. `recordCarrierWebhook(kind)`.
  2. When `scan` is set, `addTrackingEvent(scan.description, scan.occurredAt, scan.location)` (spec §8.5).
  3. `target = toStatus ?? KIND_TO_STATUS[kind]`. `path = carrierPathTo(current, target)`. For each step call the named method: `markDelivered`, `markDeliveryFailed(reason ?? kind)`, `raiseException(reason ?? kind)`, `markReturned`, `cancel`, `acceptByCarrier`, `markInTransit` or `markOutForDelivery`. An unreachable target transitions nothing and **never throws** (§8.2).
- **Concurrency:** the whole read-apply-save is wrapped in `withConcurrencyRetry(5, …)`. A racing duplicate then re-reads, finds `hasProcessed`, and answers `duplicate: true`.
- **The store** copies `PrismaProcessedWebhookStore` onto model `processedShippingWebhook`, unique key `tenantId_carrier_webhookEventId`. P2002 counts as "already processed".

- [ ] **Step 1: Write the failing tests:**

```ts
describe("RecordCarrierWebhook with carrier statuses (§8.5, §9a.4, Ruling 23)", () => {
  it("adds a scan for every accepted webhook, and walks label_created → delivered after missed webhooks", async () => {
    const h = await webhookHarness(); // a bosta shipment at label_created, tracking 5108002
    const r = await h.record.execute({
      tenantId: T,
      carrier: "bosta",
      trackingNumber: "5108002",
      eventId: "5108002:45:1700000000000",
      kind: "45",
      toStatus: "delivered",
      scan: { description: "Delivered", occurredAt: new Date(1700000000000) },
    });
    expect(r.ok && r.value.transitions).toEqual([
      "carrier_accepted",
      "in_transit",
      "out_for_delivery",
      "delivered",
    ]);
    const s = await h.shipment();
    expect(s.deliveredAt?.getTime()).toBe(1700000000000);
    expect(s.trackingEvents.map((e) => e.description)).toEqual(["Delivered"]);
  });
  it("an impossible transition is a scan only and never throws", async () => {
    const h = await webhookHarness({ status: "delivered" });
    const r = await h.record.execute({/* … toStatus: "in_transit", scan … */});
    expect(r.ok && r.value).toMatchObject({ status: "delivered", transitions: [] });
  });
  it("the same event id twice is a duplicate with no second scan", async () => {
    /* … */
  });
  it("a tracking number of another tenant is NOT_FOUND", async () => {
    /* … */
  });
  it("delivery_failed records the exception reason on the attempt", async () => {
    /* … */
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @platform/shipping exec vitest run src/application/record-carrier-webhook.use-case.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Then run `node scripts/dev/check-prisma-tenant-where.mjs` (both `findUnique` and `create` name `tenantId`).
- [ ] **Step 4: Run** the shipping test, typecheck and lint commands plus `pnpm --filter @platform/admin exec vitest run src/http/shipping`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(shipping): durable carrier webhook dedupe, scans and skip-ahead transitions`.

**Amendments (binding) — implementer: sonnet. Review depth: standard.**

1. **F5 — dedupe inside the aggregate's transaction.**
   - `ProcessedCarrierWebhookStore` becomes `hasProcessed(carrier, eventId, tenantId, tx?: unknown)` and `markProcessed(carrier, eventId, tenantId, tx?: unknown)`.
   - `RecordCarrierWebhook` runs read → `hasProcessed(…, tx)` → apply → save → `markProcessed(…, tx)` inside **one** `unitOfWork.run`, wrapped in `withConcurrencyRetry(5, …)`.
   - The Prisma store uses `tx` when given (exactly as the repository's `readScoped`), else its own `runInTenantTransaction`. The in-memory store ignores `tx`.
2. **F11 — `prisma-processed-carrier-webhook-store.test.ts`** with a fake client (`processedShippingWebhook: { findUnique, create }`). Expected:
   - `hasProcessed` → `findUnique({ where: { tenantId_carrier_webhookEventId: { tenantId: "t-1", carrier: "bosta", webhookEventId: "e" } } })`; a row → `true`, `null` → `false`;
   - `markProcessed` → `create` with `{ tenantId, carrier, webhookEventId }`;
   - `create` rejecting `{ code: "P2002" }` → resolves;
   - any other error → rejects with the same error;
   - with a `tx` object given → the `tx`'s methods are called and the root client's are not.
3. **F16 — time.** Every transition in the walk, and the scan, use `scan?.occurredAt ?? clock.now()`.
4. **T1 review carry:**
   - `carrierPathTo(from, to)` returns `null` for an unreachable target and for `from === to` (`created → created` included). `null` means "record the scan, no status change, `transitions: []`", and it never throws.
   - A webhook for a `created` shipment adds the tracking event only.
5. **Output for the mirror (used by Task 10):** `RecordCarrierWebhookOutput` gains `carrier: string`, `trackingNumber: string | null` and `carrierDeliveryId: string | null`, read from the shipment and its label.
6. **Validation:** both `shipmentId` and `trackingNumber`, or neither → `ValidationError`.
7. **Fill the empty tests:**
   - **Impossible transition:** a shipment at `delivered`, `toStatus: "in_transit"` with a scan → ok `{ status: "delivered", transitions: [] }`; `trackingEvents` length 1.
   - **Duplicate:** the same input twice → the second result is `{ duplicate: true, transitions: [] }`, and `trackingEvents` length stays 1.
   - **Another tenant:** the shipment is saved for `t-1`; executing with `tenantId: "t-2"` and the same tracking number → err code `NOT_FOUND`.
   - **delivery_failed:** a shipment at `out_for_delivery`, `toStatus: "delivery_failed"`, `reason: "Postponed by customer"` → `transitions` `["delivery_failed"]`; the last attempt is `{ kind: "carrier", outcome: "failed" }` with reason `"Postponed by customer"`.
   - **New, "a save that throws leaves the event unprocessed":** a repository whose `save` rejects `new Error("db down")` → the result is an error (or a throw, per the existing pattern). Then `store.hasProcessed("bosta", eventId, T)` is `false`. With a working repository, the same input is processed with `duplicate: false`.
   - **New, "a scan on a created shipment changes nothing else":** status stays `created`, 1 tracking event.
8. **Guard:** run `node scripts/dev/check-prisma-tenant-where.mjs` in Step 4 as well.

9. **Plan review 1, finding 7: is this shipment current?** `RecordCarrierWebhookOutput` gains `isCurrentShipment: boolean`. It is `true` when `findByFulfillmentRef(fulfillmentRef, tenantId, tx)` (newest first) returns this shipment's id, read in the same transaction. Test: two shipments A (older, cancelled) and B (newer) for one fulfillment; a webhook for A → `isCurrentShipment: false`, A gets the scan, B is unchanged.

---

### Task 9: Admin carrier settings routes, permissions and seed

Model tier: **standard**.

**Files:**

- Create: `apps/admin/src/interfaces/carrier-settings.admin-controller.ts`
- Create: `apps/admin/src/http/carrier-settings-routes.ts`, `carrier-settings-routes.test.ts`
- Modify:
  - `apps/admin/src/composition.ts`: `AdminWiringDeps` gains `carrierRegistrations?`, `carrierCredentialVault?`, `distributedLock?`; `WiredAdmin` gains `carrierSettings`;
  - `apps/admin/src/http/admin-routes.ts`;
  - `packages/auth/src/role-table-access-control.ts` and its test;
  - `scripts/ops/seed-ory-network.mjs`.

**Interfaces:**

- Consumes: Task 4's `ShippingController` methods.
- Produces:

```ts
export class CarrierSettingsAdminController {
  constructor(deps: { shipping: ShippingController; guard: AdminGuard });
  get(principal: Principal, input: { tenantId: string }): Promise<AdminResponse>; // shipping:read_settings
  listEnabled(principal: Principal, input: { tenantId: string }): Promise<AdminResponse>; // shipping:read
  update(principal: Principal, input: UpdateCarrierSettingsInput): Promise<AdminResponse>; // shipping:update_settings
  rotateWebhookSecret(
    principal: Principal,
    input: { tenantId: string; carrierKey: string },
  ): Promise<AdminResponse>; // shipping:update_settings
}
// role-table-access-control.ts
export const ADMIN_ONLY_PERMISSIONS: ReadonlySet<string>; // { "shipping:read_settings", "shipping:update_settings" }
```

**Routes** (`carrierSettingsRoutes(admin)`):

| Method and path                                      | Permission                 | Notes              |
| ---------------------------------------------------- | -------------------------- | ------------------ |
| `GET /shipping/carriers`                             | `shipping:read_settings`   |                    |
| `GET /shipping/carriers/enabled`                     | `shipping:read`            |                    |
| `PUT /shipping/carriers/:carrierKey`                 | `shipping:update_settings` | `idempotent: true` |
| `POST /shipping/carriers/:carrierKey/webhook-secret` | `shipping:update_settings` | `idempotent: true` |

- **Params:** `carrierKey` matches `CARRIER_KEY_PATTERN`.
- **PUT body** (zod, `.strict()`):

  ```ts
  z.object({
    enabled: z.boolean().optional(),
    credentials: z.record(z.string().min(1).max(512)).optional(),
    config: z.record(z.unknown()).optional(),
    disconnect: z.literal(true).optional(),
  }).strict();
  ```

  `.refine`: `disconnect` comes alone, and at least one key is present.

- **Role table:** `RoleTableAccessControl.authorize` returns `false` for a permission in `ADMIN_ONLY_PERMISSIONS` unless the canonical role is `admin` (Ruling 26).

- [ ] **Step 1: Write the failing tests**

`carrier-settings-routes.test.ts` runs over `createAdminHttpApi`, as `shipping-zones-routes.test.ts` does. It passes `carrierRegistrations: [fakeRegistration(...)]` and `carrierCredentialVault: new InMemoryCarrierCredentialVault()`. Tests:

- "PUT stores, GET never returns credentials or the webhook secret";
- "GET returns the webhook URL";
- "a key Bosta rejects is 409 CARRIER_CREDENTIALS_REJECTED with code in the body";
- "credentials over 512 chars are 400";
- "unknown carrier key is 422 CARRIER_UNKNOWN";
- "tenant t-2 reads its own empty settings";
- "/enabled lists only enabled carriers and no config".

Add to `role-table-access-control.test.ts`:

```ts
it("carrier settings are admin-only even though operator has shipping:* (Ruling 26)", async () => {
  const op = who(["operator"]);
  expect(await acl.authorize(op, "shipping:create_label")).toBe(true);
  expect(await acl.authorize(op, "shipping:read_settings")).toBe(false);
  expect(await acl.authorize(op, "shipping:update_settings")).toBe(false);
  expect(await acl.authorize(who(["admin"]), "shipping:update_settings")).toBe(true);
  expect(await acl.authorize(who(["viewer"]), "shipping:read")).toBe(true);
});
```

- [ ] **Step 2: Run** `pnpm --filter @platform/admin exec vitest run src/http/carrier-settings-routes.test.ts && pnpm --filter @platform/auth test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Wire `carrierSettings: new CarrierSettingsAdminController({ shipping: shipping.shipping, guard })`.
  - Pass the new deps through `wireShipping(deps)`; `AdminWiringDeps` is spread.
  - Add `"shipping:read_settings"` and `"shipping:update_settings"` to `seed-ory-network.mjs` `PERMISSIONS`, keeping them sorted.
- [ ] **Step 4: Run** `pnpm --filter @platform/admin exec vitest run src/http src/tenant-mode-guard.test.ts && pnpm --filter @platform/admin typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint && pnpm --filter @platform/auth test`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(admin): carrier settings routes with admin-only permissions`.

**Amendments (binding) — implementer: terra. Review depth: standard.**

1. **F24.** In `scripts/ops/seed-ory-network.mjs`, widen the regeneration comment's grep pattern to `'"[a-z0-9_]+:[a-z_]+"'`, so `shipping:read_settings` and `shipping:update_settings` survive a regeneration.
2. **Route tests, expected values.** Every mutating request sends an `Idempotency-Key` header, as `shipping-zones-routes.test.ts` does.
   - **PUT `{ credentials: { apiKey: "bosta-key-123" }, enabled: true }`** → 200. `JSON.stringify(body)` contains neither `"bosta-key-123"` nor the stored webhook secret. A following GET has the same property, and its bosta entry `{ configured: true, enabled: true }`.
   - **GET** → the entry's `webhookUrl` equals the `fakeRegistration`'s `webhookUrl`.
   - **A rejected key** (`fakeRegistration({ verify: "credentials_rejected" })`) → 409 with `body.code` `"CARRIER_CREDENTIALS_REJECTED"`.
   - **Bad bodies:** a 513-character apiKey → 422 `VALIDATION` (A6); body `{}` → 422 `VALIDATION` (A6); `{ disconnect: true, enabled: true }` → 422 `VALIDATION` (A6); `{ cod: 1 }` → 422 `VALIDATION` (A6).
   - **Unknown carrier:** PUT `/shipping/carriers/aramex` → 422 with `body.code` `"CARRIER_UNKNOWN"`. PUT `/shipping/carriers/Bad%20Key` → 422 `VALIDATION` (A6).
   - **Tenant t-2:** GET → 200 with `version: 0` and the bosta entry `configured: false`.
   - **`/enabled`:** → `{ carriers: [{ key: "bosta", displayName }] }`, whose items have exactly those two keys.
   - **New:** an operator principal on `GET /shipping/carriers` and `PUT` → 403. An operator on `GET /shipping/carriers/enabled` → 200.
3. **Tenant guard.** `WiredAdmin.carrierSettings` exposes no field named `tenantId`. `src/tenant-mode-guard.test.ts` stays green (already in Step 4).

---

### Task 10: The public Bosta webhook route and the fulfillment mirror

Model tier: **strong** (a public endpoint).

**Files:**

- Create: `apps/admin/src/http/public-carrier-webhook-routes.ts`, `public-carrier-webhook-routes.test.ts`
- Modify: `apps/admin/src/composition.ts` (`WiredAdmin.carrierWebhooks`), `apps/admin/src/http/admin-routes.ts`, `apps/admin/package.json` (+ `@platform/carrier-bosta`)

**Interfaces:**

- Consumes: `parseBostaWebhook`, `bostaWebhookEventId`, `mapBostaState`, `bostaScanText`, `BOSTA_WEBHOOK_MAX_BYTES` (Task 5); `ShippingController.verifyCarrierWebhook` / `recordWebhook` (Tasks 4, 8); `FulfillmentController.mirrorShipmentStatus` (Task 2).
- Produces:

```ts
// WiredAdmin
readonly carrierWebhooks: {
  readonly verify: ShippingController["verifyCarrierWebhook"];
  readonly record: ShippingController["recordWebhook"];
  readonly mirrorFulfillment: FulfillmentController["mirrorShipmentStatus"];
};
export function publicCarrierWebhookRoutes(admin: WiredAdmin): readonly RouteDefinition[];
export const UNAUTHORIZED_BODY: { readonly code: "UNAUTHORIZED"; readonly message: "Unauthorized" };
```

**The route:** `POST /public/shipping/webhook/bosta`, `public: true`, permission `shipping:record_webhook`, body schema `z.object({}).passthrough()`. The handler, in order:

1. `rawBody` missing or over 16 KiB → 413 `{ code: "PAYLOAD_TOO_LARGE" }`.
2. `verify({ tenantId: context.tenantId, carrierKey: "bosta", presented: firstHeader(headers.authorization) })`. `false` → `401 UNAUTHORIZED_BODY`.
3. `parseBostaWebhook(rawBody)`. `null` → `422 { code: "VALIDATION" }`.
4. `mapBostaState(state, type)`. Record with:
   - `{ tenantId, carrier: "bosta", trackingNumber, eventId: bostaWebhookEventId(w), kind: String(state) }`;
   - `...(target ? { toStatus: target } : {})`;
   - `scan: { description: bostaScanText(state, type, exceptionReason), occurredAt: Number.isFinite(timeStamp) ? new Date(timeStamp) : now }`;
   - `reason: exceptionReason`.
5. 404 → `200 { ignored: true }` (Ruling 21). A duplicate → `200 { duplicate: true }`.
6. When `transitions.length > 0`, call `mirrorFulfillment({ tenantId, fulfillmentOrderId: fulfillmentRef, shipmentStatus: status })`. A non-2xx or a throw is `logger.warn("carrier webhook: fulfillment mirror failed", { tenantId, shipmentId, status })`; the route still answers 200 (Ruling 25).
7. Answer `200 { ok: true }`. The response never echoes the payload.

- [ ] **Step 1: Write the failing tests** (handle directly with a partial `WiredAdmin`, as `payments-webhook-routes.test.ts` does):

```ts
const raw = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const ctx = (
  tenantId: string,
  headers: Record<string, string | undefined>,
  body: Uint8Array,
): RequestContext => ({
  tenantId,
  principal: { id: "public", kind: "customer", roles: [], tenantId },
  requestId: "r",
  correlationId: "r",
  rawBody: body,
  headers,
});

it("wrong secret and unknown tenant give the same 401 body (Review Focus 3)", async () => {
  const verify = vi.fn().mockResolvedValue(false);
  const [route] = publicCarrierWebhookRoutes(fake({ verify }));
  const body = raw(webhook24);
  const a = await route!.handle({
    body: {},
    params: {},
    query: {},
    context: ctx("t-1", { authorization: "wrong" }, body),
  });
  const b = await route!.handle({
    body: {},
    params: {},
    query: {},
    context: ctx("t-unknown", { authorization: "s" }, body),
  });
  expect(a).toEqual({ status: 401, body: UNAUTHORIZED_BODY });
  expect(b).toEqual(a);
  expect(verify).toHaveBeenCalledWith({ tenantId: "t-1", carrierKey: "bosta", presented: "wrong" });
});
it("records state 24 as in_transit with a scan, and mirrors the fulfillment", async () => {
  const record = vi.fn().mockResolvedValue({
    status: 200,
    body: {
      shipmentId: "s-1",
      fulfillmentRef: "fo-1",
      status: "in_transit",
      duplicate: false,
      transitions: ["carrier_accepted", "in_transit"],
    },
  });
  const mirror = vi.fn().mockResolvedValue({ status: 200, body: {} });
  const [route] = publicCarrierWebhookRoutes(
    fake({ verify: vi.fn().mockResolvedValue(true), record, mirror }),
  );
  const res = await route!.handle({
    body: {},
    params: {},
    query: {},
    context: ctx("t-1", { authorization: "s" }, raw(webhook24)),
  });
  expect(res.status).toBe(200);
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({
      tenantId: "t-1",
      carrier: "bosta",
      trackingNumber: "48089608",
      eventId: "48089608:24:1689252908261",
      toStatus: "in_transit",
      scan: { description: "Received at warehouse", occurredAt: new Date(1689252908261) },
    }),
  );
  expect(mirror).toHaveBeenCalledWith({
    tenantId: "t-1",
    fulfillmentOrderId: "fo-1",
    shipmentStatus: "in_transit",
  });
});
it("a tracking number this tenant doesn't own is ignored with 200 (lookup is tenant-scoped)", async () => {
  /* record → 404 ⇒ { status: 200, body: { ignored: true } } */
});
it("over 16 KiB is 413 before any secret check", async () => {
  /* … */
});
it("a mirror failure is logged and still answers 200", async () => {
  /* … */
});
it("the response body never contains the payload", async () => {
  /* … */
});
```

- [ ] **Step 2: Run** `pnpm --filter @platform/admin exec vitest run src/http/public-carrier-webhook-routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Then run `pnpm install --offline` for the new dependency.
- [ ] **Step 4: Run** the admin test, typecheck and lint commands (as in Task 9). Expected: PASS.
- [ ] **Step 5: Commit** with `apps/admin/package.json`, `pnpm-lock.yaml` and the message `feat(admin): authenticated bosta webhook route with fulfillment mirror`.

**Amendments (binding) — implementer: sonnet. Review depth: strong.**

1. **F7 — reword Review Focus 3 and the first test's title** to "a wrong secret and a missing secret for a known tenant give the same 401 body". The test's second request becomes `ctx("t-1", {}, body)` (no `authorization`).
   - Add a transport-level test that pins the real endpoint, in `public-carrier-webhook-routes.e2e.test.ts`. Model it on the multi-tenant setup in `apps/admin/src/http/tenant-lifecycle.e2e.test.ts`, and on `packages/http/src/tenant-gate.test.ts` for the expected bodies. It expects:
     - a known tenant with a wrong secret → 401 `UNAUTHORIZED_BODY`;
     - an unknown `x-tenant-id` → 403 with `body.code` `"TENANT_UNKNOWN"`;
     - no `x-tenant-id` → 403.
   - If that harness is DB-gated (skipped locally), the test is still written. Say "skipped (DB-gated)" in the report and do not weaken it.
2. **F16 — mirror on every accepted, non-duplicate webhook.** This replaces step 6's `transitions.length > 0` condition. The mirror call becomes:

   ```ts
   mirrorFulfillment({
     tenantId,
     fulfillmentOrderId: fulfillmentRef,
     shipmentStatus: status,
     carrier,
     ...(trackingNumber ? { trackingNumber } : {}),
     ...(carrierDeliveryId ? { carrierShipmentId: carrierDeliveryId } : {}),
   });
   ```

   It reads `carrier`, `trackingNumber` and `carrierDeliveryId` from Task 8's output.

3. **F16 — the fulfillment half, which Task 2 did not build.** Modify `services/fulfillment/src/application/carrier-fulfillment.use-cases.ts` (+ its test) and the controller pass-through:
   - `MirrorShipmentStatusInput` gains optional `carrier?: string`, `trackingNumber?: string` and `carrierShipmentId?: string`.
   - In `MirrorShipmentStatus`, when the fulfillment is at `packing_completed`, the `shipmentStatus` is not one of `created`, `label_created`, `voided` or `cancelled`, and all three fields are present: first apply the same transition `AttachCarrierShipment` applies (reuse its domain calls, not a copy of the use case), then mirror, all in one transaction.
   - Tests:
     - `packing_completed` + `in_transit` with the three fields → the final status is `in_transit` and the tracking number is stored;
     - the same without the fields → `changed: false`;
     - `packing_completed` + `cancelled` → no attach.
   - Fulfillment coverage stays ≥ 80 (`pnpm --filter @platform/fulfillment exec vitest run --coverage`). Add `services/fulfillment/**` files to the commit.
4. **Logger.** `WiredAdmin.carrierWebhooks` gains `readonly logger?: { warn(message: string, meta: Record<string, string>): void }`. `wireAdmin` passes the admin logger if one exists in `composition.ts`; otherwise it omits it, and the route uses a no-op. Tests pass a `vi.fn()` logger.
5. **Fill the empty tests:**
   - **Unowned tracking number:** `record` → `{ status: 404, body: {...} }` → the response is exactly `{ status: 200, body: { ignored: true } }`; `mirror` not called.
   - **Duplicate:** `record` → `{ status: 200, body: { ..., duplicate: true } }` → `{ status: 200, body: { duplicate: true } }`; `mirror` not called.
   - **Over 16 KiB:** `rawBody` of 16,385 bytes → `{ status: 413, body: { code: "PAYLOAD_TOO_LARGE" } }`; `verify` not called. `rawBody` undefined → the same 413.
   - **Bad JSON:** a valid secret with `rawBody` `"{nope"` → `{ status: 422, body: { code: "VALIDATION" } }`; `record` not called.
   - **Mirror failure:** `mirror` rejects → `logger.warn` called with `("carrier webhook: fulfillment mirror failed", { tenantId: "t-1", shipmentId: "s-1", status: "in_transit" })`, and the response is `{ status: 200, body: { ok: true } }`. `mirror` resolving `{ status: 500 }` → the same.
   - **Payload never echoed:** for the ok, duplicate and ignored answers, `JSON.stringify(res.body)` contains neither `"48089608"` nor `"SEND"`.
   - **New, scan-only re-mirror:** a webhook whose `record` returns `transitions: []` and `duplicate: false` → `mirror` is still called once.
   - **New, RTO return leg:** `webhook24` with `type: "RTO"` → `record` called **without** `toStatus`, with scan `"Received at warehouse"`.

6. **Plan review 1, finding 7: predecessors never mirror.**
   - The route calls `mirrorFulfillment` **only when `isCurrentShipment` is true** (Task 8). Otherwise it answers `200 { ok: true }` without mirroring.
   - In addition, fulfillment's `MirrorShipmentStatus` refuses to act (returns `changed: false`) when `trackingNumber` is given, the fulfillment already carries a tracking number, and the two differ.
   - Tests:
     - route: record → `isCurrentShipment: false` → `mirror` not called, response 200 `{ ok: true }`;
     - fulfillment: fulfillment at `tracking_assigned` with tracking `"B-1"`, mirror `cancelled` with `trackingNumber "A-1"` → `changed: false`, status still `tracking_assigned`, tracking `"B-1"`.

---

### Task 11: `ShipOrderWithCarrier`, bulk shipping, waybills and cancel routes

Model tier: **strong** (Review Focus 1, 2, 5).

**Files:**

- Create: `apps/admin/src/carrier-shipping/ports.ts`, `cod-amount.ts` (+ test), `carrier-order.adapter.ts`, `carrier-fulfillment.adapter.ts`, `ship-order-with-carrier.ts` (+ test), `bulk-ship.ts` (+ test)
- Create: `apps/admin/src/interfaces/carrier-shipping.admin-controller.ts`
- Create: `apps/admin/src/http/carrier-shipping-routes.ts`, `carrier-shipping-routes.test.ts`
- Modify:
  - `apps/admin/src/http/shipping-routes.ts`: `ShipmentDetailDto` gains `carrierDeliveryId`, `needsReview`, `trackingEvents`; add `GET /shipments/:shipmentId`;
  - `apps/admin/src/composition.ts`: `WiredAdmin.carrierShipping`;
  - `apps/admin/src/http/admin-routes.ts`.

**Interfaces:**

- Consumes:
  - `OrderController.getOrder`; `derivePaymentStatus` and `isOpenOrder` (`@platform/orders`); `Order.totalAmount()`;
  - `PaymentController.getPaymentIntent`;
  - `resolveLineImages` (`http/product-images.ts`);
  - Task 2's fulfillment controller methods; Tasks 7 and 8's shipping controller methods;
  - `DistributedLock` (`@platform/contracts`).
- Produces:

```ts
// ports.ts
export interface ShippableOrder {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly open: boolean;
  readonly paymentStatus: "pending" | "paid" | "refunded" | "voided";
  readonly totalMinor: number;
  readonly currency: string;
  readonly paymentRef?: string;
  readonly items: readonly {
    readonly productId: string;
    readonly name: string;
    readonly variantTitle: string | null;
    readonly quantity: number;
    readonly imageUrl: string | null;
  }[];
  readonly shippingAddress: {
    readonly recipientName?: string;
    readonly phone?: string;
    readonly line1: string;
    readonly line2?: string;
    readonly city: string;
    readonly province?: string;
    readonly country: string;
  };
}
export interface CodIntentFacts {
  readonly provider: string;
  readonly status: string;
  readonly amountMinor: number;
  readonly currency: string;
}
export interface CarrierOrderReader {
  read(tenantId: string, orderId: string): Promise<ShippableOrder | null>;
  codIntent(tenantId: string, paymentRef: string): Promise<CodIntentFacts | null>;
}
export type ShipCode =
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_SHIPPABLE"
  | "ORDER_NOT_PAID"
  | "COD_AMOUNT_MISMATCH"
  | "STOCK_NOT_RESERVED"
  | "SHIPMENT_IN_PROGRESS"
  | "SHIPMENT_NEEDS_REVIEW"
  | "CARRIER_TIMEOUT"
  | string; // + every CarrierError code
export interface ShipResult {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly shipmentId: string;
  readonly trackingNumber: string;
  readonly carrierKey: string;
}
export type ShipOutcome =
  | { readonly ok: true; readonly value: ShipResult }
  | {
      readonly ok: false;
      readonly code: ShipCode;
      readonly httpStatus: number;
      readonly reason?: string;
    };

// cod-amount.ts — Ruling 40
export const OPEN_COD_INTENT_STATUSES: ReadonlySet<string>; // requires_payment, created, processing, authorized, capture_requested
export function decideCodAmount(
  order: Pick<ShippableOrder, "paymentStatus" | "totalMinor" | "paymentRef">,
  intent: CodIntentFacts | null,
):
  | { readonly ok: true; readonly codAmountMinor: number }
  | {
      readonly ok: false;
      readonly code: "ORDER_NOT_PAID" | "COD_AMOUNT_MISMATCH" | "ORDER_NOT_SHIPPABLE";
    };

// carrier-order.adapter.ts
export class CarrierOrderAdapter implements CarrierOrderReader {
  constructor(deps: {
    orders: Pick<OrderController, "getOrder">;
    payments: Pick<PaymentController, "getPaymentIntent">;
    lineImageUrls: (
      tenantId: string,
      lines: readonly { productId: string; variantId: string | null }[],
    ) => Promise<ReadonlyMap<string, string | null>>;
  });
}
// carrier-fulfillment.adapter.ts — over FulfillmentController (raw, no guard: the route already authorized)
export class CarrierFulfillmentAdapter {
  constructor(
    fulfillment: Pick<
      FulfillmentController,
      | "getByOrder"
      | "create"
      | "prepareForCarrier"
      | "attachCarrierShipment"
      | "detachCarrierShipment"
    >,
  );
  ensureReady(
    tenantId: string,
    order: ShippableOrder,
  ): Promise<
    | { ok: true; fulfillmentOrderId: string; status: string }
    | { ok: false; code: ShipCode; httpStatus: number }
  >;
  attach(
    tenantId: string,
    fulfillmentOrderId: string,
    carrier: string,
    deliveryId: string,
    trackingNumber: string,
  ): Promise<boolean>;
  detach(tenantId: string, fulfillmentOrderId: string): Promise<boolean>;
}

// ship-order-with-carrier.ts
export interface ShipOrderWithCarrierInput {
  readonly tenantId: string;
  readonly orderId: string;
  readonly carrierKey: string;
  readonly idempotencyKey: string;
}
export class ShipOrderWithCarrier {
  constructor(deps: {
    orders: CarrierOrderReader;
    fulfillment: CarrierFulfillmentAdapter;
    shipping: Pick<ShippingController, "getByFulfillment" | "create" | "advance" | "createLabel">;
    lock?: DistributedLock;
  });
  execute(input: ShipOrderWithCarrierInput): Promise<ShipOutcome>;
}
export const SHIP_LOCK_TTL_MS = 60_000;

// bulk-ship.ts — Ruling 36
export const BULK_BUDGET_MS = 55_000;
export const BULK_ORDER_RESERVE_MS = 15_000;
export interface BulkShipResult {
  readonly shipped: readonly ShipResult[];
  readonly failed: readonly {
    readonly orderId: string;
    readonly code: ShipCode;
    readonly reason?: string;
    readonly attempted: boolean;
  }[];
}
export async function shipInBulk(
  ship: (orderId: string, idempotencyKey: string) => Promise<ShipOutcome>,
  input: { readonly orderIds: readonly string[]; readonly idempotencyKey: string },
  nowMs: () => number,
): Promise<BulkShipResult>;

// carrier-shipping.admin-controller.ts (guards: shipping:create + shipping:create_label for ship; shipping:read for reads/AWB; shipping:void_label for cancel)
export class CarrierShippingAdminController {
  ship(principal: Principal, input: ShipOrderWithCarrierInput): Promise<AdminResponse>;
  shipMany(
    principal: Principal,
    input: {
      tenantId: string;
      orderIds: readonly string[];
      carrierKey: string;
      idempotencyKey: string;
    },
  ): Promise<AdminResponse>;
  cancel(
    principal: Principal,
    input: { tenantId: string; shipmentId: string },
  ): Promise<AdminResponse>; // then fulfillment.detach
  printAwbs(
    principal: Principal,
    input: {
      tenantId: string;
      shipmentIds?: readonly string[];
      orderIds?: readonly string[];
      format?: "A4" | "A6";
      lang?: "ar" | "en";
    },
  ): Promise<AdminResponse>; // body Uint8Array on 200
  orderCarrierShipment(
    principal: Principal,
    input: { tenantId: string; orderId: string },
  ): Promise<AdminResponse>;
}
```

**`decideCodAmount`** (Ruling 40):

```ts
export function decideCodAmount(order, intent) {
  if (order.paymentStatus === "refunded" || order.paymentStatus === "voided")
    return { ok: false, code: "ORDER_NOT_SHIPPABLE" };
  if (order.paymentStatus === "paid") return { ok: true, codAmountMinor: 0 };
  if (
    intent === null ||
    intent.provider !== "cod" ||
    !OPEN_COD_INTENT_STATUSES.has(intent.status)
  ) {
    return { ok: false, code: "ORDER_NOT_PAID" };
  }
  if (intent.amountMinor !== order.totalMinor) return { ok: false, code: "COD_AMOUNT_MISMATCH" };
  return { ok: true, codAmountMinor: intent.amountMinor };
}
```

**`ShipOrderWithCarrier.execute`:**

1. **Lock.** `lock?.acquire("carrier-ship:<tenantId>:<orderId>", 60_000)`. `null` → `SHIPMENT_IN_PROGRESS` (409). Release it in `finally`.
2. **Read.** `orders.read`; `null` → `ORDER_NOT_FOUND` (404). Not `open` → `ORDER_NOT_SHIPPABLE`. Then the COD decision, using `codIntent` only when `paymentRef` is set and the order isn't paid.
3. **Fulfillment.** `fulfillment.ensureReady`:
   - reuse the current fulfillment order from `getByOrder`, or `create` one with all items (`productRef = productId`);
   - a current one with status `shipment_dispatched` or later → `ORDER_NOT_SHIPPABLE` (Ruling 41);
   - then `prepareForCarrier`. `STOCK_NOT_RESERVED:` maps to 409.
4. **Shipment.** `shipping.getByFulfillment`:
   - a 404 → `create({ fulfillmentRef, packages: [{ reference: orderNumber, itemRefs: productIds, weightGrams: 1 }] })`;
   - `voided` → `advance(toStatus: "created")`;
   - `exception` → `SHIPMENT_NEEDS_REVIEW`.
5. **Label.** `shipping.createLabel` with:
   - `{ tenantId, shipmentId, carrier: { carrierKey, reference: orderNumber, recipient: { name: recipientName ?? "", phone: phone ?? "" }, address, codAmountMinor, currency, itemsCount, description, packageImages } }`;
   - `itemsCount` = the sum of quantities;
   - `description` = `items.map(i => `${i.name}${i.variantTitle ? ` (${i.variantTitle})` : ""} ×${i.quantity}`).join("، ")`;
   - `packageImages` = the https `imageUrl`s.

   A non-200 → `{ ok: false, code: body.code, httpStatus: status, reason: body.reason }`.

6. **Attach.** `fulfillment.attach(tenantId, fulfillmentOrderId, carrierKey, carrierDeliveryId, trackingNumber)`. A failure here is logged; the label exists, so it still returns ok, and the next call re-attaches (Ruling 35).

**`shipInBulk`:**

```ts
export async function shipInBulk(ship, input, nowMs) {
  const started = nowMs();
  const shipped: ShipResult[] = [];
  const failed: BulkShipResult["failed"][number][] = [];
  for (const [index, orderId] of input.orderIds.entries()) {
    if (nowMs() - started > BULK_BUDGET_MS - BULK_ORDER_RESERVE_MS) {
      for (const rest of input.orderIds.slice(index))
        failed.push({ orderId: rest, code: "CARRIER_TIMEOUT", attempted: false });
      break;
    }
    try {
      const outcome = await ship(orderId, `${input.idempotencyKey}:${orderId}`);
      if (outcome.ok) shipped.push(outcome.value);
      else
        failed.push({
          orderId,
          code: outcome.code,
          ...(outcome.reason ? { reason: outcome.reason } : {}),
          attempted: true,
        });
    } catch {
      failed.push({ orderId, code: "CARRIER_UNAVAILABLE", attempted: true });
    }
  }
  return { shipped, failed };
}
```

**Routes** (`carrierShippingRoutes(admin)`). Every body is `.strict()`, so a `cod` key is a 400 (Global Constraint 6).

| Route                                     | Permission                                                              | Body / query                                                                           | Answer                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `POST /orders/:orderId/carrier-shipments` | `shipping:create` + `shipping:create_label` (checked in the controller) | `{ carrierKey }`                                                                       | 200 `ShipResult`, or `{ code, message, reason? }` with the outcome's status; `idempotent: true`                 |
| `POST /orders/carrier-shipments`          | the same                                                                | `{ orderIds: z.array(id).min(1).max(50).refine(unique), carrierKey }`                  | 200 `BulkShipResult`                                                                                            |
| `GET /orders/:orderId/carrier-shipment`   | `shipping:read`                                                         |                                                                                        | `{ fulfillmentOrderId: string \| null; shipment: ShipmentDetailDto \| null; carriers: { key, displayName }[] }` |
| `GET /shipments/:shipmentId`              | `shipping:read`                                                         |                                                                                        | `ShipmentDetailDto`                                                                                             |
| `GET /shipments/:shipmentId/awb`          | `shipping:read`                                                         | `?format=A6\|A4&lang=ar\|en`                                                           | PDF                                                                                                             |
| `POST /shipments/awb`                     | `shipping:read`                                                         | `z.union([{ shipmentIds }, { orderIds }])`, each 1–50, plus optional `format` / `lang` | PDF, or 409 `{ code: "AWB_NOT_AVAILABLE", orderNumbers }`                                                       |
| `POST /shipments/:shipmentId/cancel`      | `shipping:void_label`                                                   |                                                                                        | 200 `{ shipmentId, status }`; `idempotent: true`                                                                |

- **A PDF answer** is `{ status: 200, body: Buffer.from(pdf), headers: { "content-type": "application/pdf", "cache-control": "private, no-store", "content-disposition": "inline; filename=\"waybills.pdf\"" } }`.
- **`orderIds` on `/shipments/awb`** resolve order → current fulfillment → shipment.
- **`ShipmentDetailDto` additions:** `carrierDeliveryId: string | null`, `needsReview: boolean` (`shipment.needsCarrierReview`) and `trackingEvents: { description, location, occurredAt }[]`, newest first.

- [ ] **Step 1: Write the failing tests**

`cod-amount.test.ts`:

```ts
const order = (over = {}) => ({
  paymentStatus: "pending" as const,
  totalMinor: 25000,
  paymentRef: "pi-1",
  ...over,
});
const cod = (over = {}) => ({
  provider: "cod",
  status: "created",
  amountMinor: 25000,
  currency: "EGP",
  ...over,
});
it("a paid order ships with COD 0", () =>
  expect(decideCodAmount(order({ paymentStatus: "paid" }), null)).toEqual({
    ok: true,
    codAmountMinor: 0,
  }));
it("an open COD intent equal to the total is the COD amount", () =>
  expect(decideCodAmount(order(), cod())).toEqual({ ok: true, codAmountMinor: 25000 }));
it("a pending card order is ORDER_NOT_PAID, never COD 0 (Review Focus 1)", () => {
  expect(decideCodAmount(order(), cod({ provider: "paymob" }))).toEqual({
    ok: false,
    code: "ORDER_NOT_PAID",
  });
  expect(decideCodAmount(order({ paymentRef: undefined }), null)).toEqual({
    ok: false,
    code: "ORDER_NOT_PAID",
  });
  expect(decideCodAmount(order(), cod({ status: "failed" }))).toEqual({
    ok: false,
    code: "ORDER_NOT_PAID",
  });
});
it("a COD intent that differs from the total is COD_AMOUNT_MISMATCH", () =>
  expect(decideCodAmount(order(), cod({ amountMinor: 24000 }))).toEqual({
    ok: false,
    code: "COD_AMOUNT_MISMATCH",
  }));
it("refunded or voided is ORDER_NOT_SHIPPABLE", () => {
  /* … */
});
```

`bulk-ship.test.ts`:

```ts
it("orders after the budget are CARRIER_TIMEOUT and never attempted (Review Focus 5)", async () => {
  let now = 0;
  const ship = vi.fn(async (orderId: string) => {
    now += 20_000;
    return okOutcome(orderId);
  });
  const r = await shipInBulk(
    ship,
    { orderIds: ["a", "b", "c", "d"], idempotencyKey: "k" },
    () => now,
  );
  expect(r.shipped.map((s) => s.orderId)).toEqual(["a", "b", "c"]);
  expect(r.failed).toEqual([{ orderId: "d", code: "CARRIER_TIMEOUT", attempted: false }]);
  expect(ship).toHaveBeenCalledTimes(3);
  expect(ship.mock.calls[0]).toEqual(["a", "k:a"]);
});
it("a failed order doesn't stop the next", async () => {
  /* b → { ok: false, code: "ADDRESS_NOT_SHIPPABLE" }; c still shipped */
});
```

`ship-order-with-carrier.test.ts` (fakes for all four deps):

- "ships: prepares fulfillment, creates the shipment, labels with the server COD, attaches tracking";
- "a held lock answers SHIPMENT_IN_PROGRESS";
- "an already-labelled order returns the same tracking number and re-attaches";
- "a voided shipment goes back to created before labelling";
- "an exception shipment is SHIPMENT_NEEDS_REVIEW";
- "a dispatched fulfillment is ORDER_NOT_SHIPPABLE";
- "the label request carries reference = order number and images from https line images only".

`carrier-shipping-routes.test.ts` (over `createAdminHttpApi` with a `fakeRegistration`):

- "a body with cod is a 400";
- "51 order ids is a 400";
- "another tenant's shipment id is 404 on awb and cancel";
- "AWB answers application/pdf with no-store";
- "AWB with an unlabelled order is 409 AWB_NOT_AVAILABLE with order numbers";
- "cancel detaches the fulfillment".

- [ ] **Step 2: Run** `pnpm --filter @platform/admin exec vitest run src/carrier-shipping src/http/carrier-shipping-routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `wireAdmin`, after `fulfillment` is wired:
  - build `CarrierOrderAdapter({ orders: orders.orders, payments: payments.payments, lineImageUrls })`. `lineImageUrls` wraps `resolveLineImages({ mediaImages, publicReads: { products: catalog.products } } as Pick<WiredAdmin, "mediaImages" | "publicReads">, …)` and maps each image to `url ?? null`;
  - build `CarrierFulfillmentAdapter(fulfillment.fulfillment)`;
  - build `ShipOrderWithCarrier({ …, shipping: shipping.shipping, lock: deps.distributedLock })`;
  - build `carrierShipping: new CarrierShippingAdminController({ … })`.

  The bulk route passes `() => Date.now()`.

- [ ] **Step 4: Run** `pnpm --filter @platform/admin test && pnpm --filter @platform/admin typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint && node scripts/ops/check-lint-warnings.mjs`. Expected: PASS, total ≤ 473.
- [ ] **Step 5: Commit** with `feat(admin): ship orders with a carrier, in bulk, print waybills and cancel`.

**Amendments (binding) — implementer: terra. Review depth: strong.**

1. **P7 — fulfillment errors are read from `body.message`.** `CarrierFulfillmentAdapter` reads the code from the envelope's `body.message` prefix (`/^([A-Z_]+):/`), because `body.code` is `BUSINESS_RULE`. Mapping:

   | Prefix                                     | Result                                                                                                      |
   | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
   | `STOCK_NOT_RESERVED`                       | `{ code: "STOCK_NOT_RESERVED", httpStatus: 409 }`                                                           |
   | `SHIPMENT_IN_PROGRESS`                     | `{ code: "SHIPMENT_IN_PROGRESS", httpStatus: 409 }`                                                         |
   | `FULFILLMENT_NOT_SHIPPABLE`                | `{ code: "ORDER_NOT_SHIPPABLE", httpStatus: 409 }`                                                          |
   | `FULFILLMENT_NOT_ATTACHABLE` from `attach` | `attach` returns `false` (logged by id)                                                                     |
   | any other non-2xx                          | `{ code: "ORDER_NOT_SHIPPABLE", httpStatus: 409 }`, unless the status is 404, which gives `ORDER_NOT_FOUND` |

   Test each row.

2. **F4 — a terminal shipment gets a replacement, with a new reference base.**
   - Phase 2 (step 4): a current shipment in `cancelled` or `closed` creates a **new** shipment for the same fulfillment.
   - Its label reference base is `${orderNumber}-r${k}`, where `k` is the number of shipments that already exist for the fulfillment. For the first replacement `k = 1`, so Bosta sees `<n>-r1-1`.
   - Add `ShipmentRepository.countByFulfillmentRef(fulfillmentRef: string, tenantId: string, tx?: unknown): Promise<number>` (Prisma: `count({ where: { tenantId, fulfillmentRef } })`; in-memory and `PostgresLikeShipmentRepository` count their tenant bucket). Add a `CountShipmentsByFulfillment` use case and `ShippingController.countByFulfillment({ tenantId, fulfillmentRef })` → 200 `{ count }`, exported.
   - `ShipOrderWithCarrier`'s `shipping` `Pick` adds `"countByFulfillment"`.
   - Statuses `delivered`, `returned` and `out_for_delivery`/`in_transit`/`carrier_accepted` are already refused by the fulfillment check (Ruling 41). If one appears on the shipment anyway → `ORDER_NOT_SHIPPABLE`.
   - Test: "a carrier-cancelled shipment ships again on a new shipment with reference `<n>-r1-1`" (the `createLabel` input's `carrier.reference` is `"1001-r1"`).
   - Run the tenant-where guard (`countByFulfillmentRef` names `tenantId`).
3. **F17 — `BULK_ORDER_RESERVE_MS = 25_000`** (it amends Ruling 36's 15 s; the start threshold is `elapsed > 30 s`). The budget test becomes: each ship advances 20 s; a starts at 0 and b at 20. c is checked at 40 > 30 and is skipped. Expected:
   - `shipped` order ids `["a", "b"]`;
   - `failed` = `[{ orderId: "c", code: "CARRIER_TIMEOUT", attempted: false }, { orderId: "d", code: "CARRIER_TIMEOUT", attempted: false }]`;
   - `ship` called 2 times.
4. **F22.** The `ShipOutcome` failure branch gains `orderNumber?: string`, set whenever the order was read. `BulkShipResult.failed[]` gains `orderNumber?: string`, copied from the outcome.
5. **F25.** `decideCodAmount`'s `order` `Pick` adds `"currency"`. After the provider/status check, `intent.currency !== order.currency` → `{ ok: false, code: "COD_AMOUNT_MISMATCH" }`. Test: `cod({ currency: "USD" })` with order currency `"EGP"` → mismatch. The test helper `order()` gains `currency: "EGP"`.
6. **F23.** At the `./http/product-images` import in `composition.ts`, add the comment `// type-only WiredAdmin import inside; no runtime cycle (preflight F23)`.
7. **P17.** For `POST /shipments/awb`, `CarrierShippingAdminController.printAwbs` first resolves every selected order → fulfillment → shipment, and collects the order numbers whose shipment is missing or in `created`/`voided`/`cancelled`. If any exist → 409 `{ code: "AWB_NOT_AVAILABLE", message, orderNumbers }`, without calling shipping. For `shipmentIds`, the shipping use case's own `AWB_NOT_AVAILABLE` gives `orderNumbers: []`.
8. **Fill the empty tests, and add these:**
   - **Refunded or voided:** `decideCodAmount(order({ paymentStatus: "refunded" }), cod())` and the same with `"voided"` → `{ ok: false, code: "ORDER_NOT_SHIPPABLE" }`.
   - **A failed order doesn't stop the next:** b → `{ ok: false, code: "ADDRESS_NOT_SHIPPABLE", httpStatus: 422, reason: "CITY_NOT_FOUND", orderNumber: "1002" }`. Expected `shipped` a and c, and `failed` `[{ orderId: "b", code: "ADDRESS_NOT_SHIPPABLE", reason: "CITY_NOT_FOUND", orderNumber: "1002", attempted: true }]`. A `ship` that throws → `{ orderId, code: "CARRIER_UNAVAILABLE", attempted: true }`.
   - **Lock:** `acquire` called with `("carrier-ship:t-1:o-1", 60_000)`. `release` is called once even when `createLabel` throws. `acquire` → `null` gives `{ ok: false, code: "SHIPMENT_IN_PROGRESS", httpStatus: 409 }` with no order read.
   - **Already labelled:** `createLabel` returns 200 `label_created` with `trackingNumber "5108002"` → ok with `"5108002"`, and `attach` called again with the same delivery id.
   - **Routes:** the `cod` body → 400; 51 ids → 400; duplicate ids → 400; another tenant's shipment → 404 on `GET /shipments/:id/awb` and `POST /shipments/:id/cancel`; the AWB answer has `content-type` `application/pdf` and `cache-control` `private, no-store`; an unlabelled order → 409 `{ code: "AWB_NOT_AVAILABLE", orderNumbers: ["1001"] }`; cancel → the fulfillment `detach` is called once with the fulfillment id.

9. **Plan review 1, finding 6: a stable reference base.** This replaces amendment 2's "creating" rule for the reference. The base is derived **on every request** from durable data, never only in the terminal branch:
   - `k = countByFulfillment(fulfillmentRef) − 1`, counted after any replacement shipment is created. The current shipment is always the newest, so `k` is its 0-based ordinal.
   - `base = k === 0 ? orderNumber : `${orderNumber}-r${k}``.
   - The base is passed as `carrier.reference` to `createLabel` in every path: first ship, reuse of a `created` shipment, after a definite failure, after a manual Retry, and after a crash between create and label.

   Tests, each asserting `createLabel`'s `carrier.reference`:
   - (a) first ship → `"1001"`;
   - (b) cancelled A, then B created → `"1001-r1"`;
   - (c) crash after B's create (B exists at `created` with no attempt; the next request) → still `"1001-r1"`;
   - (d) B's definite failure, then the next ship → `"1001-r1"` (the attempt suffix advances inside shipping: `-r1-2`);
   - (e) B parked, manual Retry, ship → `"1001-r1"`.

---

### Task 12: Runtime composition, config and boot guard

Model tier: **standard**.

**Files:**

- Create: `apps/runtime/src/bosta-registration.ts`, `bosta-registration.test.ts`
- Modify:
  - `apps/runtime/src/config.ts` (+ `config.carriers.test.ts`);
  - `apps/runtime/src/composition.ts`, `composition.test.ts`;
  - `apps/runtime/src/api.ts`: `assertProductionCarriersConfigured`, added to `guardFailures`, plus the new deps in `createAdminHttpApi({...})`;
  - `apps/runtime/package.json` (+ `@platform/carrier-bosta`);
  - `.env.example`.

**Interfaces:**

- Consumes: Task 6 (`BostaClient`, `BostaCityDirectory`, `BostaCarrierProvider`, `parseBostaConfig`); Task 3 (`CarrierRegistration`, `EnvelopeCarrierCredentialVault`, `CarrierCredentialVault`).
- Produces:

```ts
// config.ts
SHIPPING_CREDENTIALS_KEK_REF: z.string().min(32).optional(),
ADMIN_API_PUBLIC_URL: z.string().url().optional(),

// bosta-registration.ts
export const BOSTA_WEBHOOK_PATH = "/api/v1/public/shipping/webhook/bosta";
export function bostaWebhookUrl(adminApiPublicUrl: string): string; // trims trailing "/"
export function bostaRegistration(deps: { readonly webhookUrl: string; readonly cities: BostaCityDirectory }): CarrierRegistration;
// key "bosta", displayName "Bosta", backing "real", credentialFields ["apiKey"],
// capabilities { cod: true, awb: true, webhooks: true, cancel: true },
// create: ({ config, credentials, webhookHeaders }) => new BostaCarrierProvider({
//   client: new BostaClient({ apiKey: credentials.apiKey ?? "", fetch: (url, init) => fetch(url, init) }),
//   cities, config: parsed config, webhookUrl, webhookHeaders })
// The return type annotation `CarrierRegistration` is the structural check (Ruling 20).

// composition.ts — RuntimeCore
readonly carrierRegistrations: readonly CarrierRegistration[];
readonly carrierCredentialVault: CarrierCredentialVault | undefined;

// api.ts
export function assertProductionCarriersConfigured(
  appEnv: RuntimeConfig["APP_ENV"],
  carriers: { readonly kekConfigured: boolean; readonly webhookBaseConfigured: boolean; readonly vault: CarrierCredentialVault | undefined },
): void;
```

**What the boot guard refuses** outside `local`; `local` only warns, like the payments guard:

- exactly one of `SHIPPING_CREDENTIALS_KEK_REF` / `ADMIN_API_PUBLIC_URL` set: `"carriers are half-configured: set both SHIPPING_CREDENTIALS_KEK_REF and ADMIN_API_PUBLIC_URL, or neither (Ruling 31)"`;
- `vault?.backing === "stub"`: the in-memory vault is refused (§8.1).

**Composition:**

- `buildCarrierCredentialVault(kekRef)` registers the alias `"shipping-credentials"` → `kekRef` in a new `KeyAliasRegistry` and returns `new EnvelopeCarrierCredentialVault(new EnvelopeCipher(new NodeCrypto(), aliases), "shipping-credentials")`.
- `carrierRegistrations` = `[bostaRegistration({ webhookUrl: bostaWebhookUrl(ADMIN_API_PUBLIC_URL), cities: new BostaCityDirectory() })]` only when both values are set, else `[]`.
- `startApi` passes `carrierRegistrations`, `carrierCredentialVault` and `distributedLock: runtime.distributedLock` to `createAdminHttpApi`.

**`.env.example`** goes after the `PAYMENT_CREDENTIALS_KEK_REF` block:

```
# Project 5: merchants' carrier API keys (Bosta) and webhook secrets are sealed under this key-encryption
# key before they reach Postgres (apps/runtime/src/config.ts, min 32 chars). SHIPPING_CREDENTIALS_KEK_REF
# comes from the secret manager and is SEPARATE from PAYMENT_CREDENTIALS_KEK_REF, so rotating one never
# touches the other. Carriers need BOTH this and ADMIN_API_PUBLIC_URL; exactly one set refuses boot.
# SHIPPING_CREDENTIALS_KEK_REF=
# Public origin of the admin API (this service), e.g. https://api.example.com. Carriers post status
# updates to ${ADMIN_API_PUBLIC_URL}/api/v1/public/shipping/webhook/bosta.
# ADMIN_API_PUBLIC_URL=
```

- [ ] **Step 1: Write the failing tests**

- `bosta-registration.test.ts`:
  - "webhook URL is the public origin plus the route, trailing slash trimmed";
  - "create builds a provider with key bosta and the tenant's headers";
  - "parseConfig fills A6/ar/false".
- `api` guard tests:
  - "half-configured refuses outside local and warns in local";
  - "a stub vault is refused";
  - "neither set passes".
- `composition.test.ts`: "both set → bosta registered with a real vault"; "neither → no registrations, vault undefined".

- [ ] **Step 2: Run** `pnpm --filter @platform/runtime exec vitest run src/bosta-registration.test.ts src/composition.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Run `pnpm install --offline`, then `node scripts/ops/check-env-docs.mjs`.
- [ ] **Step 4: Run** `pnpm --filter @platform/runtime test && pnpm --filter @platform/runtime typecheck && pnpm --filter @platform/runtime lint && node scripts/ops/check-env-docs.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(runtime): compose bosta behind its own kek and the public api origin`.

**Amendments (binding) — implementer: sonnet. Review depth: standard.**

1. **F13 — the webhook origin must be https outside `local`.** `assertProductionCarriersConfigured`'s `carriers` argument gains `webhookBaseUrl: string | undefined`. Outside `local`, a set URL whose `new URL(v).protocol !== "https:"` refuses boot with `"ADMIN_API_PUBLIC_URL must use https outside local (preflight F13)"`. In `local` it warns, like the other checks. Test both.
2. **`.env.example`:** the `ADMIN_API_PUBLIC_URL` comment gains the line `# This is the admin API (runtime) origin, NOT admin-web's ADMIN_PUBLIC_URL.`
3. **F3 — fail first.** Step 2 also runs `pnpm --filter @platform/runtime typecheck`, which is expected to FAIL (`bosta-registration.ts` is missing). In Step 4 it passes with the explicit `: CarrierRegistration` return annotation. Never cast (`as CarrierRegistration`) or use `satisfies`-avoiding tricks: the annotation is the check.
4. **Test expectations:**
   - `bostaWebhookUrl("https://api.x.com/")` → `"https://api.x.com/api/v1/public/shipping/webhook/bosta"`.
   - `create({ config: {}, credentials: { apiKey: "k" }, webhookHeaders: { "x-tenant-id": "t-1", Authorization: "s" } })` → the provider's `key === "bosta"`.
   - `parseConfig(undefined)` → `{ ok: true, value: { awbFormat: "A6", awbLanguage: "ar", allowToOpenPackage: false } }`.
   - The guard: KEK only, `APP_ENV` `"production"` → throws the half-configured message; the same in `"local"` → no throw and a warning; a stub vault in production → throws; neither set → passes; an `http://` URL in production → throws the F13 message.

---

### Task 13: admin-web — the Carriers card and dialog

Model tier: **standard**.

**Files:**

- Create: `apps/admin-web/src/lib/api/carriers.ts` (+ test)
- Create: `apps/admin-web/src/app/settings/shipping/carrier-actions.ts` (+ test)
- Create: `apps/admin-web/src/components/settings/shipping/carriers-card.tsx` and `carrier-dialog.tsx` (+ tests)
- Modify:
  - `apps/admin-web/src/lib/api/client.ts`: `MutationResult`'s `conflict` / `invalid` / `error` outcomes gain `code?: string`, read from the envelope; `mutateAdminApi`'s `init` gains `timeoutMs?: number`;
  - `apps/admin-web/src/app/settings/shipping/page.tsx`;
  - `apps/admin-web/src/messages/en.ts`, `ar.ts` (a `carrierSettings` section).

**Interfaces:**

- Consumes: the Task 9 routes.
- Produces:

```ts
// lib/api/carriers.ts (server-only)
export interface CarrierSettingsEntryDto {
  /* = Task 4's DTO */
}
export interface CarrierSettingsDto {
  readonly carriers: readonly CarrierSettingsEntryDto[];
  readonly version: number;
}
export function fetchCarrierSettings(): Promise<ApiResult<CarrierSettingsDto>>;
export function fetchEnabledCarriers(): Promise<
  ApiResult<{ readonly carriers: readonly { key: string; displayName: string }[] }>
>;
export function updateCarrier(
  key: string,
  input: {
    enabled?: boolean;
    credentials?: Record<string, string>;
    config?: Record<string, unknown>;
    disconnect?: true;
  },
  idempotencyKey: string,
): Promise<MutationResult<CarrierSettingsDto>>;
export function rotateCarrierWebhookSecret(
  key: string,
  idempotencyKey: string,
): Promise<MutationResult<CarrierSettingsDto>>;

// app/settings/shipping/carrier-actions.ts ("use server")
export type CarrierActionState = FormState;
export async function saveCarrierAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState>;
export async function disconnectCarrierAction(carrierKey: string): Promise<FormState>;
export async function rotateCarrierSecretAction(carrierKey: string): Promise<FormState>;

// lib/shipping/carrier-errors.ts (shared with Task 14)
export function carrierErrorMessage(code: string | undefined, t: Dictionary): string; // falls back to t.formErrors.unexpected
```

**What the actions do:**

- **`saveCarrierAction`** reads `carrierKey` (`CARRIER_KEY_PATTERN`), `apiKey` (sent only when non-empty, ≤ 512), `awbFormat` ∈ {A6, A4}, `awbLanguage` ∈ {ar, en}, `allowToOpenPackage` ("on") and `enabled` ("on").
  - Invalid input → `{ status: "error", message: t.formErrors.invalid }`, with no API call.
  - The call runs inside `try { … } catch (error) { unstable_rethrow(error); return { status: "error", message: t.formErrors.unexpected, fieldErrors: {} }; }`.
  - The code maps through `carrierErrorMessage`.
  - It calls `revalidatePath("/settings/shipping")`.
- **The dialog** (`"use client"`, `useActionState`) shows:
  - the API key as `type="password"` with `autoComplete="off"`. Once configured, it is empty, with the placeholder `t.carrierSettings.apiKeySaved`;
  - the format and language selects and the open-package switch with its help text;
  - the read-only webhook URL with `CopyButton` (the existing `components/orders/copy-button.tsx`);
  - "Rotate", behind a confirm.

  The card lists the registered carriers with a Connected/Not connected badge and Connect / Settings / Disconnect (confirm).

**Copy** (`carrierSettings`; en / Egyptian ar):

| key                                 | en                                                                                                       | ar                                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `title`                             | Carriers                                                                                                 | شركات الشحن                                                                                             |
| `subtitle`                          | Connect your carrier once, then ship orders and print waybills from Morbeh.                              | وصّل حساب شركة الشحن مرة واحدة، وبعدها اشحن الطلبات واطبع البوالص من مربح.                              |
| `carrierBosta`                      | Bosta                                                                                                    | بوسطة                                                                                                   |
| `connected` / `notConnected`        | Connected / Not connected                                                                                | متوصّل / مش متوصّل                                                                                      |
| `connect`                           | Connect Bosta account                                                                                    | وصّل حساب بوسطة                                                                                         |
| `settings` / `disconnect`           | Settings / Disconnect                                                                                    | الإعدادات / افصل الحساب                                                                                 |
| `confirmDisconnect`                 | Disconnect Bosta? You won't be able to ship or print waybills with it until you connect again.           | تفصل حساب بوسطة؟ مش هتقدر تشحن أو تطبع بوالص بيه لحد ما توصّله تاني.                                    |
| `apiKey`                            | API key                                                                                                  | مفتاح الـ API                                                                                           |
| `apiKeyHelp`                        | In Bosta's dashboard: Settings → API Integration.                                                        | هتلاقيه في لوحة بوسطة: الإعدادات ← API Integration.                                                     |
| `apiKeySaved`                       | Saved. Paste a new key only to replace it.                                                               | المفتاح متسجّل. الصق مفتاح جديد بس لو عايز تغيّره.                                                      |
| `awbFormat` / `a6` / `a4`           | Default waybill size / A6 (thermal printer) / A4                                                         | مقاس البوليصة الافتراضي / A6 (طابعة حرارية) / A4                                                        |
| `awbLanguage` / `langAr` / `langEn` | Waybill language / Arabic / English                                                                      | لغة البوليصة / عربي / إنجليزي                                                                           |
| `allowOpen`                         | Let the customer open the package before paying                                                          | العميل يقدر يفتح الشحنة قبل ما يدفع                                                                     |
| `allowOpenHelp`                     | Bosta needs product photos for this. Orders whose products have no photo can't be shipped while it's on. | بوسطة محتاجة صور المنتجات عشان كده. الطلبات اللي منتجاتها مالهاش صور مش هتتشحن طول ما الاختيار ده شغال. |
| `enabled`                           | Ship orders with Bosta                                                                                   | اشحن الطلبات مع بوسطة                                                                                   |
| `webhookUrl` / `webhookHelp`        | Status updates address / Morbeh sends this with every shipment, so there's nothing to add in Bosta.      | عنوان تحديثات الحالة / مربح بيبعته مع كل شحنة، فمش محتاج تضيف حاجة في بوسطة.                            |
| `rotate` / `confirmRotate`          | Rotate secret / Shipments already on the road keep updating for 7 days only.                             | غيّر الكود السري / الشحنات اللي في الطريق هتفضل تتحدّث ٧ أيام بس.                                       |
| `save` / `cancel`                   | Save / Cancel                                                                                            | احفظ / إلغاء                                                                                            |
| `credentialsRejected`               | Bosta rejected this API key. Check it and try again.                                                     | بوسطة رفضت المفتاح ده. راجعه وجرّب تاني.                                                                |
| `unavailable`                       | Couldn't reach Bosta right now. Try again in a minute.                                                   | مش قادرين نوصل لبوسطة دلوقتي. جرّب كمان دقيقة.                                                          |
| `notAvailable`                      | Bosta isn't available on this platform yet.                                                              | بوسطة مش متاحة على المنصة لسه.                                                                          |
| `notConfigured`                     | Paste the API key first.                                                                                 | الصق مفتاح الـ API الأول.                                                                               |

- [ ] **Step 1: Write the failing tests**

- `carrier-actions.test.ts` (mocks `@/lib/api/carriers`):
  - "an empty API key is not sent (config-only update)";
  - "an invalid awbFormat never calls the API";
  - "CARRIER_CREDENTIALS_REJECTED maps to the Egyptian message";
  - "a thrown error returns the localised fallback and rethrows Next control errors".
- `carrier-dialog.test.tsx`:
  - "the saved key is never rendered; the field is empty with the saved placeholder";
  - "copy button copies the webhook URL";
  - "rotate asks for confirmation".
- `client.test.ts`: "a 409 envelope's code is surfaced".

- [ ] **Step 2: Run** `cd apps/admin-web && pnpm exec vitest run src/app/settings/shipping src/components/settings/shipping src/lib/api/client.test.ts src/lib/api/carriers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The page fetches `fetchCarrierSettings()` alongside the zones, and renders `CarriersCard` above `ZonesView`. An `unauthorized` result hides the card. The client components import only _types_ from `@/lib/api/*`.
- [ ] **Step 4: Run** `pnpm --filter admin-web test && pnpm --filter admin-web typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint`, plus the route-contract test and the client-bundle grep. Expected: PASS, three pre-existing grep hits only.
- [ ] **Step 5: Commit** with `feat(admin-web): connect bosta from settings, shipping`.

**Amendments (binding) — implementer: terra. Review depth: standard.**

1. **F21 — Task 13 creates `apps/admin-web/src/lib/shipping/carrier-errors.ts` (+ `carrier-errors.test.ts`).** Add both to Files and to the commit. It exports:
   - `export const CARRIER_KEY = /^[a-z][a-z0-9_-]{1,31}$/; // mirrors CARRIER_KEY_PATTERN in services/shipping/src/domain/value-objects/carrier-key.ts`.
   - `carrierErrorMessage(code, t)`:

     | Code                           | Message                                 |
     | ------------------------------ | --------------------------------------- |
     | `CARRIER_CREDENTIALS_REJECTED` | `t.carrierSettings.credentialsRejected` |
     | `CARRIER_UNAVAILABLE`          | `t.carrierSettings.unavailable`         |
     | `CARRIER_NOT_AVAILABLE`        | `t.carrierSettings.notAvailable`        |
     | `CARRIER_NOT_CONFIGURED`       | `t.carrierSettings.notConfigured`       |
     | anything else or `undefined`   | `t.formErrors.unexpected`               |

   - Tests: each mapped code in `en` and `ar`, plus `"NOPE"` → the fallback.
   - Every action validates `carrierKey` with `CARRIER_KEY`. admin-web never imports `@platform/shipping`.
2. **F18.** `updateCarrier` and `rotateCarrierWebhookSecret` pass `timeoutMs: 20_000` to `mutateAdminApi`. `carriers.test.ts` asserts the option on one call of each, by mocking the client module.
3. **Expected values for the listed tests:**
   - **Empty API key:** `updateCarrier` is called with an input that has no `credentials` key.
   - **Invalid `awbFormat`** `"Z"` → `{ status: "error", message: t.formErrors.invalid }`, with 0 API calls.
   - **Rejected key:** `MutationResult` `{ outcome: "conflict", code: "CARRIER_CREDENTIALS_REJECTED" }` → the message equals `ar.carrierSettings.credentialsRejected` when the locale is ar.
   - **Thrown error:** the client throws `new Error("x")` → `t.formErrors.unexpected`. A thrown Next redirect error (the same helper the existing action tests use) is rethrown.
   - **`client.test.ts`:** a 409 with envelope `{ code: "CARRIER_CREDENTIALS_REJECTED", message: "…" }` → `outcome: "conflict"`, `code` the same.
   - **Dialog:** after save, the stored key string passed in props never appears in `container.innerHTML`; the field's value is `""` and its placeholder is `t.carrierSettings.apiKeySaved`. The copy button writes `webhookUrl` (mock `navigator.clipboard.writeText`). "Rotate" opens a confirm, and the action is not called before confirming.
4. **i18n.** `lib/i18n.test.ts` parity passes. New ar copy says مربح, never موربيه.

5. **Plan review 1, finding 10: the error-state shape.** Every action that returns `FormState` returns errors as `{ status: "error", message, fieldErrors: {} }`. The expected values in amendment 3 include `fieldErrors: {}`. Never change the global `FormState` type.

---

### Task 14: admin-web — order carrier card, timeline, orders-list bulk ship and print, PDF proxy

Model tier: **standard**.

**Files:**

- Create: `apps/admin-web/src/lib/api/carrier-shipments.ts` (+ test), `apps/admin-web/src/lib/shipping/carrier-errors.ts` (+ test)
- Create: `apps/admin-web/src/app/orders/carrier-actions.ts` (+ test), `apps/admin-web/src/app/orders/awb/route.ts` (+ test)
- Create these components in `apps/admin-web/src/components/orders/` (+ tests for each client component):
  - `order-carrier-card.tsx` (server);
  - `carrier-shipment-actions.tsx` (client);
  - `shipment-timeline.tsx`;
  - `orders-selection.tsx` (client: `OrdersSelectionProvider`, `OrderSelectCheckbox`, `OrdersBulkBar`);
  - `bulk-ship-results-dialog.tsx` (client).
- Modify:
  - `apps/admin-web/src/lib/api/client.ts`: add `postAdminApiForBytes`;
  - `apps/admin-web/src/components/orders/orders-table.tsx`: a checkbox column when `selectable`;
  - `apps/admin-web/src/app/orders/page.tsx` and `apps/admin-web/src/app/orders/[orderId]/page.tsx`: `export const maxDuration = 90;`, the carrier card and the selection;
  - `apps/admin-web/src/messages/en.ts`, `ar.ts` (a `carrierShipping` section).

**Interfaces:**

- Consumes: the Task 11 routes; `carrierErrorMessage` (created here, used by Task 13 too: move it here if Task 13 inlined it); `fetchEnabledCarriers` (Task 13).
- Produces:

```ts
// client.ts
export type BytesResult =
  | { readonly outcome: "ok"; readonly bytes: Uint8Array }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | {
      readonly outcome: "conflict";
      readonly code?: string;
      readonly orderNumbers: readonly string[];
    }
  | { readonly outcome: "error"; readonly message: string };
export async function postAdminApiForBytes(
  path: string,
  body: unknown,
  timeoutMs?: number,
): Promise<BytesResult>;

// lib/api/carrier-shipments.ts
export interface CarrierShipmentViewDto {
  readonly fulfillmentOrderId: string | null;
  readonly shipment:
    | (ShipmentDetailDto & {
        readonly carrierDeliveryId: string | null;
        readonly needsReview: boolean;
        readonly trackingEvents: readonly {
          description: string;
          location: string | null;
          occurredAt: string;
        }[];
      })
    | null;
  readonly carriers: readonly { readonly key: string; readonly displayName: string }[];
}
export function fetchOrderCarrierShipment(
  orderId: string,
): Promise<ApiResult<CarrierShipmentViewDto>>;
export function shipOrderWithCarrier(
  orderId: string,
  carrierKey: string,
  idempotencyKey: string,
): Promise<MutationResult<ShipResultDto>>; // timeoutMs 30_000
export function shipOrdersWithCarrier(
  orderIds: readonly string[],
  carrierKey: string,
  idempotencyKey: string,
): Promise<MutationResult<BulkShipResultDto>>; // timeoutMs 75_000
export function cancelCarrierShipment(
  shipmentId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>>;
export function fetchAwbPdf(input: {
  orderIds: readonly string[];
  format?: "A4" | "A6";
  lang?: "ar" | "en";
}): Promise<BytesResult>; // timeoutMs 30_000

// app/orders/carrier-actions.ts ("use server")
export type ShipActionResult =
  | { readonly status: "success"; readonly trackingNumber: string }
  | { readonly status: "error"; readonly message: string };
export async function shipWithCarrierAction(
  orderId: string,
  carrierKey: string,
): Promise<ShipActionResult>;
export async function bulkShipWithCarrierAction(
  orderIds: readonly string[],
  carrierKey: string,
): Promise<
  | {
      readonly status: "success";
      readonly shipped: number;
      readonly failed: readonly { orderId: string; orderNumber?: string; message: string }[];
    }
  | { readonly status: "error"; readonly message: string }
>;
export async function cancelCarrierShipmentAction(
  orderId: string,
  shipmentId: string,
): Promise<FormState>;
export async function retryCarrierShipmentAction(
  orderId: string,
  shipmentId: string,
  carrierKey: string,
): Promise<ShipActionResult>; // retry, then ship (Ruling 42)

// app/orders/awb/route.ts
export async function GET(request: NextRequest): Promise<Response>;
```

**Action validation.** Every action checks `orderId` / `shipmentId` against `/^[A-Za-z0-9-]{1,64}$/`, `carrierKey` against `CARRIER_KEY_PATTERN`, and `orderIds` for 1–50 unique entries. A failure → `t.formErrors.invalid`, with no API call. Each action wraps its calls in `try { … } catch (e) { unstable_rethrow(e); … t.formErrors.unexpected }` and calls `revalidatePath("/orders")` and `/orders/<id>`. The bulk failure list resolves `orderNumber` from the result where the API provides it, else shows the id.

**The proxy route** (Ruling 37):

- It parses `orderIds` (a comma list, 1–50, each matching the id pattern), `format` ∈ {A4, A6} and `lang` ∈ {ar, en}. Invalid → `400 text/plain` with the localised `t.formErrors.invalid`.
- `ok` → `new Response(bytes, { status: 200, headers: { "content-type": "application/pdf", "cache-control": "private, no-store", "content-disposition": "inline; filename=\"waybills.pdf\"", "x-content-type-options": "nosniff" } })`.
- `conflict` → `409 text/plain; charset=utf-8` with `t.carrierShipping.awbNotAvailable.replace("{orders}", orderNumbers.map((n) => `#${n}`).join("، "))`.
- Other outcomes map to their status, with the localised text and `cache-control: private, no-store`.

**The UI:**

- **Order page:** `OrderCarrierCard` sits under `OrderItemsCard`.
  - With no shipment, at least one enabled carrier, and `fulfillmentStatus` either `unfulfilled` or `in_progress`, it shows the primary "اشحن مع بوسطة".
  - With a label, it shows the tracking number with `CopyButton`, "تتبّع على بوسطة" (Ruling 39), "اطبع البوليصة" (`<a href="/orders/awb?orderIds=<id>" target="_blank" rel="noopener">`) and, while `label_created`, "الغي الشحنة" behind a confirm.
  - With `needsReview`, it shows the review note and "راجعت بوسطة — اشحن تاني".
  - `ShipmentTimeline` lists `trackingEvents`: scan text in `<bdi dir="auto">`, place, time via `formatDateTime`.
- **Orders list:** `OrdersSelectionProvider` wraps the table. The checkbox cell is `relative z-10`, so it sits above the stretched row link, and has `aria-label = t.carrierShipping.selectOrder.replace("{n}", orderNumber)`.
  - The sticky `OrdersBulkBar` shows "{count} متحدد", "اشحن مع بوسطة" (only when a carrier is enabled), "اطبع البوالص" (opens `/orders/awb?orderIds=…` in a new tab) and "الغي التحديد".
  - A 51st selection is refused with `tooMany`.
  - Shipping opens `BulkShipResultsDialog` with the counts and each failure's localised reason.
  - After an action, the bar keeps focus on its own buttons.

**Copy** (`carrierShipping`):

| key                                                          | en                                                                                                                                   | ar                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `shipWith`                                                   | Ship with {carrier}                                                                                                                  | اشحن مع {carrier}                                                                                          |
| `shipping`                                                   | Shipping…                                                                                                                            | جاري الشحن…                                                                                                |
| `shipped`                                                    | Shipped with {carrier}                                                                                                               | اتشحن مع {carrier}                                                                                         |
| `trackingNumber`                                             | Tracking number                                                                                                                      | رقم التتبع                                                                                                 |
| `trackOnCarrier`                                             | Track on Bosta                                                                                                                       | تتبّع على بوسطة                                                                                            |
| `printWaybill` / `printWaybills`                             | Print waybill / Print waybills                                                                                                       | اطبع البوليصة / اطبع البوالص                                                                               |
| `cancelShipment` / `confirmCancel`                           | Cancel shipment / Cancel this Bosta shipment? You can ship the order again afterwards.                                               | الغي الشحنة / تلغي شحنة بوسطة دي؟ تقدر تشحن الطلب تاني بعدها.                                              |
| `needsReview`                                                | We couldn't confirm whether Bosta created this shipment. Check Bosta's dashboard: if it's there, cancel it, then press "Ship again". | مش متأكدين إن بوسطة عملت الشحنة. افتح لوحة بوسطة: لو الشحنة موجودة الغيها من هناك، وبعدين دوس «اشحن تاني». |
| `shipAgain`                                                  | I checked Bosta — ship again                                                                                                         | راجعت بوسطة — اشحن تاني                                                                                    |
| `timelineTitle` / `noEvents`                                 | Tracking / No updates from the carrier yet.                                                                                          | تتبّع الشحنة / لسه مفيش تحديثات من شركة الشحن.                                                             |
| `selected` / `clearSelection` / `selectOrder` / `tooMany`    | {count} selected / Clear / Select order #{n} / Select up to 50 orders.                                                               | {count} متحدد / الغي التحديد / حدّد الطلب #{n} / حدّد ٥٠ طلب بالكتير.                                      |
| `resultsTitle` / `shippedCount` / `failedCount` / `close`    | Shipping results / {count} shipped / {count} not shipped / Close                                                                     | نتيجة الشحن / اتشحن {count} / ماتشحنش {count} / قفل                                                        |
| `awbNotAvailable`                                            | These orders have no waybill yet: {orders}                                                                                           | الطلبات دي لسه مالهاش بوليصة: {orders}                                                                     |
| `errors.ORDER_NOT_SHIPPABLE`                                 | This order can't be shipped (cancelled, closed or already shipped).                                                                  | الطلب ده مش ممكن يتشحن (ملغي أو مقفول أو اتشحن قبل كده).                                                   |
| `errors.ORDER_NOT_PAID`                                      | Collect payment or mark the order paid first. Only cash-on-delivery orders ship unpaid.                                              | حصّل الفلوس أو علّم الطلب مدفوع الأول. طلبات الدفع عند الاستلام بس اللي بتتشحن من غير دفع.                 |
| `errors.COD_AMOUNT_MISMATCH`                                 | The cash-on-delivery amount doesn't match the order total. Review the payment before shipping.                                       | مبلغ الدفع عند الاستلام مش زي إجمالي الطلب. راجع الدفع قبل الشحن.                                          |
| `errors.COD_ABOVE_CARRIER_LIMIT`                             | Bosta collects up to 30,000 EGP per shipment.                                                                                        | بوسطة بتحصّل لحد ٣٠٬٠٠٠ جنيه في الشحنة الواحدة.                                                            |
| `errors.ADDRESS_NOT_SHIPPABLE`                               | Bosta can't deliver to this address. Fix the governorate or area and try again.                                                      | بوسطة مش هتقدر توصّل للعنوان ده. صحّح المحافظة أو المنطقة وجرّب تاني.                                      |
| `errors.PHONE_NOT_SHIPPABLE`                                 | The customer's phone must be an Egyptian mobile number (01xxxxxxxxx).                                                                | رقم العميل لازم يكون موبايل مصري (01xxxxxxxxx).                                                            |
| `errors.CURRENCY_NOT_SUPPORTED`                              | Bosta ships orders in Egyptian pounds only.                                                                                          | بوسطة بتشحن الطلبات اللي بالجنيه المصري بس.                                                                |
| `errors.OPEN_PACKAGE_NEEDS_IMAGES`                           | "Open before paying" is on, but this order's products have no photos.                                                                | اختيار «يفتح قبل ما يدفع» شغال، بس منتجات الطلب ده مالهاش صور.                                             |
| `errors.STOCK_NOT_RESERVED`                                  | Not enough stock to ship this order.                                                                                                 | المخزون مش كفاية لشحن الطلب ده.                                                                            |
| `errors.CARRIER_NOT_ENABLED` (also `CARRIER_NOT_CONFIGURED`) | Bosta isn't connected. Connect it in Settings → Shipping.                                                                            | بوسطة مش متوصّلة. وصّلها من الإعدادات ← الشحن.                                                             |
| `errors.CARRIER_CREDENTIALS_REJECTED`                        | Bosta rejected your API key. Update it in Settings → Shipping.                                                                       | بوسطة رفضت مفتاح الـ API بتاعك. حدّثه من الإعدادات ← الشحن.                                                |
| `errors.CARRIER_TIMEOUT`                                     | Bosta didn't answer in time. Try again.                                                                                              | بوسطة ماردّتش في الوقت. جرّب تاني.                                                                         |
| `errors.CARRIER_UNAVAILABLE`                                 | Couldn't reach Bosta right now. Try again in a minute.                                                                               | مش قادرين نوصل لبوسطة دلوقتي. جرّب كمان دقيقة.                                                             |
| `errors.CARRIER_CREATE_IN_PROGRESS`                          | This shipment is still being created. Wait a minute, then try again.                                                                 | الشحنة لسه بتتعمل. استنى دقيقة وجرّب تاني.                                                                 |
| `errors.CARRIER_RESULT_UNKNOWN` / `SHIPMENT_NEEDS_REVIEW`    | = `needsReview`                                                                                                                      | = `needsReview`                                                                                            |
| `errors.SHIPMENT_IN_PROGRESS`                                | Someone is already shipping this order.                                                                                              | في حد بيشحن الطلب ده دلوقتي.                                                                               |
| `errors.CARRIER_REJECTED`                                    | Bosta refused this shipment. Check the order details and try again.                                                                  | بوسطة رفضت الشحنة. راجع بيانات الطلب وجرّب تاني.                                                           |
| `errors.CARRIER_CANCEL_NOT_ALLOWED`                          | Bosta already picked up this shipment, so it can't be cancelled here.                                                                | بوسطة استلمت الشحنة خلاص، فمش ممكن تتلغي من هنا.                                                           |
| `errors.CARRIER_CANCEL_REFUSED`                              | Bosta refused to cancel this shipment. Cancel it from Bosta's dashboard.                                                             | بوسطة رفضت تلغي الشحنة. الغيها من لوحة بوسطة.                                                              |
| `errors.AWB_NOT_AVAILABLE`                                   | Some selected orders have no waybill yet.                                                                                            | في طلبات من اللي حددتها لسه مالهاش بوليصة.                                                                 |

- [ ] **Step 1: Write the failing tests**

- `carrier-actions.test.ts`:
  - "a malformed order id never calls the API";
  - "51 ids are refused";
  - "ORDER_NOT_PAID shows the Egyptian message";
  - "retry calls the retry route then ships";
  - "a thrown fetch returns the localised fallback".
- `awb/route.test.ts`:
  - "streams application/pdf with private, no-store and never caches";
  - "409 lists the order numbers in Arabic";
  - "a bad orderIds list is 400 with no API call".
- `orders-selection.test.tsx`:
  - "selecting rows shows the bar with the count";
  - "the 51st selection is refused with the message";
  - "print opens the proxy URL with the selected ids";
  - "the bulk results dialog lists failures with reasons".
- `order-carrier-card.test.tsx`:
  - "no shipment + enabled carrier shows ship";
  - "label_created shows tracking, print and cancel";
  - "needsReview shows the note and ship again";
  - "the timeline renders scans in `bdi`".

- [ ] **Step 2: Run** `cd apps/admin-web && pnpm exec vitest run src/app/orders src/components/orders src/lib/api src/lib/shipping`. Expected: FAIL.
- [ ] **Step 3: Implement.** Client components import only types from `@/lib/api/*` and call server actions.
- [ ] **Step 4: Run** `pnpm --filter admin-web test && pnpm --filter admin-web typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint`, the route-contract test, the client-bundle grep and `node scripts/ops/check-lint-warnings.mjs`. Expected: PASS, three pre-existing grep hits, total ≤ 473.
- [ ] **Step 5: Commit** with `feat(admin-web): ship and print with bosta from the order page and orders list`.

**Amendments (binding) — implementer: sonnet. Review depth: standard.**

1. **F21 — `lib/shipping/carrier-errors.ts` already exists (Task 13).** Remove it from Create; **extend** it. `carrierErrorMessage` first checks `t.carrierShipping.errors[code]` (when the key exists), then Task 13's settings map, then the fallback. Both `CARRIER_RESULT_UNKNOWN` and `SHIPMENT_NEEDS_REVIEW` return `t.carrierShipping.needsReview`. `CARRIER_NOT_CONFIGURED` returns the `CARRIER_NOT_ENABLED` text. Extend its test with three shipping codes.
2. **F2 copy.** Add `errors.CARRIER_USE_CANCEL`:
   - en: `Use "Cancel shipment" on the order page for Bosta shipments.`
   - ar: `استخدم «الغي الشحنة» من صفحة الطلب لشحنات بوسطة.`

   The existing technical shipment screen (`components/orders/shipment-lifecycle-actions.tsx`) shows this message when its void/transition action returns that code. Add one test.

3. **F18.** `cancelCarrierShipment` passes `timeoutMs: 30_000`; assert it in `carrier-shipments.test.ts`.
4. **F22.** The bulk results dialog shows `#<orderNumber>` when the failure carries `orderNumber`, else the order id (this replaces "resolves `orderNumber` from the result where the API provides it"). Test both.
5. **Retry.** `retryCarrierShipmentAction` calls the existing retry client (`lib/api/shipping.ts`, the function that posts `/shipments/:id/retry`), then `shipOrderWithCarrier`. If the retry is non-ok, its error is returned and nothing ships. The test asserts the call order `[retry, ship]`.
6. **Expected values for the listed tests:**
   - **Malformed order id** `"../x"` → `{ status: "error", message: t.formErrors.invalid }`, with 0 API calls.
   - **51 ids** → the same.
   - **`ORDER_NOT_PAID`** → `ar.carrierShipping.errors.ORDER_NOT_PAID`.
   - **Thrown fetch** → `t.formErrors.unexpected`.
   - **AWB route:**
     - ok → status 200 with headers `content-type: application/pdf`, `cache-control: private, no-store`, `x-content-type-options: nosniff`;
     - conflict `orderNumbers ["1001", "1002"]` with locale ar → 409 body `"الطلبات دي لسه مالهاش بوليصة: #1001، #1002"`;
     - `orderIds=` (empty), or 51 ids → 400, with 0 client calls.
   - **Selection:** after selecting 2 rows the bar shows `"2 متحدد"` (ar). The 51st checkbox click leaves the count at 50 and shows `tooMany`. Print calls `window.open("/orders/awb?orderIds=a,b", "_blank", …)`.
   - **Card:** state by state, as listed. The timeline's scan text is inside a `bdi` element with `dir="auto"`.
7. **Lint cap and client-bundle grep** as in Step 4. `next build` is not a gate (EPERM on this machine).

8. **Plan review 1, finding 8: the card's state/action table.** This replaces the "With no shipment …" bullet. "Ship" means `shipWithCarrierAction`; it is shown only when at least one carrier is enabled and `fulfillmentStatus ∈ {unfulfilled, in_progress}`.

   | Shipment state                                                    | Card shows                                                                                   |
   | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
   | none                                                              | Ship                                                                                         |
   | `created` (no label; a timeout or definite refusal left it)       | Ship, labelled `t.carrierShipping.shipWith` (the backend resumes or uses the next reference) |
   | `label_created`                                                   | tracking + copy + track + print + Cancel (confirm)                                           |
   | `carrier_accepted` … `delivered` / `delivery_failed` / `returned` | tracking + copy + track + print (no cancel)                                                  |
   | `voided` (local cancel)                                           | Ship                                                                                         |
   | `cancelled` (carrier cancel)                                      | Ship (the backend creates the `-r<k>` replacement)                                           |
   | `closed`                                                          | Ship only when `fulfillmentStatus ∈ {unfulfilled, in_progress}`, else nothing                |
   | `exception` with `needsReview`                                    | the review note + "Ship again" (retry → ship)                                                |
   | `exception` without `needsReview`                                 | the review note only                                                                         |

   Component tests: (a) `created` after a timeout shows Ship; (b) `created` after a definite refusal shows Ship; (c) `voided` shows Ship; (d) `cancelled` shows Ship; (e) `needsReview` shows "Ship again" and not Ship.

9. **Plan review 1, finding 9: `CARRIER_USE_CANCEL` travels through the existing actions.**
   - Add `apps/admin-web/src/app/orders/[orderId]/shipment/actions.ts` (+ its test) to Files.
   - In its void-label and advance actions, when the `MutationResult` carries `code`, return `{ status: "error", message: carrierErrorMessage(code, t), fieldErrors: {} }`, with `t` from the same locale resolution the file already uses. Every other path is unchanged (`toFormState`).
   - Test the real action: mock the API client to answer `{ outcome: "conflict", code: "CARRIER_USE_CANCEL", message: "x" }` with the locale ar → the returned message equals `ar.carrierShipping.errors.CARRIER_USE_CANCEL`.
   - Drop the component-only test from amendment 2.
10. **Plan review 1, finding 10: the error-state shape.** `cancelCarrierShipmentAction` (a `FormState`) returns `{ status: "error", message, fieldErrors: {} }`. `ShipActionResult` and the bulk union keep `{ status: "error", message }`. Amendment 6's expected values follow each action's declared type.

---

## Final verification (after Task 14)

- [ ] `pnpm --filter @platform/shipping exec vitest run --coverage`, `pnpm --filter @platform/fulfillment exec vitest run --coverage` and `pnpm --filter @platform/carrier-bosta exec vitest run --coverage` all hold their floors.
- [ ] `pnpm --filter @platform/admin test`, `pnpm --filter @platform/runtime test`, `pnpm --filter admin-web test` and `pnpm --filter @platform/auth test` pass. Each package's `typecheck` passes.
- [ ] `node scripts/ops/check-lint-warnings.mjs` shows a total ≤ 473.
- [ ] `node scripts/dev/check-prisma-tenant-where.mjs` shows the one known finding only.
- [ ] `node scripts/ops/check-env-docs.mjs` passes.
- [ ] `grep -rn "موربيه" apps/admin-web/src/messages` shows only the pre-existing `brand` key (Ruling 43).
- [ ] `git status --short` shows nothing from `.superpowers/` or `.claude/` staged.

## Self-review (done while writing this plan)

1. **Spec coverage:**

   | Spec section  | Where                                                                                                                                                       |
   | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | §4.1          | Tasks 3, 4, 9, 13                                                                                                                                           |
   | §4.2          | Tasks 7, 11, 14                                                                                                                                             |
   | §4.3          | Tasks 11, 14                                                                                                                                                |
   | §4.4          | Tasks 6, 7, 11, 14                                                                                                                                          |
   | §4.5          | Tasks 5, 8, 10                                                                                                                                              |
   | §4.6          | Tasks 6, 7, 11, 14                                                                                                                                          |
   | §6 anti-goals | Rulings 3–7, 12, 40; Review Focus 1–3                                                                                                                       |
   | §7            | Global Constraints                                                                                                                                          |
   | §8.1          | Tasks 3, 4, 9, 12                                                                                                                                           |
   | §8.2          | Tasks 5, 6                                                                                                                                                  |
   | §8.3          | Task 5, Rulings 9, 10, 16, 17                                                                                                                               |
   | §8.4          | Ruling 1, Task 7                                                                                                                                            |
   | §8.5 + §9a.1  | Tasks 4, 5, 8, 10                                                                                                                                           |
   | §8.6 + §9a.2  | Task 11                                                                                                                                                     |
   | §8.7          | Tasks 13, 14                                                                                                                                                |
   | §8.8          | No new topics: the existing `shipping.*` events come from the transitions. `shipping.tracking.updated` carries only ids and status (`ShipmentTransitioned`) |
   | §9 checklist  | Global Constraints 6–8, Tasks 4, 10, 11                                                                                                                     |
   | §9a.3         | Task 2                                                                                                                                                      |
   | §9a.4         | Tasks 1, 2, 8                                                                                                                                               |
   | §9a.5         | Tasks 1, 7                                                                                                                                                  |
   | §10           | the Bosta facts section, Task 5's governorate table, Task 11's DTO, the migration name `20261112000000_…` after `20261016010000_…`, and Task 9's seed       |

   No gaps.

2. **Step scan:** every code step names the file, the signature and the spec values. Bodies appear only for the BFS, the phone normaliser, the COD decision and the budgeted loop, which the signatures don't determine. Each test step carries its assertions.
3. **Type consistency:**
   - `CarrierProvider` (Task 3) ⇄ `BostaCarrierProvider` (Task 6): the method names `prepare`, `createDelivery`, `findDeliveriesByReference`, `cancelDelivery`, `printAwbs`, `getDelivery` and `verifyCredentials` match. `CarrierParcelRequest` and `BostaParcel` are the same shape, and `carrierFailure` / `code` / `reason` / `timedOut` match on both errors.
   - `CreateLabelInput.carrier: CarrierLabelDetails` (Task 7) is what `ShipOrderWithCarrier` builds (Task 11).
   - `RecordCarrierWebhookOutput.transitions` / `fulfillmentRef` (Task 8) feed Task 10's mirror call into `mirrorShipmentStatus` (Task 2).
   - `webhookVaultKey` (Task 3) is used by Task 4.
   - `CARRIER_KEY_PATTERN` (Task 3) is used by Tasks 9, 13 and 14.
4. **Review Focus:** five lines, each pinned in its owning task's tests by name.
5. **Proportion:** the plan is about 6× the spec (≈2,860 lines against 484), which is the reference plan's density. Most of that is the verified API facts, the 43 rulings, the test code and the copy tables that admin-web needs verbatim. Code bodies appear only for the four algorithms named in item 2.
6. **Fixes made during the review:**
   - the resolver's order no longer treats `backing` and the vault as one condition;
   - `available` now means "a vault is composed";
   - the Review Focus test names now match the test titles exactly.

**Plan complete.** It is saved to `docs/superpowers/plans/2026-11-12-local-carriers-part1-bosta.md`.
