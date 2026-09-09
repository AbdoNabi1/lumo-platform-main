# WP-2 — Give the data plane a producer: emit events from the storefront

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely.
> **Depends on:** nothing. **Conflicts with:** WP-7 and WP-8 (all three edit `apps/storefront/src`).
> **Closes:** G-43. **Unblocks:** WP-3, WP-4, WP-5, WP-7 — every one of them consumes what this produces.

## Why this exists

This repository contains a genuinely sophisticated event pipeline that has never received a single
event.

Verify it yourself before starting, so you understand the shape of the gap:

```bash
grep -rn "@platform/tracking" apps/storefront/src ; echo "exit=$?"
```

Zero hits. `@platform/tracking` is listed in `apps/storefront/package.json:19` and never imported.

What already exists and must be **used, not rebuilt**:

| Piece                                                                                                                                                            | Where                                                       | State                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------- |
| Event envelope (page/identity/session/technical/attribution contexts, click-ids, payload with minor-unit money)                                                  | `packages/tracking/src/envelope/`                           | complete             |
| Collector — validation, write-key resolution, IP policy, session/anonymous cookie issuing                                                                        | `packages/tracking/src/collector/collector.ts`, `collect()` | complete             |
| Collector HTTP app — `POST /collect`, Fastify binding, write-key registry                                                                                        | `apps/collector/src/` (server.ts:53)                        | complete, deployable |
| Pipeline — validation, channel resolution, enrichment, identity graph, attribution snapshot, hashing                                                             | `packages/tracking/src/pipeline/`                           | complete             |
| Delivery — router, mapping, HTTP adapters, and **seeded real destinations**: Meta CAPI, Google Ads, GA4, TikTok Events, Snapchat, with click-id mapping profiles | `packages/tracking/src/delivery/platform-profiles.ts`       | complete             |
| Priority queue (`purchase`/`refund` = critical, `add_to_cart`/`checkout_started` = high, `page_viewed` = low)                                                    | `packages/tracking/src/queue/queue.ts:85-87`                | complete             |
| Runtime wiring, ingest, Prisma event-record store                                                                                                                | `apps/runtime/src/tracking/`                                | complete             |

What does **not** exist: **a browser SDK.** There is nothing in `packages/tracking` that runs in a
browser, batches events, or posts to `/collect`. `packages/tracking/src/queue/queue.ts` is a
server-side scheduling queue for _delivery to destinations_ — it is not a browser send queue, and
its own doc comment says so. Do not mistake one for the other.

## Scope

Build the browser SDK, wire it into the storefront, and emit the canonical events. Server-side
emission of the revenue event is included, because a browser-only `purchase` is the single biggest
source of attribution loss and the brief calls out server-side tracking explicitly (§15).

## The canonical event names — use these exact strings

Taken from `packages/tracking/src/queue/queue.ts` (which already classifies three of them) and the
brief §14. Do not invent variants; the priority classifier and the mapping profiles key off these.

| Event              | Emitted from                         | Priority (already defined) |
| ------------------ | ------------------------------------ | -------------------------- |
| `page_viewed`      | every storefront route               | `low`                      |
| `product_viewed`   | `products/[slug]`                    | normal                     |
| `add_to_cart`      | cart actions                         | `high`                     |
| `checkout_started` | `checkout` entry                     | `high`                     |
| `purchase`         | **server-side**, on order placement  | `critical`                 |
| `search`           | `search` page with a non-empty query | normal                     |
| `signup`           | `account/register` success           | normal                     |
| `login`            | `account/login` success              | normal                     |

If an event name you need is absent from `queue.ts`'s classifier, it falls through to `normal` —
that is fine, do not edit the classifier to add it unless the priority is genuinely wrong.

## Tasks

- [ ] **T2.1 — Read the contract first, then design nothing.**
      Read, in this order: `packages/tracking/src/collector/collector.ts` (the whole file — it
      defines exactly what the browser must send: a root object with `writeKey` and `event`, where
      `event` carries `eventName`, `context.page`, `context.session`, `context.technical`,
      `context.attribution`, and `properties`); `packages/tracking/src/envelope/envelope.ts`;
      `packages/tracking/src/envelope/payload.ts`; `apps/collector/src/server.ts` and
      `collector-endpoint.ts`. Note `COLLECTOR_COOKIES` and which cookies the collector _issues_
      versus _reads_ — the SDK must not invent its own session id if the collector already sets one.

- [ ] **T2.2 — Build the browser SDK inside `packages/tracking`.**
      New directory `packages/tracking/src/browser/`. It must: - Build the envelope from the page: URL, path, referrer, title, locale, and the `utm_*`
      parameters and click-ids the existing `packages/tracking/src/envelope/click-ids.ts` already
      knows how to name. **Reuse that module** — do not write a second list of click-id
      parameter names. - Persist first-touch attribution across the visit, using the shape
      `packages/tracking/src/pipeline/enrichment.ts`'s `PersistedAttribution` already defines. - Batch events and flush on a timer, on `visibilitychange`, and via `navigator.sendBeacon`
      on unload. `sendBeacon` has a payload size limit — fall back to `fetch(..., {keepalive:
true})` when a batch exceeds it. - Never throw into the page. A tracking failure must never break a storefront render; wrap
      the whole send path so a rejected fetch is swallowed after a `console.debug`. - Respect consent. `packages/tracking/src/envelope/consent.ts` defines `ConsentSnapshot`
      (exported from the barrel as `ConsentState`). Read it; if the user has not consented to
      analytics, the SDK sends nothing. Default is **do not send** until consent state is known,
      not the reverse. - Export from `packages/tracking/src/index.ts`. Note the barrel's own doc comment (line 15):
      it deliberately exports a narrow surface. Add your exports in the same style, in a clearly
      commented block.
      Unit tests alongside, in the style of `packages/tracking/src/collector/collector.test.ts`.

