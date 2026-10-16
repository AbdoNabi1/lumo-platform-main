# WP-6 — Automation engine v2 + real notification delivery

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely.
> **Depends on:** nothing. **Safe to run in parallel with:** WP-8.
> **Conflicts with:** WP-3, WP-5, WP-7, WP-9, WP-10 (`apps/runtime/src/composition.ts`).
> **Closes:** G-48, G-49. **Unblocks:** WP-9.

## Why this exists

The brief's §16 worked example is:

```
Customer adds product → doesn't purchase → wait 2 hours → send message
→ wait 24 hours → check purchase → if no purchase → send offer
```

That workflow **cannot be expressed** in the current engine, and even if it could, nothing would be
sent.

Verified:

- `services/automation/src/domain/value-objects/trigger-action.ts` — `AutomationTrigger` is
  `{type: "event" | "scheduled", eventType?, cronExpression?}` and `AutomationAction` is
  `{actionType, params}`. That is the entire vocabulary. There is no delay, no condition, no
  branch, no wait-for-event, no goal.
- `services/automation/src/domain/value-objects/workflow-status.ts` — status is
  `draft | active | paused | archived`; the aggregate models the _workflow's_ lifecycle, not a
  _run's_ progress.
- `services/notifications/src/infrastructure/in-memory-port-adapters.ts` — every provider is
  `InMemoryEmailProvider` / `InMemorySmsProvider` / `InMemoryPushProvider` /
  `InMemoryWebhookProvider`. The ports (`EmailProviderPort`, `SmsProviderPort`, `PushProviderPort`,
  `WebhookProviderPort`) are correctly shaped and have no real implementation behind them.

So: a workflow can hold one action, and that action cannot reach a human.

## Design decisions, already made

1. **Runs execute on Temporal.** `packages/temporal` exists (sprint 2.8, ADR-0012) with a
   deterministic saga core and the `PurchaseWorkflow` as precedent. A workflow that waits two hours
   and then twenty-four more, survives a deploy, and must not double-send is precisely what a
   durable execution engine is for. **Do not build a scheduler with `setTimeout`, a polling table,
   or a cron sweep** — read `apps/runtime/src/scheduler.ts` and `packages/temporal` first and follow
   the established pattern.
2. **The workflow definition stays a domain aggregate; the run is Temporal state.** `services/automation`
   owns "what the workflow is" (steps, versioning, activation). Temporal owns "where this run is".
   Do not mirror run state into Postgres as the source of truth; project it for display if needed.
3. **A step graph, not a step list.** A branch has two successors. Model it as nodes with typed
   edges from the start; retro-fitting branching onto an array is the mistake this decision exists
   to prevent.
4. **Notification providers go behind the ports that already exist.** No new port shapes.

## Tasks

- [ ] **T6.1 — Read first.**
      `services/automation/src/` in full (it is ~2,000 lines); `packages/temporal/src/`;
      `apps/runtime/src/scheduler.ts`; `services/notifications/src/` (ports, use cases, the
      in-memory adapters, `ProcessedProviderCallbackStore`); `packages/expression/src/` and
      `packages/rules/src/` — **the condition evaluator you need probably already exists there**;
      check before writing an expression language.

- [ ] **T6.2 — Extend the workflow domain to a step graph.**
      New step kinds, each a value object with its own validation:
      | Step | Carries |
      | --- | --- |
      | `trigger` | event type or cron (the existing `AutomationTrigger`) |
      | `condition` | an expression evaluated against the run context — use `packages/expression` |
      | `delay` | a duration |
      | `wait_for_event` | an event type + a timeout, with a defined timeout branch |
      | `branch` | a condition plus two successor step ids |
      | `action` | the existing `AutomationAction` |
      | `goal` | the outcome that ends the run successfully (e.g. `order.placed`) |
      Validate the graph at definition time, not at run time: no cycles, no unreachable steps, every
      branch edge resolves, exactly one trigger, at least one terminal. A workflow that can be
      activated and then deadlock at 3 a.m. is the failure mode to design out.
      **Version the definition.** A run in flight must keep executing the definition it started on;
      editing a live workflow must not rewrite the behaviour of runs already waiting. Look at how
      `services/licensing`'s `PlanVersion` handles this and follow it.

