# Local carriers (Egypt): design

Project 5 of the Shopify-parity roadmap (`reports/shopify-features-for-morbeh.md`, section 5, P0 item 4).
Branch `morbeh/local-carriers`, cut from `fix/ci-green-main` (main + PR #2's CI fixes).

The owner asked for decisions to be made on his behalf ("نفذ وخد القرارات مكاني ما يخدم مصلحة المنصة"), so every
choice below is Claude's call, recorded as such. None of them were agreed with the owner.

## 1. Intent

The report calls carrier integration "the most important feature for the Egyptian merchant". Today a Morbeh
merchant takes every order, retypes the customer's name, phone, address and cash-on-delivery amount into
the carrier's dashboard, prints the waybill there, and copies the tracking number back by hand, if at all.
Each order costs minutes and invites typos in phone numbers and COD amounts. A wrong COD amount is real
money lost.

Success means a merchant connects their carrier account once, then ships an order, or 50 orders, in one
click. They print the waybills from Morbeh and stop retyping. Order statuses then follow the carrier on
their own: shipped, in transit, delivered, returned.

## 2. What exists (from the code survey)

- **`services/shipping`** already has a carrier-agnostic `Shipment` aggregate.
  - It has 13 statuses, `createLabel` / `voidLabel`, tracking events, a `RecordCarrierWebhook` use case
    with idempotency, and a `CarrierProviderPort`.
  - Only an `InMemoryCarrierProvider` is wired (`composition.ts`). `CreateLabelRequest` carries no tenant,
    recipient, address, weight or COD.
  - The tables `shipping.shipments`, `shipping.shipping_attempts` and `shipping.processed_webhooks` exist,
    with RLS.
- **`services/fulfillment`** has `FulfillmentOrder`.
  - It has 18 statuses and its own `carrierReference` / `trackingNumber`.
  - The orders list derives its fulfillment status from it.
  - `Shipment.fulfillmentRef` is the fulfillment order id.
- **admin-web** has an order → fulfillment → shipment flow (`app/orders/[orderId]/fulfillment`,
  `.../shipment`).
  - Its forms are manual and technical: carrier and tracking are typed by hand.
  - There is no bulk shipping and no waybill printing.
- **Payments** has the full pattern to copy:
  - a `ProviderRegistry` of registrations (`credentialFields`, `parseConfig`, `create`);
  - a per-call `TenantPaymentProviderResolver`;
  - `MerchantPaymentSettings` (`providerSettings` Json of `{config, sealedCredentials}`);
  - an envelope-encrypted credential vault keyed by `PAYMENT_CREDENTIALS_KEK_REF`;
  - a public signed webhook route that verifies against the receiving tenant's own secret;
  - `RecordWebhook` with a Prisma processed-webhook store;
  - provider packages (`packages/psp-paymob`) with an injectable `HttpFetch` and JSON fixtures.
- **Not present:** carrier settings, credentials, any real carrier, waybill printing, a shopper tracking page,
  shipping notifications, and a tracking poll job. Orders' `ShippingPort.requestShipment` has no real
  adapter and is refused at production boot.

## 3. Shape of the project (Claude's call)

Project 5 ships in three parts, each with its own plan, review loop and PR-ready head:

1. **Part 1: carrier foundation + Bosta, end to end** (this document's detailed scope).
2. **Part 2: tracking for the shopper and the backstops.** This covers:
   - a storefront tracking page;
   - a scheduled tracking poll for missed webhooks;
   - creating Bosta pickup requests;
   - shipment events ready for project 8's notification templates.
3. **Part 3: more carriers.** Aramex, J&T, R2S and SMSA, one carrier package each, added as registrations
   with no change to the shipping core.

**Why Bosta first (Claude's call):** it is the most common carrier for small Egyptian online shops. It has a
documented REST API (docs.bosta.co) with COD, waybill printing and webhooks. Building one carrier
end to end proves the registry before more are added.

Parts 2 and 3 are summarised in §11 so Part 1's design leaves room for them. Only Part 1 is planned now.

## 4. Goals (Part 1)

1. **Connect a carrier.** A merchant opens Settings → Shipping → Carriers, picks Bosta and pastes their
   Bosta API key. Morbeh checks the key with one harmless read call, stores it encrypted, and never shows it
   again.
2. **Ship one order.** On an order that has a shipping address, "Ship with Bosta" does three things in one
   action:
   - creates the Bosta delivery, filled from the order: receiver, phone, address, item count and
     description, and a COD amount computed by the server;
   - records the shipment with its tracking number;
   - marks the order's fulfillment as shipped with tracking.
3. **Ship many orders.** From the orders list, the merchant selects up to 50 orders and chooses "Ship with
   Bosta". Each order succeeds or fails on its own, and the result lists the failures with reasons.
4. **Print waybills.** "Print waybill" works on one shipment or up to 50 selected ones. It produces one PDF,
   in A4 or A6 (thermal) format and in Arabic or English, fetched from Bosta on demand and never stored.
5. **Statuses follow the carrier.** Bosta webhooks move the shipment and the fulfillment through in transit,
   out for delivery, delivered, delivery failed/exception, returned and cancelled. Each scan is added to
   the tracking history, and the order list's fulfillment badge follows.
6. **Cancel.** Before pickup, "Cancel shipment" cancels the Bosta delivery (if Bosta's API allows it, see
   §8.4) and voids the shipment, so the order can be shipped again.

## 5. Non-goals (Part 1)

- **Not in Part 1:**
  - live carrier rate quotes at checkout (roadmap P2);
  - local pickup and merchant couriers (P1);
  - returns and exchanges through the carrier (Bosta types 25/30);
  - automatic shipping when an order is paid;
  - partial shipments, meaning several Bosta deliveries for one order.
- **Deferred to Part 2:** Bosta pickup scheduling (until then the merchant requests pickups in Bosta's
  dashboard), the shopper tracking page, the poll job and notifications.
- **Deferred to Part 3:** carriers other than Bosta.
- **Not changed:** orders' `ShippingPort.requestShipment` and its production boot guard. The merchant ships
  explicitly; nothing ships automatically.

## 6. Anti-goals (what would make this a failure even if it works)

- **A wrong COD amount sent to the carrier.** The amount is always computed on the server from the order:
  - order total minus what is already paid, for COD orders;
  - 0 for paid orders.

  It is never taken from the client, and is never above Bosta's 30,000 EGP limit (§8.2).

- **Marking an order paid because the carrier said "delivered".** Money stays an explicit merchant action.
  Bosta's reported collected `cod` is shown as information only.
- **Leaking credentials.** No read DTO, log line, error message or webhook response may carry the API key.
  The key is sealed per tenant and per carrier, so copying a sealed blob to another tenant must fail to
  open.
- **A webhook that one merchant's Bosta account (or anyone) can use to move another merchant's
  shipments.** Every webhook resolves to exactly one tenant and is authenticated with that tenant's own
  secret.
- **Storing waybill PDFs.** They contain customer PII and are re-fetchable, so they are fetched on demand
  and streamed, never stored.
- **A half-shipped order.** If the carrier call succeeds but saving fails, the next attempt must reuse the
  same carrier delivery and not create a second one.

## 7. Constraints

- **Tenancy and transactions:**
  - ADR-0014: every new adapter, resolver, store and provider is a process-wide singleton taking
    `tenantId` per call, and `assertMultiTenantReady` must stay green.
  - Credentials are resolved per call and never cached across tenants.
  - RLS: every new tenant-scoped table gets `ENABLE` + `FORCE ROW LEVEL SECURITY` + `tenant_isolation` in
    its own hand-written, additive migration. Never run migrate or db push; the owner deploys.
  - Carrier HTTP calls run outside open transactions, using the existing precheck → external call → settle
    shape.
  - Domain events are written through the outbox in the same transaction as the aggregate.
- **Error codes** travel as a `CODE:` message prefix to `body.code`.
- **admin-web rules:**
  - client components never value-import `lib/api` or `lib/auth`;
  - server actions validate their arguments;
  - actions are wrapped in `unstable_rethrow` with localised errors;
  - admin copy is Egyptian Arabic, and the brand is مربح;
  - ar/en parity.
- **Outbound HTTP:** an injectable `HttpFetch` with an `AbortController` timeout, typed API errors that
  never echo response bodies, and tests that use JSON fixtures copied from Bosta's documentation. No test
  calls Bosta.
- **CI:** the lint warning cap (473) must not rise, and coverage floors must hold.

## 8. Design decisions (Part 1)

### 8.1 Carrier registry and merchant carrier settings (mirror payments)

- **`CarrierRegistration`** in `services/shipping/src/application/carrier-registry.ts`. It mirrors
  `ProviderRegistration`:
  - `key` (`"bosta"`) and `displayName`;
  - `backing: "real" | "stub"`;
  - `credentialFields` (for Bosta: `apiKey`) and `parseConfig` for non-secret config (for Bosta: the default
    AWB format, `A6` | `A4`, plus language and `allowToOpenPackage`);
  - `capabilities` (`cod`, `awb`, `webhooks`, `cancel`);
  - `create(ctx)` returns a `CarrierProvider`. It is called on every resolution and never cached.
- **`CarrierRegistry.from()`** rejects duplicate or malformed keys.
- **`MerchantCarrierSettings`**, a new table `shipping.merchant_carrier_settings` (Claude's call to mirror
  `MerchantPaymentSettings`):
  - `tenant_id` PK;
  - `enabled_carriers text[]`;
  - `carrier_settings jsonb` of `{ [key]: { config, sealedCredentials, webhook: { tokenHash, sealedSecret } } }`;
  - `version`, timestamps;
  - RLS.

  A new carrier adds a key, not a migration.

- **`CarrierCredentialVault`** uses `@platform/secrets` `EnvelopeCipher`, a copy of
  `EnvelopePaymentCredentialVault`, sealing `{v, t, c, s}` and re-checking the tenant and carrier on open.
  - It has its own key alias `"shipping-credentials"` and its own env var `SHIPPING_CREDENTIALS_KEK_REF`
    (min 32, optional; documented in `.env.example`).
  - **Claude's call:** a separate KEK, so a payments key compromise or rotation does not touch carriers,
    and the reverse.
  - The Bosta registration is added at the composition root only when the KEK is set, as Paymob is.
  - The in-memory vault is refused outside `APP_ENV=local`.
- **`TenantCarrierResolver`** (`resolve(tenantId, carrierKey)`) reads settings, opens credentials and
  calls `create`. It answers `CARRIER_NOT_ENABLED` / `CARRIER_NOT_CONFIGURED`.
- **Admin routes:**
  - `GET /shipping/carriers` (permission `shipping:read_settings`): the registered carriers with their
    enabled/configured state and config. It never returns credentials, and it returns the webhook URL to
    paste into Bosta.
  - `PUT /shipping/carriers/:key` (permission `shipping:update_settings`, idempotency key): enable or
    disable, write-only credentials, and config. On a credential change it verifies the key first, with one
    read-only call such as `GET /cities?countryId=…`, and refuses with `CARRIER_CREDENTIALS_REJECTED` on
    401/403.
  - The two new permissions are added to the role table (owner and admin).

### 8.2 The Bosta package

`packages/carrier-bosta`, shaped like `packages/psp-paymob`.

- **Base URL and auth:** `https://app.bosta.co/api/v2`, header `Authorization: <apiKey>` with no prefix,
  plus `Content-Type: application/json`.
- **`createDelivery(input)`** sends `POST /deliveries?apiVersion=1` with:
  - `type: 10` (Deliver);
  - `specs.packageType` (default `"SMALL"`);
  - `specs.packageDetails { itemsCount, description }`, where the description is item titles clipped to
    Bosta's limit;
  - `cod` in EGP;
  - `dropOffAddress` (§8.3);
  - `receiver { firstName, lastName, phone }`;
  - `businessReference` (the order number);
  - `notes`;
  - `allowToOpenPackage` (from config);
  - `webhookUrl` + `webhookCustomHeaders` (§8.5).

  It returns `{ deliveryId, trackingNumber }`.

- **Idempotency:** Bosta has no idempotency key. Before creating, Morbeh records a `ShippingAttempt` with the
  attempt key. If a previous attempt's response was lost, the retry must not create a second delivery: look
  up by `businessReference` if Bosta's API offers a search, otherwise mark the shipment `exception` and ask
  the merchant to check Bosta. The builder verifies against Bosta's API reference which of the two is
  possible.
- **COD rules:**
  - The amount is in EGP with two decimals, converted from minor units.
  - It must be ≤ 30,000 EGP; above that, refuse with `COD_ABOVE_CARRIER_LIMIT` before calling Bosta.
  - It must be ≥ 0.
- **`printAwbs({ trackingNumbers, format, lang })`** sends `POST /deliveries/mass-awb` with
  `{ trackingNumbers: "a,b", requestedAwbType, lang }`.
  - It returns PDF bytes decoded from the base64 response.
  - At most 50 per call. Above 50, Bosta emails a zip instead, so Morbeh never sends more than 50.
- **`getDelivery(trackingNumber)`** reads state and history; it is used by Part 2's poll.
- **`cancelDelivery`:** see §8.4.
- **State mapping.** Bosta `state` codes map to shipment transitions:

  | Bosta state                                                      | Shipment                                                   |
  | ---------------------------------------------------------------- | ---------------------------------------------------------- |
  | 10, 11, 20 (pickup requested, waiting for route, route assigned) | `label_created`, no transition                             |
  | 21, 24, 30 (picked up, received at warehouse, between hubs)      | `carrier_accepted`, then `in_transit`                      |
  | 41 with `type: SEND`                                             | `out_for_delivery`                                         |
  | 45 (delivered)                                                   | `delivered`                                                |
  | 47 (exception)                                                   | `delivery_failed`, with `exceptionReason` as the scan text |
  | 46 or 60 (returned to business, returned to stock)               | `returned`                                                 |
  | 48 or 49 (terminated, canceled)                                  | `cancelled`                                                |
  | 100 or 101 (lost, damaged)                                       | `exception`                                                |

  Codes not listed are added as tracking events only.
  - Out-of-order or impossible transitions never throw. They are recorded as a scan, and the status stays.
  - The table lives in the package with a test per row.

### 8.3 Addresses (Egypt)

- **What orders hold:** `OrderShippingAddress` has `recipientName`, `phone`, `line1`, `line2`, `city` (free
  text: district or area), `province` (ISO 3166-2, e.g. `EG-C`) and `country`.
- **Governorates:** the package holds a static table of the 27 Egyptian governorates' ISO codes mapped to
  Bosta city names, checked against `GET /cities?countryId=…`.
- **City and district resolution:** Bosta's `cityId` is resolved through `GET /cities`. The result is cached
  per process with a TTL. It is not tenant data, but each tenant's own key performs the fetch, and the cache
  is keyed by country, not by tenant. The order's `city` text is sent as `districtName` with `cityId`.
- **Address line:** `firstLine` is `line1` (+ `line2`), and must be more than 5 characters.
- **When the address can't be resolved** (no province, a non-EG country, a district Bosta rejects): the
  order fails with `ADDRESS_NOT_SHIPPABLE` and Bosta's reason. The order page shows the address so the
  merchant can fix it, and in bulk that order is listed as failed. Nothing is guessed.
- **Receiver name:** `recipientName` is split on the first space into `firstName` / `lastName`, with a
  fallback of a last name of `"-"`, since Bosta requires one.
- **Phone:** normalised to Egyptian national format (`01xxxxxxxxx`) with the existing phone helpers.
  Anything else is refused with `PHONE_NOT_SHIPPABLE`.

### 8.4 Cancel

- **If Bosta's API reference documents a cancel or terminate call** for not-yet-picked-up deliveries, the
  "Cancel shipment" action calls it and then `voidLabel`.
- **If it doesn't:** the action is shown only before pickup, voids locally, and tells the merchant, in
  Egyptian Arabic, to cancel the delivery in Bosta's dashboard too.

The builder verifies which case applies. The plan picks one, and §8.4 is updated with the choice.

### 8.5 Webhooks: tenant resolution and authentication

- **Delivery-level config:** Morbeh sets `webhookUrl` + `webhookCustomHeaders` on every delivery it creates,
  so the merchant configures nothing in Bosta's dashboard and an existing dashboard webhook isn't
  disturbed.
- **URL:** `https://<admin API public host>/api/v1/public/shipping/webhook/bosta/<token>`.
  - `<token>` is a random 32-byte, URL-safe value minted per tenant when Bosta is first enabled.
  - Only its SHA-256 is stored (`webhook.tokenHash`), so it resolves the tenant by lookup.
- **Header:** `Authorization: <secret>`, a second random value stored sealed (`webhook.sealedSecret`). The
  route verifies it with `timingSafeEqual` against the resolved tenant's secret.
- **Why two values:** the token in the URL can leak through logs, and the header proves the caller is Bosta
  acting for that tenant.
- **Rotation:** an admin action, "Rotate webhook secret", issues both values again. Old deliveries keep
  posting with the old values and are refused, so the plan states the trade-off. **Claude's call:** keep
  the previous pair valid for 7 days after a rotation.
- **The route:**
  - `public: true`, with a raw body and a size limit.
  - It answers 401 on any mismatch without saying which part failed, and 200 on a duplicate.
  - It extracts only known fields and calls `RecordCarrierWebhook` with
    `eventId = "${trackingNumber}:${state}:${timeStamp}"`.
- **Store:** a Prisma `ProcessedCarrierWebhookStore` on the existing `shipping.processed_webhooks`,
  copying `PrismaProcessedWebhookStore`, including P2002 treated as "already processed".
- **`RecordCarrierWebhook`** is extended to add a tracking event (description, location, time) for every
  accepted webhook, as well as the transition. Unknown states become a scan.

### 8.6 Ship-with-carrier orchestration

There is one new use case in the admin composition, crossing contexts through adapters, as the existing
cross-context adapters do. **Claude's call:** an orchestrator in `apps/admin` rather than a new
bounded-context dependency.

`ShipOrderWithCarrier { orderId, carrierKey, tenantId, idempotencyKey }` runs four phases:

1. **Read.** It reads the order through the orders context: lines, shipping address, payment method, and
   amounts paid and outstanding. It refuses with `ORDER_NOT_SHIPPABLE` when the order is cancelled, closed,
   already fully shipped, or has no shipping address.
2. **Ensure the fulfillment and shipment exist.**
   - It reuses the order's open fulfillment order or creates one for all unfulfilled items.
   - It reuses that fulfillment's open shipment or creates one.
   - Both creates are idempotent on keys derived from `(orderId, idempotencyKey)`.
3. **Carrier call.** It goes through the extended `CreateLabel`.
   - `CreateLabelRequest` gains `tenantId`, `recipient`, `address`, `codAmountMinor`, `currency`,
     `itemsCount`, `description`, `reference` and `carrierKey`.
   - The carrier call stays outside transactions.
   - `ShippingLabel` gains `carrierDeliveryId`. It still holds no bytes.
4. **Settle.** The shipment becomes `label_created` with the tracking number, and the fulfillment order
   becomes `shipment_created` + `tracking_assigned`, through the fulfillment context's existing
   transitions.

**COD amount:** when the order's payment method is `cod`, the amount is the outstanding balance; otherwise
it is 0. It is computed inside this use case and never accepted from the request.

**Bulk:** `POST /orders/carrier-shipments` accepts `{ orderIds (1–50), carrierKey }` and runs the per-order
use case sequentially, each with its own derived key. It returns `{ shipped: [...], failed: [{orderId, code}] }`.
The run is bounded so a slow carrier can't hold the request open forever: per-call timeout times 50 is too
long, so the plan sets a per-call timeout and an overall budget, and returns partial results for the rest
with `CARRIER_TIMEOUT`.

**Routes and permissions:**

| Route                                                                  | Permission                                    |
| ---------------------------------------------------------------------- | --------------------------------------------- |
| `POST /orders/:orderId/carrier-shipments`                              | `shipping:create` and `shipping:create_label` |
| `POST /orders/carrier-shipments`                                       | the same                                      |
| `GET /shipments/:id/awb?format=A6&lang=ar` (streams `application/pdf`) | `shipping:read`                               |
| `POST /shipments/awb` (up to 50 shipment ids; streams one PDF)         | `shipping:read`                               |
| `POST /shipments/:id/cancel`                                           | `shipping:void_label`                         |

Every route is tenant-scoped. A shipment id from another tenant is "not found".

### 8.7 admin-web

- **Settings:**
  - Settings → Shipping gains a "Carriers" card listing the registered carriers.
  - The Bosta row offers Connect, Disconnect and Settings, with a dialog for the API key (write-only,
    masked once saved), the default waybill format (A6/A4), the waybill language, "Allow opening the
    package", and the read-only webhook URL with a copy button and a "Rotate" action.
  - Egyptian copy, e.g. "وصّل حساب بوسطة", "مفتاح الـ API".
- **Order page:** the shipping card shows a primary action when Bosta is enabled and the order is shippable.
  - The action is "اشحن مع بوسطة". It runs as a server action, then shows the tracking number, a link to
    Bosta's public tracking page, "اطبع البوليصة" and "الغي الشحنة".
  - Failure codes map to localised messages.
  - The existing technical fulfillment and shipment screens stay as they are.
- **Orders list:** the existing bulk-selection bar gains "اشحن مع بوسطة" and "اطبع البوالص" (up to 50).
  - Shipping shows a results dialog with failures and reasons.
  - Printing opens the PDF in a new tab, through a route handler in admin-web that proxies the admin API
    stream so the token never reaches the browser.
- **Shipment timeline:** the order page shows the tracking events (scan text, place, time) from the
  shipment.

### 8.8 Events

- **No new topics in Part 1:** the existing `shipping.*` types cover label created, carrier accepted, in
  transit, delivered and so on. The fulfillment transitions emit their existing `fulfillment.order.*`
  types.
- **For Part 2's notifications**, the tracking-updated event carries only ids, status and time: no address
  or phone.

## 9. Security checklist (Part 1)

- **Credentials:**
  - sealed per tenant and per carrier;
  - write-only in the API;
  - never logged;
  - verified before they are saved;
  - the boot guard refuses the in-memory vault outside local.
- **Webhooks:**
  - tenant resolved by token hash;
  - secret compared with `timingSafeEqual`;
  - body size limited;
  - only allow-listed fields read;
  - dedupe by event id;
  - no echo of payload in errors.
- **Money:** the COD amount is computed on the server, capped, and never inferred as "paid".
- **PII:**
  - waybills are streamed and never stored;
  - the admin-web proxy never caches (`Cache-Control: private, no-store`);
  - receiver data is sent only to the merchant's own carrier account.
- **Tenancy:**
  - every route and store takes the per-call tenant, with RLS on the new table;
  - an id from another tenant is "not found";
  - the `tenant-mode-guard` and `check-prisma-tenant-where` checks stay green.

## 9a. Rulings after the builder check (Claude's calls; they amend §6–§8)

1. **Webhook tenant (replaces the token in §8.5).**
   - **How the tenant reaches the route:**
     - The HTTP layer resolves tenants synchronously from the token claim or `x-tenant-id`.
     - The new table is `FORCE`d under RLS, so a cross-tenant lookup by hash cannot work.
     - Morbeh therefore sets `webhookCustomHeaders = { "x-tenant-id": <tenantId>, "Authorization": <secret> }`
       on every delivery, so the existing resolver yields `context.tenantId`.
   - **The route:** `POST /public/shipping/webhook/bosta`, with no token in the URL. It reads that tenant's
     sealed secret (an RLS-scoped read) and compares it with `timingSafeEqual`.
   - **Stored values:** `webhook.sealedSecret` (current) and `webhook.previousSealedSecret` +
     `previousValidUntil` (7 days after a rotation). Drop `tokenHash`.
   - **Hidden failures:** a wrong secret and an unknown tenant both answer 401, with the same body.
   - **Suspended tenants:** webhooks follow whatever the HTTP layer already does for Paymob's public
     webhook. Do not add a special case.
2. **The COD amount comes from Payments, and anything unclear is refused (amends §8.6).**
   - The orchestrator reads the order's payment intents through a cross-context adapter:
     - **Order `paid`:** COD is 0.
     - **Open intent with `provider === "cod"`, not yet collected:** COD is that intent's `amountMinor`. It
       must equal the order's grand total; if not, refuse with `COD_AMOUNT_MISMATCH`.
     - **Anything else** (no intent, card pending or failed, an unpaid manual or draft order): refuse with
       `ORDER_NOT_PAID`. The merchant collects or marks it paid first.
   - The amount is never guessed and never 0 by default.
3. **Fulfillment path (approved change to the fulfillment state machine; additive only).**
   - **Walking the steps:** the orchestrator walks a new fulfillment order through the existing transitions
     up to `tracking_assigned`. Reservation goes through the existing reserve use case and fails with
     `STOCK_NOT_RESERVED` if inventory refuses. Confirm, picking and packing are automatic steps.
   - **Badges:**
     - label created → `tracking_assigned` ("in progress, waiting for pickup");
     - Bosta pickup (21/24/30) → `shipment_dispatched` (the order badge becomes "fulfilled");
     - delivered → `delivered`.
   - **New transitions:** `shipment_created` and `tracking_assigned` → `packing_completed` ("label voided"),
     so a cancelled shipment can be shipped again.
4. **Shipment and fulfillment transition tables may be extended (additive, Part 1).**
   - **New shipment transitions:**
     - `returned` from `in_transit` / `out_for_delivery` / `delivery_failed` / `exception`;
     - `delivery_failed` from `in_transit`;
     - `cancelled` from `carrier_accepted` / `in_transit` (carrier terminated before delivery);
     - `exception` from `created` (see 5).
   - **Fulfillment mirror:** the fulfillment table gains the same returned and failed paths.
   - **Skip-ahead:** `RecordCarrierWebhook` walks the forward happy path when a webhook skips steps (e.g.
     `label_created` → `delivered` after missed webhooks), recording one transition per step.
   - **Bosta → fulfillment mapping:**

     | Shipment                          | Fulfillment                              |
     | --------------------------------- | ---------------------------------------- |
     | `carrier_accepted` / `in_transit` | `shipment_dispatched`, then `in_transit` |
     | `out_for_delivery`                | `out_for_delivery`                       |
     | `delivered`                       | `delivered`                              |
     | `delivery_failed`                 | `delivery_failed`                        |
     | `returned`                        | `returned`                               |
     | `cancelled`                       | back to `packing_completed`              |

   - If the status columns carry CHECK constraints, a hand-written additive migration updates them.
5. **A create that is "in flight" is durable (approved domain and schema change).**
   - **The pending attempt:** before the carrier call, `CreateLabel` writes a `ShippingAttempt` with the new
     outcome `pending`, in its own transaction. Settle turns it into `succeeded` or `failed`.
   - **Unique reference:** `businessReference` is `<orderNumber>-<attemptSeq>`, so a search never matches an
     older, cancelled delivery.
   - **Retry after a lost response:** a retry that finds a `pending` attempt with no result does one of two
     things:
     - if Bosta supports search by `businessReference`, it looks the delivery up and settles with it;
     - otherwise it moves the shipment to `exception` with the note "check Bosta's dashboard; cancel the
       delivery there if it exists, then press Retry". `RetryShipment` then goes `exception` → `created`.

## 10. What is left to the builder (the plan settles these)

- **Bosta API reference checks:**
  - exact request and response field names;
  - whether search by `businessReference` and cancel exist;
  - the Egypt `countryId` for `/cities`;
  - districts versus zones.

  Record what was verified in the plan, with doc links. Fixtures are copied from the reference.

- The exact split of the governorate → Bosta city name table, and its tests.
- How to reuse or extend the fulfillment and shipment admin DTOs, and the shipment read for the timeline.
  The survey found no shipment list or get-by-id read, so add one.
- Task breakdown, migration naming (after the latest migration on this branch), and the permissions seed.

## 11. Later parts (summary only)

- **Part 2:**
  - **Storefront tracking page:** `/track/<orderNumber>`, gated by the last 4 digits of the phone, or a
    signed link in notifications. It shows the status timeline and the carrier's tracking link.
  - **Poll job:** a scheduler job polls `getDelivery` for shipments that haven't moved in 12 hours or
    longer and aren't terminal. It iterates tenants that have carriers enabled, in bounded batches.
  - **Pickups:** Bosta pickup requests from the orders list.
  - **Events:** shipment events in a shape that project 8's notification templates can use.
- **Part 3:** `packages/carrier-aramex`, `carrier-jt`, `carrier-r2s` and `carrier-smsa`, each a registration
  plus fixtures, after verifying each carrier's API. No change to the shipping core.
