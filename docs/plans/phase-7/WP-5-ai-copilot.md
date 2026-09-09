# WP-5 — The AI layer, phase 1: a read-only Copilot with tool calling

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely.
> **Then invoke the `claude-api` skill** before writing a single line of Anthropic SDK code. It is
> bundled in this environment and it is authoritative over anything you remember about the API —
> several common shapes changed in 2025–2026 and a stale prior will produce code that 400s.
> **Depends on:** WP-3 (the Copilot's best answers come from the semantic layer over ClickHouse; it
> is buildable before WP-3 over the Postgres read models, with a narrower tool set).
> **Conflicts with:** WP-3, WP-6, WP-7, WP-9, WP-10 (`apps/runtime/src/composition.ts`) and WP-4,
> WP-6, WP-8, WP-9 (`apps/admin/src/http/admin-routes.ts`).
> **Closes:** G-45.

## Why this exists

Brief sections 28–38 describe the product's differentiator: an intelligence layer over the whole
platform, not a chatbot bolted onto it. Today it is entirely absent — search the repo for
`copilot`, `@anthropic-ai`, `openai` across every `src` directory and you get one hit, in an
unrelated security test.

**But the hard part is already built.** `services/security` contains a complete AI governance
domain — the §38 permission architecture, implemented and screened:

`services/security/src/domain/ai-governance-profile.ts`

- `AiGovernanceProfile` aggregate: per-principal `tokenBudget`, `callQuota`, `windowSeconds`
  (rolling window), `allowedTools` (sandboxing), `allowedResources` (isolation),
  `isolationLevel` (`none` | `sandboxed` | `isolated`), status `active` | `suspended`.
- `permitsTool(tool)`, `permitsResource(resource)`, `consume(tokens, calls, now, eventId)`.
- Over-budget emits `security.ai_identity.budget_exceeded` as a **recorded fact**, never a silent drop.

`services/security/src/application/ai-governance.use-cases.ts`

- `CheckAiAction` — _"checks sandboxing (allowed tool), isolation (allowed resource) and
  budget/quota in one call, recording consumption when allowed… every check is WORM-audited."_
  Input: `{principalExternalId, tool?, resource?, tokens?, calls?}`.
  Output: `{allowed, reason?, remainingTokens, remainingCalls}`.
- `GovernAiIdentity` (create-or-patch), `SuspendAiIdentity` (kill switch).

Routes: `apps/admin/src/http/security-ai-governance-routes.ts` —
`/security/ai-identities/:externalId`, `/suspend`, `/actions/check`.
Screen: `apps/admin-web/src/app/security/ai-governance/page.tsx`, with a live check panel.

**Read all four files before you design anything.** Your job is to build the Copilot _into_ this
gate. Do not build a second permission system, a second audit trail, or a second budget counter.

## Scope of phase 1 — read-only, and that is deliberate

The Copilot answers questions about the merchant's own data. It **cannot mutate anything**. No
promotions created, no prices changed, no campaigns launched. Brief §37's write flow (propose →
confirm → execute) is phase 2 and needs its own design round; shipping reads first means the tool
gate, the audit trail, the budget accounting and the UI are all proven under low blast radius
before anything can change a row.

If you find yourself adding a tool whose name is a verb that changes state, stop — that is out of
scope for this WP.

## The Anthropic API contract — get this from the skill, not from memory

Invoke `claude-api` and read `typescript/claude-api/README.md` and
`typescript/claude-api/tool-use.md`. The points that will bite you if you skip it:

- **Model: `claude-opus-5`.** Exact string, no date suffix.
- **Thinking:** `thinking: { type: "adaptive" }`. `budget_tokens` is **removed** on Opus 5 and
  returns a 400. On Opus 5 thinking is on by default.
- **Effort:** `output_config: { effort: "low" | "medium" | "high" | "xhigh" | "max" }` — nested in
  `output_config`, not top-level. Default `high`.
- **Stream everything.** A Copilot answer with tool calls is long-running; non-streaming requests
  hit HTTP timeouts. Use `client.messages.stream(...)` and `.finalMessage()` when you need the
  whole message.
- **No assistant prefill.** It returns a 400 on Opus 5. Use `output_config.format` or system-prompt
  instructions to shape output.
- **Use the SDK's own types** (`Anthropic.MessageParam`, `Anthropic.Tool`, `Anthropic.Message`,
  `Anthropic.ToolUseBlock`) — do not define parallel interfaces.
- **Parse tool inputs with `JSON.parse`,** never string-match the serialized input; escaping varies.
- **Typed errors:** catch `Anthropic.RateLimitError` → `Anthropic.APIError` most-specific-first.
  Never string-match error messages.
- **Parallel tool use is on by default.** One assistant message can hold several `tool_use` blocks;
  return **all** their `tool_result` blocks in a **single** user message, including failures with
  `is_error: true`. Splitting them teaches the model to stop parallelising.

## Tasks

