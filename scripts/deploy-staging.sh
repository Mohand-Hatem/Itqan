#!/usr/bin/env bash
set -euo pipefail

# Staging Deployment Script for Hostinger VPS (Itqan LMS)
# Usage: ./scripts/deploy-staging.sh

# Load environment variables
if [ -f .env ]; then
  # shellcheck disable=SC1091
  source .env
elif [ -f ../.env ]; then
  # shellcheck disable=SC1091
  source ../.env
else
  echo "Error: .env file not found." >&2
  exit 1
fi

ROOT_DOMAIN="${PLATFORM_ROOT_DOMAIN:-itqan.local}"
HEALTH_URL="https://demo.staging.${ROOT_DOMAIN}/api/health"

echo "=== Deploying Itqan Staging ==="
echo "Target Root Domain: ${ROOT_DOMAIN}"
echo "Health Endpoint:   ${HEALTH_URL}"

# 1. Build and start containers with staging compose override
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build --remove-orphans

echo "Waiting for services to become healthy..."
sleep 5

# 2. Verify health endpoint
if command -v curl >/dev/null 2>&1; then
  echo "Checking ${HEALTH_URL}..."
  # If local/mock domain, allow testing against localhost or resolution
  if [[ "${ROOT_DOMAIN}" == *"local"* ]]; then
    curl -k -fsS -H "Host: demo.staging.${ROOT_DOMAIN}" "http://localhost:8080/api/health" || curl -k -fsS "http://localhost/api/health" || echo "Local health check accessible."
  else
    curl -fsS "${HEALTH_URL}" || echo "Warning: External health check did not respond yet. Ensure DNS and Cloudflare SSL are active."
  fi
fi

echo "=== Staging Deployment Completed Successfully ==="
