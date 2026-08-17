#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
MODEL="${EMBEDDING_MODEL:-${OLLAMA_EMBEDDING_MODEL:-nomic-embed-text}}"
OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"

if [[ "$OLLAMA_HOST" != "http://localhost:11434" && "$OLLAMA_HOST" != "http://127.0.0.1:11434" ]]; then
  echo "OLLAMA_HOST must point to the local Compose Ollama service when using this script: $OLLAMA_HOST" >&2
  exit 1
fi

export OLLAMA_HOST

echo "Starting Qdrant and Ollama..."
docker compose -f "$PROJECT_DIR/docker-compose.yml" up -d qdrant ollama

echo "Waiting for Ollama at $OLLAMA_HOST..."
for _ in {1..30}; do
  if curl --silent --fail "$OLLAMA_HOST/api/tags" >/dev/null; then
    break
  fi
  sleep 2
done

if ! curl --silent --fail "$OLLAMA_HOST/api/tags" >/dev/null; then
  echo "Ollama did not become ready at $OLLAMA_HOST" >&2
  exit 1
fi

echo "Waiting for Qdrant at http://localhost:6333..."
for _ in {1..30}; do
  if curl --silent --fail "http://localhost:6333/healthz" >/dev/null; then
    break
  fi
  sleep 2
done

if ! curl --silent --fail "http://localhost:6333/healthz" >/dev/null; then
  echo "Qdrant did not become ready at http://localhost:6333" >&2
  exit 1
fi

echo "Pulling Ollama embedding model: $MODEL"
docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T ollama ollama pull "$MODEL"
echo "Ollama embedding configuration initialized."
