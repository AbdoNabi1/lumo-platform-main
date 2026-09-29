#!/bin/bash
# Sprint 2.2.5 — Redpanda topic bootstrap for the COMPOSE stack. Idempotent (rpk create errors on
# existing topics are tolerated).
#
# Topic NAMES and RETENTION are not written here any more (G-80, 2026-09-29). They come from
# `topics.manifest` beside this script, which is GENERATED from the one inventory in
# `apps/runtime/src/kafka-topics/topic-inventory.ts`:
#
#     pnpm --filter @platform/runtime run topics:manifest
#
# `apps/runtime/src/kafka-topics/topic-inventory.test.ts` fails when the committed manifest drifts
# from the inventory. Hand-written topic lines drifted before: this script once provisioned 26 of the
# 397 event types the platform produces, and the in-process outbox relay stalls permanently at the
# first row whose topic does not exist. Deployments that are not compose (Railway) use
# `apps/runtime/src/provision-topics.ts`, which reads the same inventory.
#
# Conventions:
# - Business topics: `<context>.<aggregate>.<event>.v<version>`, partitioned by aggregate id
#   (producer-side key). A topic the worker CONSUMES, and its .retry, gets 6 partitions locally
#   (override with TOPIC_PARTITIONS); every other topic gets 1. Redpanda reserves ~4 MiB per
#   partition, so ~400 topics x 6 would not fit the broker's memory.
# - Only topics the worker CONSUMES get `<topic>.retry` (redelivery with backoff, ADR-0005) and
#   `<topic>.dlq` (poison messages, 1 partition). A companion nothing consumes does nothing.
# - Financial topics get 7-year-archive semantics in production via tiered storage; locally
#   we approximate with longer retention.
set -u

BROKERS="${REDPANDA_BROKERS:-redpanda:9092}"
PARTITIONS="${TOPIC_PARTITIONS:-6}"
MANIFEST="${TOPICS_MANIFEST:-/bootstrap/topics.manifest}"
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

if [ ! -r "$MANIFEST" ]; then
  echo "FAILED   topic manifest not readable at $MANIFEST (mount infrastructure/docker/redpanda/topics.manifest)"
  exit 1
fi

COUNT=0
while read -r name kind retention partitioning; do
  case "$name" in "" | "#"*) continue ;; esac
  # A Windows checkout (core.autocrlf, no .gitattributes) ends each line in \r; strip it, or the
  # last field reads "full\r" and a consumed topic silently gets one partition.
  partitioning="${partitioning%$'\r'}"
  # `full`: a consumed topic and its .retry. `single`: produced-only topics and every .dlq.
  if [ "$partitioning" = "full" ]; then
    create "$name" "$PARTITIONS" "$retention"
  else
    create "$name" 1 "$retention"
  fi
  COUNT=$((COUNT + 1))
done < "$MANIFEST"
echo "manifest topics processed: $COUNT"

# Kafka Connect internal topics (Sprint 3.0B First Boot fix): Debezium requires its config/
# offset/status topics to be `cleanup.policy=compact`. If Connect auto-creates them against a
# broker whose default is `delete` (Redpanda's default), the herder refuses to start with a
# ConfigException. Pre-creating them here with compact removes that boot ordering hazard so
# Connect always finds correctly-configured topics. Compacted (no retention.ms). Compose-only:
# these belong to Kafka Connect, not to the platform, so they are not in the topic inventory.
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
