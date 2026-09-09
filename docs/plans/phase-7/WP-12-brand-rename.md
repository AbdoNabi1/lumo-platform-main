# WP-12 — Rename Lumo to Morbeh

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely, plus
> [`../UNIFIED-ROADMAP.md`](../UNIFIED-ROADMAP.md) §5 for why this runs early.
> **Depends on:** `WP-0` (so the rename lands on corrected status docs, not on the stale claims
> `WP-0` is fixing). **Run before most other WPs**, not after — every WP that adds a screen touches
> `apps/admin-web/src/messages/{en,ar}.ts`, and this WP touches the brand string those files
> already carry. The later it runs, the more surrounding copy has grown around "Lumo" in the
> meantime.
> **Closes:** Morbeh F-20 (Lumo naming across ~167 source files and infrastructure identifiers).

## Why this exists

The platform is operated and sold as Morbeh; the codebase still says Lumo in user-visible copy,
design-system documentation, and infrastructure identifiers. This is pure rename — no behaviour
changes, and three tiers run in strict order because they carry very different risk.

## Decisions, already made — do not re-open

- **Package names stay `@platform/*`.** They already carry no Lumo branding. Renaming 37 packages
  to `@morbeh/*` touches every import in the repository and buys nothing while packages are
  private. Revisit only if they are ever published externally. **Do not touch package names in
  this WP.**
- **The design system keeps its structure and its token values, changes its name.** Rename
  identifiers — the doc file, doc comments, the `brand` string, the mark component's description.
  Keep the token architecture and every existing value, including the `#635BFF` primary ramp. A new
  visual identity is a separate, additive workstream, out of scope here. **If you find yourself
  editing a hex value or a spacing/typography token, stop — that is out of scope.**

## Tasks

### Tier 1 — User-visible copy (do this first, its own commit)

- [x] **T12.1 — Rename the brand in the admin-web dictionaries.**
      `apps/admin-web/src/messages/en.ts`: the `brand: "Lumo"` entry, the copyright line, and any
      operator-surface copy that names the platform. Then `apps/admin-web/src/messages/ar.ts`,
      which must satisfy the same `Dictionary` shape (`en.ts` is the source of truth the type is
      inferred from — a key present in one and not the other is a type error, per
      `../README.md` rule 5).

- [x] **T12.2 — The brand mark component.**
      `apps/admin-web/src/components/brand-mark.tsx` — update its doc comment only. Keep the drawn
      eight-point mark exactly as-is; only its description changes.

- [x] **T12.3 — Every other user-visible surface.**
      Storefront and admin-web layout, login, error, and not-found pages; seed and demo data in
      `apps/runtime/src/seed.ts` and `seed-demo.ts`; e2e fixtures under
      `apps/e2e/tests/support/`. Grep for `Lumo` (case-sensitive and case-insensitive) across
      `apps/*/src` after finishing and confirm no user-facing string remains.

**Tier 1 done when:** no user-visible string reads "Lumo", `pnpm --filter admin-web run test` and
`pnpm --filter storefront run test` pass, and the e2e suite passes against local infra.

### Tier 2 — Design system identifiers (its own commit, after Tier 1)

- [x] **T12.4 — Rename the design-system document and its references.**
      `docs/ui/LUMO_DESIGN_SYSTEM.md` → `docs/ui/MORBEH_DESIGN_SYSTEM.md`, and every reference to
      it (search the whole repo, not just `docs/`, for the old filename and the old title string).

- [x] **T12.5 — Doc comments in the design and UI packages.**
      `packages/design/src/{index,primitives,semantic}.ts` and the `packages/ui` components. Per
      the decision above: token names and values are unchanged.

**Tier 2 done when:** the design docs and comments say Morbeh, and `git diff` for this commit shows
no changed token value — review the diff yourself for exactly this before committing.

### Tier 3 — Infrastructure identifiers (its own commit — has deployment consequences)

- [x] **T12.6 — Kubernetes and compose identifiers.**
      Namespace in `infrastructure/k8s/00-namespace.yaml` and every manifest referencing it, plus
      `kustomization.yaml`. Docker compose service and container names. Grafana dashboard uids and
      titles. Prometheus job names and alert rule labels. The Kratos identity schema id.

- [x] **T12.7 — Leave two items deferred, explicitly, as their own tickets.** - **The Debezium connector name in `outbox-connector.json`.** Renaming it creates a new
      connector with new replication-slot state, which can re-emit or skip events. `WP-11`
      (financial integrity) is the workstream proving the CDC path in staging — do not rename
      this connector until that proof exists and a human has explicitly approved the rename. Note
      it in this task's commit message and move on. - **Database name, user, and connection strings in `.env.example`**, which currently read
      `lumo`. Changing them requires a data migration, which is out of scope for a naming task.
      Note it and move on.

**Tier 3 done when:** staging is redeployed under the new namespace, all pods healthy, dashboards
resolving, and the two deferred items above are written up as their own tickets (in
`docs/plans/BLOCKERS.md` or wherever this repository tracks tickets — check `docs/plans/BLOCKERS.md`
first, it is already the convention this repository uses for exactly this kind of "found, deferred,
here is why" entry).

## Definition of done

- [x] No occurrence of "lumo" (any case) outside `.git` history, archived phase reports
      (`PHASE_A*.md` at repo root — these are historical records, not live docs, leave them), and
      the two explicitly deferred infrastructure items from T12.7. Also treated `docs/archive/**` as
      covered by the same "historical records" exclusion (it holds the same genre of closed report,
      just filed under a different path — see `docs/plans/BLOCKERS.md`'s "T12" entry for the
      reasoning), and left `docs/plans/**` (this WP brief, the other WP briefs, `UNIFIED-ROADMAP.md`,
      `.progress/` task history) untouched — those documents discuss "Lumo" and "Morbeh" as the two
      named terms of the rename itself; substituting one for the other inside them inverts their
      meaning rather than rebranding live product surface. Verified via a repo-wide case-insensitive
      grep after the fact — every remaining hit resolves to one of these categories.
- [x] Repo-wide gates green per `../UNIFIED-ROADMAP.md` §3. (Staging redeploy/health-check itself is
      outside what this session can execute — no live cluster access; the k8s/compose/Grafana/
      Prometheus/Kratos identifier renames are verified by content/consistency review and the gates
      below, not by an actual redeploy. Recorded as a limitation, not silently skipped.)
- [ ] Three separate commits (or three separate PRs), matching the three tiers — never mix a rename
      tier with another tier's changes, and never mix any tier with a behaviour change. **Not done
      this session — explicitly instructed not to commit.** All three tiers' file changes are present
      in the working tree, uncommitted; splitting them into three commits is left to whoever commits
      this work.

## Known traps

- **This is the WP most likely to collide with everyone else's work-in-progress**, because Tier 1
  touches the same two message dictionaries every screen-adding WP touches. Running it early (right
  after `WP-0`, per `../UNIFIED-ROADMAP.md` §5) is not a suggestion — it is how the collision surface
  stays small. If other WPs are already mid-flight when this lands, expect merge conflicts in
  `en.ts`/`ar.ts` and resolve them by keeping both sides' new keys with the renamed brand string.
- **`grep -ri lumo` will also match unrelated words and other people's names inside comments
  referencing incidents.** Read each hit; do not blind-replace.
- **Do not batch Tier 3 with Tier 1 or Tier 2.** `../README.md` rule 2 ("never mix a rename into a
  behaviour change") and this WP's own risk profile both apply — Tier 3 is the one with real
  deployment consequences if something is missed.
