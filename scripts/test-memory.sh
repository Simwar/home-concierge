#!/usr/bin/env bash
# Runs tests/profiles.test.ts against the `memory` Postgres knowledge store of the
# running local stack (`ast project start`), on the stack's Docker network.
set -euo pipefail
AGENT=home-concierge-agent-1
NET=$(docker inspect "$AGENT" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
docker run --rm --network "$NET" \
  --env-file <(docker exec "$AGENT" env | grep '^POSTGRES_') \
  -v "$PWD":/app -w /app oven/bun:1 bun test tests/profiles.test.ts