- [ ] **T2.3 — Wire the SDK into `apps/storefront`.**
      A client component mounted in `apps/storefront/src/app/layout.tsx` that initialises the SDK
      with the write key and the collector URL, both from env. Add both to
      `apps/storefront`'s env handling and to `.env.example` — **note that WP rule 7 in
      [`README.md`](README.md) §4 applies: a tracking write key is public by design (it is resolved
      to a tenant by `WriteKeyResolverPort` and confers no privilege), an API key is not.** Name it
      so that is obvious (`NEXT_PUBLIC_TRACKING_WRITE_KEY`), and confirm against
      `apps/collector/src/write-key-registry.ts` that a write key really is only a tenant selector
      before you expose it.
      `page_viewed` fires on route change — in the App Router this needs a client component using
      `usePathname`, not a one-shot on mount.

- [ ] **T2.4 — Emit the six browser events.**
      One call site each, in the existing pages:
      `products/[slug]/page.tsx` (`product_viewed`, with product ref, price in minor units,
      currency), `cart` actions (`add_to_cart`), `checkout/page.tsx` (`checkout_started`),
      `search/page.tsx` (`search`, with the query and result count), `account/register`
      (`signup`), `account/login` (`login`).
      Money is **minor units, integer** — `packages/tracking/src/envelope/payload.ts` says so and
      `transformation-metadata.ts` documents a real incident where a value was divided by 100
      twice. Do not send floats.
      These are server components; the emit must happen client-side. Use a small client component
      that takes the already-fetched values as props rather than re-fetching, so you do not add a
      round trip to a product page.

- [ ] **T2.5 — Emit `purchase` server-side.**
      The browser copy of a purchase is lost to ad blockers, tab closes and payment redirects.
      Emit it from the runtime instead, on the domain event that means an order was placed.
      `apps/runtime/src/consumers/orders-paid.consumers.ts` already consumes the paid signal —
      read it, and add a tracking emission alongside, publishing to
      `TRACKING_CAPTURED_TOPIC` the same way `apps/collector/src/collector-endpoint.ts` does.
      **The `dedupId` matters.** `packages/tracking/src/runtime/ingest-runtime.ts:20` says:
      _"`dedupId` is the key both the browser and server copies of one occurrence must agree on."_
      Read that file and derive the server-side `dedupId` the way it specifies, so that if you
      later also emit a browser-side purchase the two deduplicate rather than double-count revenue.
      Do **not** also emit a browser-side `purchase` in this WP — one source, server-side, is
      correct and safer.

- [ ] **T2.6 — Make the collector reachable.**
      `apps/collector` is a separate deployable. Confirm it starts, confirm its write-key registry
      resolves the key from T2.3 to the tenant, and record in
      `docs/operations/DEPLOYMENT_GUIDE.md` how it is deployed and what URL the storefront points
      at. If it is not currently deployed anywhere, say so explicitly in that guide rather than
      implying it is.

- [ ] **T2.7 — Prove events arrive.**
      An integration test that drives the storefront (or calls the SDK's send path directly with a
      fake transport) and asserts a well-formed envelope reaches `collect()` and is accepted — not
      refused with any of the `CollectorRefusal` codes. Assert the specific fields the downstream
      consumers need: `eventName`, `context.session.sessionId`, `context.attribution` populated
      from `utm_*`, and minor-unit money on `add_to_cart`.

## Definition of done

- [ ] `grep -rn "@platform/tracking" apps/storefront/src` returns hits.
- [ ] All eight canonical events emit, six from the browser and `purchase` from the server.
- [ ] No storefront page breaks when the collector is unreachable — verify by pointing the
      collector URL at a dead port and loading every storefront route.
- [ ] Nothing is sent before consent is known.
- [ ] G-43 closed in `docs/KNOWN_GAPS.md` and the gap register.
- [ ] Repo-wide gates green, plus `pnpm arch` (you touched `packages/*`).

## Known traps

- **`packages/*` must not import from `apps/*`** (`pnpm arch` enforces it). The browser SDK lives
  in `packages/tracking`; the storefront imports it, never the reverse.
- **The collector already issues the session cookie** (`collector.ts:179-188`). If the SDK also
  generates one, you get two session identities for one visit and the CDP's session-merge logic in
  `services/customer-360` will see a broken graph. Read that code and let the collector own it.
- **Do not send PII in `properties`.** Sprint H.1 stripped PII from `customer.registered`
  deliberately, and `packages/observability`'s log redaction is default-on. An email in a tracking
  property bypasses both. Identity belongs in the identity block, hashed where the pipeline hashes
  it (`packages/tracking/src/pipeline/hashing.ts`).
- **Do not build a second delivery path to Meta/Google/TikTok.** Those destinations already exist
  in `platform-profiles.ts` and are fed by the pipeline. This WP's job ends at the collector.
