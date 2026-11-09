#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

printf '%s\n' '{"type":"module"}' > "$out/package.json"
pnpm exec tsc -p "$root/packages/extract/tsconfig.json" --noEmit false --outDir "$out"

cd "$root"
NODE_PATH="$root/packages/extract/node_modules${NODE_PATH:+:$NODE_PATH}" node "$out/live-check.js"
