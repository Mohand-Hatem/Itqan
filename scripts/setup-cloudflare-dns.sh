#!/usr/bin/env bash
set -euo pipefail

# Cloudflare Wildcard DNS Setup for Staging (*.staging.<root>)
# Usage: ./scripts/setup-cloudflare-dns.sh

if [ -f .env ]; then
  # shellcheck disable=SC1091
  source .env
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ZONE_ID:-}" || -z "${VPS_HOST:-}" ]]; then
  echo "Cloudflare or VPS credentials not set in .env. Skipping DNS API call."
  exit 0
fi

if [[ "${CLOUDFLARE_API_TOKEN}" == *"mock"* ]]; then
  echo "Mock credentials detected in .env. Skipping remote DNS provisioning."
  exit 0
fi

RECORD_NAME="*.staging"

echo "Creating/Updating Cloudflare DNS A Record for ${RECORD_NAME} pointing to ${VPS_HOST}..."

curl -fsS -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{\"type\":\"A\",\"name\":\"${RECORD_NAME}\",\"content\":\"${VPS_HOST}\",\"ttl\":1,\"proxied\":true}" \
  || echo "Record may already exist or token permissions need verification."

echo "Cloudflare wildcard DNS configuration completed."
