# 02 — Product Layout Builder specification

> **Status: CONTRACT (Phase 1 — Growth) — 2026-06-28.** Product specification for a no-code product
> page builder (Shopify Theme-Editor class). Builds on the shared block kit
> (`packages/page-builder-kit`, [arch 02](../architecture/02-monorepo-packages-and-feature-first.md)),
> the content context ([arch 03](../architecture/03-domain-and-database-boundaries.md)), the CRO
> engine ([growth 01](01-CRO_ENGINE_SPEC.md)), and the tracking spec
> ([arch 16](../architecture/16-tracking-specification.md)). No application code; the data model
> below is **logical**, not DDL.
>
> **Design system note:** the existing frozen admin already has a **Page builder** screen
> ([`../ui/`](../ui/README.md)). This document specifies the _product-page_ capability that the page
> builder configures; it does **not** redesign the page-builder UI. The **builder UI** (admin) stays
> frozen — any new editor control requires approval. The **product page output** is rendered on the
> storefront (not frozen) and is fully configurable as described here.

## 1. Cross-cutting compliance baseline

| Concern         | Requirement                                                                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tracking        | Interactive blocks emit standardized events ([arch 16](../architecture/16-tracking-specification.md)); experiment-controlled blocks emit `experiment_exposed`                                                                      |
| Analytics       | Block/layout performance (views, CTR, ATC, conversion) queryable in ClickHouse                                                                                                                                                     |
| Audit logs      | Every layout/template/version change → `audit.entry.recorded` (WORM)                                                                                                                                                               |
| Permissions     | Edit / publish / template-admin separated ([arch 07](../architecture/07-auth-and-authorization.md))                                                                                                                                |
| Feature flags   | Layouts publishable behind a flag; experiment-driven layouts via the CRO engine                                                                                                                                                    |
| Dark mode       | Builder UI uses frozen tokens ([`../ui/MORBEH_DESIGN_SYSTEM.md`](../ui/MORBEH_DESIGN_SYSTEM.md)); storefront output themed per the storefront design system                                                                        |
| Responsive      | Per-device layout config (§4); the **admin builder** follows [`../ui/MORBEH_DESIGN_SYSTEM.md`](../ui/MORBEH_DESIGN_SYSTEM.md) §11, the **storefront output** has its own desktop/tablet/mobile breakpoints (configured per layout) |
| Localization    | Block content is i18n-keyed; per-locale overrides; RTL-aware                                                                                                                                                                       |
| Accessibility   | Rendered output is WCAG 2.2 AA (semantic order independent of visual order, focus order, alt text, reduced-motion); the builder warns on a11y violations                                                                           |
| Version history | Every layout has immutable versions with preview + rollback (§7)                                                                                                                                                                   |

## 2. Concepts

| Concept         | Definition                                                                           |
| --------------- | ------------------------------------------------------------------------------------ |
| Layout template | A reusable product-page composition (ordered sections + blocks + settings)           |
| Layout          | A concrete product page = a template (optionally) + product-specific overrides       |
| Section         | A horizontal region that holds blocks; carries layout/responsive/visibility settings |
| Block           | A unit of content/function inside a section (§5)                                     |
| Assignment      | Which products use which template (by product, category, collection, or rule)        |
| Version         | An immutable snapshot of a layout/template (draft or published)                      |

Reusable **templates** are first-class: create once, assign to many products by rule; a product may override specific sections/blocks while inheriting the rest. Template edits propagate to inheritors unless overridden.

## 3. Section capabilities

Every section supports:

| Capability                       | Behavior                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| Show / hide                      | Toggle render without deleting                                                      |
| Drag & drop                      | Reorder sections and blocks                                                         |
| Duplicate                        | Clone a section/block with its settings                                             |
| Delete                           | Remove (kept in version history)                                                    |
| Resize                           | Width/columns within the grid                                                       |
| Move                             | Reposition within/between sections                                                  |
| Lock                             | Prevent edits (e.g. on inherited template sections)                                 |
| Desktop / tablet / mobile layout | Independent arrangement + visibility per breakpoint (§4)                            |
| Visibility rules                 | Conditional render by audience/segment/experiment/device/locale/inventory/date (§6) |
| Scheduling                       | Start/end datetime (locale/timezone-aware) for time-boxed sections                  |
| Version history                  | Per-change versioning                                                               |
| Preview                          | Live preview per device + as-audience preview                                       |
| Rollback                         | Restore any prior version                                                           |

## 4. Responsive model

- Each section/block stores settings per breakpoint: **desktop**, **tablet**, **mobile** — including order, visibility, columns/width, spacing, and which blocks appear.
- Mobile is a first-class layout, not a shrink of desktop (e.g. sticky ATC shows on mobile, gallery becomes a swipe carousel).
- The storefront breakpoints are a builder/theme concern and are **distinct** from the frozen admin's single 560px breakpoint ([`../ui/RESPONSIVE_RULES.md`](../ui/RESPONSIVE_RULES.md)), which governs the operator tool, not the storefront output.

## 5. Block model and styling

Every block supports a common settings schema:

| Group            | Settings                                                               |
| ---------------- | ---------------------------------------------------------------------- |
| Typography       | font family/size/weight/line-height/letter-spacing (from theme tokens) |
| Spacing          | gap between child elements                                             |
| Padding / Margin | per-side, per-breakpoint                                               |
| Background       | color / image / video / none                                           |
| Border           | width / style / color                                                  |
| Radius           | corner radius                                                          |
| Animation        | entrance/scroll animation, respecting reduced-motion                   |
| Icons            | optional icon (Tabler set, consistent with the design system)          |
| Colors           | text/accent from theme tokens (no off-token values)                    |
| Conditions       | visibility rules (§6)                                                  |
| Dynamic content  | bind fields to product/variant/inventory/pricing/customer context      |

