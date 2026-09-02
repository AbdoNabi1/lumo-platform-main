#!/bin/bash
# Registers (or updates) the outbox CDC connector. Run AFTER:
#   1. the stack is healthy (`docker compose ps`),
#   2. the initial Prisma migration created `platform.outbox`,
#   3. migration #2 added the table to the publication:
#        ALTER PUBLICATION lumo_outbox ADD TABLE platform.outbox;
#
# Usage (from repo root):
#   bash infrastructure/docker/debezium/register-connector.sh
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONNECT_URL="${CONNECT_URL:-http://localhost:8083}"

curl -sf -X PUT "$CONNECT_URL/connectors/lumo-outbox/config" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "import json,sys;print(json.dumps(json.load(open('$DIR/outbox-connector.json'))['config']))" 2>/dev/null \
      || node -e "const c=require('$DIR/outbox-connector.json');console.log(JSON.stringify(c.config))")"
echo
curl -sf "$CONNECT_URL/connectors/lumo-outbox/status"
echo