- [ ] **T6.3 — The Temporal workflow.**
      One Temporal workflow that interprets a definition: waits with Temporal timers (never
      `setTimeout`), evaluates conditions against the run context, and dispatches actions as
      activities.
      Requirements:

      - **Determinism.** Temporal replays workflow code; a `Date.now()`, a random value, or a
                direct I/O call inside workflow code corrupts replay. All of it goes in activities.
                `packages/temporal` already establishes this boundary — read it.
              - **Actions are idempotent activities.** A replay must not send a second email. Key each
                send on `(runId, stepId)`.
              - **Register the worker.** Note G-40 in `docs/KNOWN_GAPS.md`: the purchase saga is _not
                activatable_ today because Temporal worker registration is incomplete. You may hit the
                same wall. If you do, that is a real blocker — record it in `BLOCKERS.md` with what you
                found, and land the definition/validation half (T6.2) so the work is not lost.

- [ ] **T6.4 — Real notification providers.**
      Behind the existing ports, in `services/notifications/src/infrastructure/`:

      - **Email** and **SMS**: pick one provider each, implement the adapter, and record the
                choice in an ADR. Follow `packages/psp-stripe/src/stripe-payment-provider.ts` as the model
                for "real external provider behind a port" — including its `webhook-signature.ts`, because
                delivery-status callbacks must be signature-verified exactly the way payment webhooks are
                (G-5 is open; do not add a second unverified webhook surface).
              - **Webhook**: real outbound HTTP with retry, timeout, and a signed payload.
              - **Push**: leave the stub if you have no provider, and say so explicitly in the composition
                root — do not fake it.
              Config through `packages/secrets` and `apps/runtime/src/config.ts` (**the sole `process.env`
              reader**). Wire in `composition.ts` the way `paymentProvider` is wired: real when configured,
              stub otherwise, **and a boot refusal outside `local` while it is still the stub.**
              Handle provider callbacks idempotently via the existing `ProcessedProviderCallbackStore`.

- [ ] **T6.5 — The abandoned-cart workflow, end to end.**
      Ship the brief's example as a real, seeded, working workflow. It exercises every new step
      kind: an event trigger (`cart.abandoned` — the event already exists, emitted by
      `services/cart`), a delay, a `wait_for_event` on purchase, a branch, two actions, and a goal.
      This is the acceptance test for the whole WP; if it does not run end to end, the WP is not done.

- [ ] **T6.6 — The builder screen.**
      `apps/admin-web/src/app/automations/page.tsx` exists — extend it to create and edit a step
      graph. A form-based step-list-with-branches editor is acceptable and expected; a drag-and-drop
      canvas is not required and is not a good use of this WP's budget.
      Show run history and where a run currently sits. Strings in `en.ts` and `ar.ts`.

- [ ] **T6.7 — Guard rails against sending to everyone.**
      A workflow bug that mails an entire customer base is unrecoverable — you cannot un-send.
      Before activation is allowed, require: a per-run send cap, a per-workflow daily cap, a
      dry-run mode that logs sends without dispatching, and a kill switch that halts a live
      workflow's runs. Also respect consent — `services/identity` owns `ConsentRecord` as an
      append-only derived log; a marketing action must check it and skip non-consenting customers,
      with the skip recorded rather than silent.

## Definition of done

- [ ] The brief's abandoned-cart workflow runs end to end against real infrastructure, and a
      purchase between the two waits correctly ends the run at the goal.
- [ ] A workflow definition with a cycle or an unreachable step is rejected at definition time.
- [ ] Editing a live workflow does not change the behaviour of runs already in flight.
- [ ] A real email and a real SMS are sent through a real provider, with signature-verified
      delivery callbacks.
- [ ] Dry-run, send caps, consent skipping and the kill switch all work, each with a test.
- [ ] Runtime refuses to boot outside `local` with stub providers.
- [ ] G-48 and G-49 closed; ADR for the provider choices written and registered.
- [ ] Repo-wide gates green, plus `pnpm arch`.

## Known traps

- **Non-determinism inside Temporal workflow code.** The most common cause of a workflow that works
  in tests and corrupts on replay in production. Clock, randomness and I/O belong in activities.
- **Do not send from a domain aggregate.** Actions dispatch through `ActionDispatcherPort` — the
  existing doc comment on `AutomationAction` says so explicitly.
- **Do not add a second retry ladder.** `packages/kafka`'s `KafkaConsumerRuntime` already implements
  5s→30s→2m→10m→1h→DLQ. Reuse it.
- **Test with a real clock skip, not a real wait.** Temporal's test framework can advance time;
  a test that actually sleeps two hours will be deleted by whoever hits it next.
