#!/bin/bash
# Sprint 2.2.5 — Redpanda topic bootstrap. Idempotent (rpk create errors on existing topics
# are tolerated). Source of truth for names: docs/architecture/20 §1.1; policies: doc 05 §2.
#
# Conventions:
# - Business topics: `<context>.<aggregate>.<event>.v<version>`, partitioned by aggregate id
#   (producer-side key), 30d retention default (doc 20 §1), 6 partitions locally.
# - Per-topic companions: `<topic>.retry` (consumer redelivery with backoff — replaces the
#   in-process sleep, ADR-0005 note) and `<topic>.dlq` (poison messages; long retention).
# - Financial topics get 7-year-archive semantics in production via tiered storage; locally
#   we approximate with longer retention.
set -u

BROKERS="${REDPANDA_BROKERS:-redpanda:9092}"
DAY_MS=86400000
RET_30D=$((30 * DAY_MS))
RET_13MO=$((395 * DAY_MS))
RET_7Y=$((2555 * DAY_MS))
FAILED=0

# `rpk topic create` exits non-zero both when the topic already exists (idempotent — expected on
# every re-run) AND when creation genuinely failed (e.g. "INVALID_PARTITIONS: ... hardware
# constraints", observed live when the broker's FD ulimit was too low — see the `ulimits` block on
# the `redpanda` service in docker-compose.yml). A bare `&& ... || echo exists` cannot tell those
# apart, so a real failure was being reported as a successful idempotent no-op and the job exited 0
# with critical topics silently missing. Inspect the output instead of just the exit code.
create() { # name partitions retention_ms
  out=$(rpk topic create "$1" --brokers "$BROKERS" -p "$2" -r 1 -c "retention.ms=$3" 2>&1)
  if [ $? -eq 0 ]; then
    echo "created  $1"
  elif echo "$out" | grep -q "TOPIC_ALREADY_EXISTS"; then
    echo "exists   $1"
  else
    echo "FAILED   $1: $out"
    FAILED=1
  fi
}

with_companions() { # name partitions retention_ms
  create "$1" "$2" "$3"
  create "$1.retry" "$2" "$RET_30D"
  create "$1.dlq" 1 "$RET_13MO"
}

# Implemented Phase-1 topics (doc 20 §1.1) ------------------------------------------------
with_companions catalog.product.published.v1        6 "$RET_30D"
with_companions catalog.product.updated.v1          6 "$RET_30D"
with_companions media.asset.ready.v1                6 "$RET_30D"
with_companions pricing.price.changed.v1            6 "$RET_30D"
with_companions inventory.inventory_item.adjusted.v1 6 "$RET_30D"
with_companions cart.cart.checked_out.v1            6 "$RET_30D"
with_companions cart.cart.abandoned.v1              6 "$RET_30D"
with_companions checkout.checkout_session.completed.v1 6 "$RET_30D"
with_companions checkout.checkout_session.failed.v1 6 "$RET_30D"
with_companions orders.order.placed.v1              6 "$RET_7Y"
with_companions orders.order.paid.v1                6 "$RET_7Y"
with_companions orders.order.refunded.v1            6 "$RET_7Y"
with_companions payments.payment_intent.captured.v1 6 "$RET_7Y"
with_companions payments.payment_intent.failed.v1   6 "$RET_7Y"
with_companions payments.payment_intent.refunded.v1 6 "$RET_7Y"
with_companions identity.customer.registered.v1     6 "$RET_13MO"
with_companions identity.customer.consent_changed.v1 6 "$RET_7Y"

# Audit (ADR-0009; producer added with the outbox-backed AuditTrail adapter) ---------------
with_companions platform.audit.entry_recorded.v1    6 "$RET_7Y"

# H-06: the bridge event from the tracking collector to ingest (apps/runtime/src/tracking/
# tracking-ingest.ts) — consumer subscribes with allowAutoTopicCreation=false, so it could never
# start without this topic existing first. Retention per docs/architecture/20-events-catalog.md
# §5 ("tracking.event.captured.v1" row): 13mo.
with_companions tracking.event.captured.v1          6 "$RET_13MO"

# Kafka Connect internal topics (Sprint 3.0B First Boot fix): Debezium requires its config/
# offset/status topics to be `cleanup.policy=compact`. If Connect auto-creates them against a
# broker whose default is `delete` (Redpanda's default), the herder refuses to start with a
# ConfigException. Pre-creating them here with compact removes that boot ordering hazard so
# Connect always finds correctly-configured topics. Compacted (no retention.ms).
compact() { # name partitions
  out=$(rpk topic create "$1" --brokers "$BROKERS" -p "$2" -r 1 -c "cleanup.policy=compact" 2>&1)
  if [ $? -eq 0 ]; then
    echo "created  $1 (compact)"
  elif echo "$out" | grep -q "TOPIC_ALREADY_EXISTS"; then
    echo "exists   $1"
  else
    echo "FAILED   $1: $out"
    FAILED=1
  fi
}
compact _connect.configs 1
compact _connect.offsets 25
compact _connect.status 5

if [ "$FAILED" -ne 0 ]; then
  echo "topic bootstrap FAILED — one or more topics could not be created (see FAILED lines above)"
  exit 1
fi
echo "topic bootstrap complete"