- [ ] **T5.1 — Read the ground truth first.**
      The four AI-governance files listed above; `packages/entitlement/src/index.ts` (the
      `EntitlementGuard` — the runtime PEP that already gates "every protected command/API/admin
      action/job/**AI request**", its own words); `packages/contracts`' `AuditTrail` port;
      `services/analytics/src/domain/ports.ts` and the `engine/` directory (the semantic query the
      Copilot's best tool will wrap); `apps/admin/src/interfaces/*.admin-controller.ts` (the
      `AdminGuard` wrapper pattern every read must go through).

- [ ] **T5.2 — `packages/ai`: the provider seam.**
      A new package holding a narrow port and one adapter. The port is the platform's abstraction —
      `complete`/`stream` over messages and tool definitions, returning content blocks and a usage
      record. The adapter wraps `@anthropic-ai/sdk`.
      Constraints, all load-bearing:

      - **No business logic and no context imports.** `pnpm arch` forbids `packages/*` importing
                `apps/*`; keep it also free of `services/*`. It knows about messages and tools, nothing
                else.
              - **The port must surface token usage** — `input_tokens`, `output_tokens`,
                `cache_read_input_tokens`, `cache_creation_input_tokens`. T5.6 cannot enforce a budget
                without them.
              - Register the package in `.dependency-cruiser.cjs`'s layer rules the way `@platform/kafka`
                was added in sprint 2.5 — read how that was done and copy it.
              - The API key is read through `packages/secrets`, never `process.env` outside
                `apps/runtime/src/config.ts`.

- [ ] **T5.3 — The tool registry.**
      Every Copilot tool is a thin wrapper over an **existing read use case**. Do not add a new
      query path, and never let a tool touch a repository directly.
      Phase-1 tool set — each maps to a controller that already exists:

      | Tool | Wraps | Answers |
              | --- | --- | --- |
              | `query_metrics` | `services/analytics` semantic query | "revenue yesterday", "conversion rate this week" |
              | `list_orders` | Orders read use cases | "how many orders are stuck in processing" |
              | `get_product_performance` | Catalog + Analytics | "which products have views but no sales" |
              | `get_customer_segment` | `services/customer-360` segment reads | "who are my highest-LTV customers" |
              | `get_inventory_status` | Inventory reads | "what is about to go out of stock" |
              | `list_experiments` | Experimentation reads | "which tests are running" |
              | `get_finance_statement` | `services/finance` statements | "what was gross margin last month" |

              Requirements:

              - **`strict: true`** on every tool definition, with `additionalProperties: false` and an
                explicit `required` list, so arguments are schema-valid by construction.
              - **Tool names are the sandbox keys.** `AiGovernanceProfile.allowedTools` is a list of
                strings; these names are those strings. Choose them once and treat them as a public
                contract — renaming one silently widens or breaks a merchant's sandbox.
              - **Every tool is tenant-scoped from the principal, never from a model-supplied argument.**
                A tool that accepts `tenantId` in its input schema is a cross-tenant data leak with an LLM
                holding the key. The tenant comes from the request principal, full stop.
              - Descriptions are written for the model: say what the tool returns, its units (minor units
                for money), and its time semantics.

- [ ] **T5.4 — The agent loop with a permission gate on every call.**
      Use the SDK's beta Tool Runner (`client.beta.messages.toolRunner` with `betaZodTool` from
      `@anthropic-ai/sdk/helpers/beta/zod`) — its per-turn hooks are exactly the approval-gate seam
      this needs. Read `typescript/claude-api/tool-use.md` for the current shape. A hand-written
      `while (stop_reason === "tool_use")` loop is acceptable if the hooks do not fit; the gate
      below is not optional either way.

      **Before each tool executes**, call `CheckAiAction` with the acting principal, the tool name,
              the resource being touched, `calls: 1`, and the tokens consumed so far this turn. If
              `allowed === false`, do **not** execute; return a `tool_result` with `is_error: true` whose
              content is the decision's `reason`, and let the model explain the refusal to the user. A
              denial is a normal outcome, not an exception — `CheckAiAction` already records it and emits
              `budget_exceeded`.

              Also pass every tool call through the guards a human admin action passes through:
              `EntitlementGuard` (is this tenant entitled to the Copilot at all?) and the read's own
              `AdminGuard` (may this principal read this?). **The AI's authority is the acting user's
              authority, never more.** A Copilot that can read what its operator cannot is a privilege
              escalation with a natural-language interface.

- [ ] **T5.5 — Prompt construction and caching.**
      The system prompt carries: what Morbeh is, what the merchant's store is, the tenant's currency
      and timezone, today's date, and the rule that the assistant answers **only** from tool
      results and says so plainly when a tool returns nothing.
      Caching is a **prefix match** rendered `tools` → `system` → `messages`, so: - Keep the stable half of the system prompt first and put the volatile half (today's date,
      the request id) after the last `cache_control` breakpoint. A `new Date()` in the cached
      prefix silently destroys the hit rate. - The tool list must serialise **deterministically** — a `Object.keys()` iteration order that
      varies between processes invalidates the cache on every request. - Verify with `usage.cache_read_input_tokens`. If it is zero across repeated turns, you have
      an invalidator; read `shared/prompt-caching.md` from the skill.

- [ ] **T5.6 — Token accounting that feeds the budget.**
      After each model response, take `usage` from the SDK and report the real consumption to
      `CheckAiAction` (or the profile's `consume`) so `tokenBudget` reflects what was actually
      spent, not an estimate. Cached reads cost roughly a tenth of fresh input — decide explicitly
      whether the budget counts them at full or reduced weight, and **write the decision into the
      code as a comment**, because it is the kind of thing that is silently wrong for a year.
      Emit metrics through the existing `RuntimeMetrics` registry in
      `apps/runtime/src/metrics.ts` (one process-wide instance — read its doc comment): tokens in,
      tokens out, tool calls, denials, latency.

- [ ] **T5.7 — Transport.**
      `POST /ai/copilot/messages` in a new `apps/admin/src/http/ai-copilot-routes.ts`, registered
      in `admin-routes.ts`, following the `defineRoute` shape of a neighbouring route file exactly
      (`wishlist-routes.ts` is the smallest complete example). It **streams** — check how the
      Fastify binding in `packages/http` handles a streaming response before assuming it can; if
      it cannot, that is a real finding for `BLOCKERS.md`, and a non-streaming first cut with a
      `max_tokens` low enough to avoid timeouts is the correct fallback, not a parallel HTTP stack.
      Gate the whole route behind a feature flag (`packages/feature-flags`), off by default.

- [ ] **T5.8 — The chat surface.**
      A Copilot panel in `apps/admin-web`, reachable from the app shell. Requirements:

      - **Server-side only** for the API call. `apps/admin-web` never calls the runtime API from
                browser JS — no CORS, and the token must not reach the client. That constraint is in
                `docs/plans/README.md` and it applies here too. Stream through a Next.js route handler.
              - Render tool calls visibly: which tool ran, what it returned. A Copilot that shows its
                working is auditable by the operator; one that does not is a black box making claims about
                their revenue.
              - Render a denial as a denial, with the reason.
              - Strings in **both** `apps/admin-web/src/messages/en.ts` and `ar.ts`.
              - `ROUTE_ROLE_REQUIREMENTS` entry, like every other admin route.

- [ ] **T5.9 — Tests.**

      - Unit: every tool wrapper, with a stubbed provider port. No test may make a real API call.
              - **Gate tests, and treat these as the important ones:** a tool not in `allowedTools` is
                refused; an over-budget call is refused and emits `budget_exceeded`; a suspended profile
                refuses everything; a tool call for tenant B from tenant A's principal is impossible.
              - A replay test asserting a denial is audited.
              - An adapter test against a recorded response shape — not the live API.

- [ ] **T5.10 — Write the ADR.**
      A new ADR in `docs/architecture/`, following the existing numbering and format, recording:
      read-only scope for phase 1 and why; the provider-port seam; the decision to reuse
      `AiGovernanceProfile` rather than build a new permission model; the token-accounting weight
      decision from T5.6; and what phase 2 (AI actions) would need. Register it in
      `docs/DECISIONS.md`.

## Definition of done

- [ ] An operator asks "why did revenue drop yesterday?" in the admin and gets an answer grounded
      in tool results, with the tool calls visible.
- [ ] Every tool call is checked by `CheckAiAction` before it executes, and refusals are surfaced.
- [ ] Token spend decrements the real budget; exhausting it stops the Copilot and records the fact.
- [ ] The Copilot can read nothing the acting operator cannot read. Prove it with a test.
- [ ] Nothing the Copilot can call mutates state.
- [ ] `usage.cache_read_input_tokens` is non-zero on the second turn of a conversation.
- [ ] Feature flag off by default; the platform behaves identically with it off.
- [ ] G-45 closed; ADR written and registered.
- [ ] Repo-wide gates green, plus `pnpm arch`.

## Known traps

- **Do not let the model choose the tenant.** Every tool input schema that contains a tenant, store,
  or organisation identifier is a bug. The principal decides.
- **Do not bypass `AdminGuard` "because the AI already checked".** `CheckAiAction` governs the _AI
  identity's_ budget and sandbox. `AdminGuard` governs whether _this principal_ may read _this
  resource_. They answer different questions and you need both.
- **Do not put merchant data in the system prompt.** It is cached, shared across turns, and the
  place where cross-tenant leakage would be least visible. Data arrives through tool results.
- **Do not invent metrics.** If `query_metrics` returns nothing because WP-3 has not landed, the
  Copilot must say the data is unavailable. An LLM that fills the gap with a plausible number is
  strictly worse than an error — and rule 4 in `docs/plans/README.md` ("never fabricate data")
  applies to generated text exactly as it applies to a React component.
- **`allowedTools` defaults matter.** A profile created with no `allowedTools` — check what
  `AiGovernanceProfile.govern` does with an absent list before you rely on it — decides whether a
  new AI identity starts sandboxed or wide open. Fail closed.
