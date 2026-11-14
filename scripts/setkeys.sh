#!/usr/bin/env bash
# Prompts for API keys (hidden input) and writes them to .env (gitignored, chmod 600).
# Leave a prompt blank to keep the existing value / skip.
set -euo pipefail
cd "$(dirname "$0")/.."
touch .env && chmod 600 .env

set_key() {
  local name="$1" label="$2" val
  printf '%s (%s) [blank = skip]: ' "$name" "$label"
  IFS= read -rs val; echo
  [ -z "$val" ] && return 0
  grep -v "^${name}=" .env > .env.tmp || true
  printf '%s=%s\n' "$name" "$val" >> .env.tmp
  mv .env.tmp .env && chmod 600 .env
  echo "  saved $name (${#val} chars)"
}

set_key NACE_API_KEY "Drex + NDI, console.nace.ai"
set_key OPENAI_API_KEY "enemy general, GPT Luna 6"
set_key FIREFLY_CLIENT_ID "Adobe Firefly API, optional"
set_key FIREFLY_CLIENT_SECRET "Adobe Firefly API, optional"
set_key FIREFLY_API_KEY "Adobe Firefly API key, if you got one instead"
echo "Done. Keys in .env: $(cut -d= -f1 .env | tr '\n' ' ')"