### Block catalog

| Block                | Purpose                                                                             | Data source             | Dynamic | Tracking events                               |
| -------------------- | ----------------------------------------------------------------------------------- | ----------------------- | ------- | --------------------------------------------- |
| Gallery              | Product images/video                                                                | Catalog media           | yes     | `product_viewed` (context)                    |
| Title                | Product name                                                                        | Catalog                 | yes     | —                                             |
| Price                | Price / compare-at / sale                                                           | Pricing read model      | yes     | —                                             |
| Variants             | Variant selector                                                                    | Catalog variants        | yes     | `product_variant_selected`                    |
| Quantity             | Qty selector                                                                        | —                       | —       | `cart_quantity_updated`                       |
| Buy button           | Add to cart / buy now                                                               | Cart                    | yes     | `product_added_to_cart`                       |
| Sticky add-to-cart   | Persistent ATC (CRO)                                                                | Cart                    | yes     | `product_added_to_cart`, `experiment_exposed` |
| Countdown            | Offer urgency (CRO)                                                                 | Offer validity          | yes     | `offer_viewed`                                |
| Stock indicator      | Availability / "N left"                                                             | Inventory read model    | yes     | —                                             |
| Delivery information | ETA / shipping by zone                                                              | Shipping/pricing        | yes     | —                                             |
| Reviews              | Ratings + reviews                                                                   | Reviews context         | yes     | —                                             |
| FAQ                  | Q&A accordion                                                                       | CMS / product           | yes     | —                                             |
| Videos               | Embedded/hosted video                                                               | Media                   | yes     | —                                             |
| Bundles              | Curated set (CRO)                                                                   | Catalog bundles         | yes     | `offer_viewed`, `product_added_to_cart`       |
| Upsells              | Upsell offers (CRO)                                                                 | Catalog relations       | yes     | `offer_viewed`, `offer_claimed`               |
| Cross-sells          | Complementary (CRO)                                                                 | Catalog relations       | yes     | `offer_viewed`, `product_list_clicked`        |
| Recently viewed      | Re-engagement                                                                       | Social recently_viewed  | yes     | `product_list_clicked`                        |
| Recommendations      | AI recs                                                                             | Recommendations service | yes     | `product_list_clicked`, `product_viewed`      |
| Trust badges         | Safety certs / guarantees (CRO)                                                     | Catalog safety certs    | yes     | `experiment_exposed`                          |
| Custom HTML          | Arbitrary sanitized markup                                                          | author input            | limited | —                                             |
| Custom components    | Registered plugin blocks ([arch 11](../architecture/11-integration-and-plugins.md)) | plugin                  | yes     | per plugin                                    |

CRO-flavored blocks (sticky ATC, countdown, bundles, upsells, cross-sells, recently viewed, recommendations, trust badges) are the storefront surface of [growth 01 — CRO engine](01-CRO_ENGINE_SPEC.md); their visibility/variant can be experiment- or audience-controlled. Custom HTML is sanitized; custom components must be registered plugins with declared scopes.

## 6. Visibility rules, scheduling, conditions

- **Visibility rules** evaluate at render: audience/segment, lifecycle stage, device, locale, traffic source/UTM, inventory state, customer auth state, A/B variant.
- **Scheduling**: sections/blocks can be time-boxed (e.g. holiday banner) with locale/timezone-aware windows.
- **Experiment binding**: a section/block carries an optional `experiment_handle`; the CRO engine resolves the variant at render and logs exposure.

## 7. Versioning, draft, preview, publish, rollback

- **Draft → published** workflow; only published versions render to shoppers.
- Every save creates an immutable **version**; **preview** renders any version per device and "as an audience".
- **Publish** can be immediate, scheduled, or flag-gated (gradual via the CRO engine).
- **Rollback** restores any prior version instantly; rollbacks are themselves versioned + audited.

## 8. Logical data model (not DDL)

Lives in the content context ([arch 03](../architecture/03-domain-and-database-boundaries.md)); cross-context references by id only.

| Entity              | Key attributes                                                                              | Relationships                                               |
| ------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `layout_template`   | id, name, status, sections[], settings                                                      | has many `layout_section`; assigned via `layout_assignment` |
| `layout`            | id, product_id (ref), template_id?, overrides                                               | belongs to a product; based on a template                   |
| `layout_section`    | id, type, position, responsive settings, visibility rules, schedule, lock                   | has many `block_instance`                                   |
| `block_instance`    | id, block_type, settings (styling §5), dynamic bindings, `experiment_handle?`               | belongs to a section                                        |
| `layout_version`    | id, layout/template ref, version_no, snapshot, status (draft/published), author, created_at | immutable snapshot                                          |
| `layout_assignment` | id, template_id, target (product/category/collection/rule), priority                        | resolves which products use a template                      |

## 9. Frozen-UI surface mapping

- The builder is the existing **Page builder** admin screen; this spec extends _what it can configure_ (product-page sections/blocks), not its visual design.
- The storefront product page is the rendered output (storefront, not frozen).
- Any net-new editor control, panel, or admin screen requires approval per [`../ui/`](../ui/README.md).

## Requires ADR to change

- The template/layout/section/block model, the reusable-template inheritance rule, or the per-breakpoint (desktop/tablet/mobile) responsive model.
- The draft→version→publish→rollback workflow or the "storefront output configurable, admin builder UI frozen" boundary.
- Adding a block type that bypasses the common settings schema or the plugin-registration requirement for custom components.
