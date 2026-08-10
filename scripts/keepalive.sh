#!/usr/bin/env bash
# OPTIONEEL / NIET IN GEBRUIK (besluit Bas 6 aug 2026: geen idle-timeout in de praktijk,
# platform wordt vooraf geactiveerd). Alleen bewaard als fallback mocht gedrag ooit wijzigen.
# Houdt het Node-proces warm op vergaderdag (voorkomt cold start voor de eerste eigenaar).
# Zet als cronjob in DirectAdmin, bijv. elke 3 minuten OP DE VERGADERDAG:
#   */3 * * * * /home/USER/domains/stem.honigfabriek.nl/scripts/keepalive.sh
# Schakel 'm daarna weer uit — niet permanent laten draaien.
set -euo pipefail
URL="${KEEPALIVE_URL:-https://stem.honigfabriek.nl/healthz}"
curl -fsS --max-time 10 "$URL" > /dev/null && echo "$(date -u +%FT%TZ) keepalive ok" || \
  echo "$(date -u +%FT%TZ) keepalive FAILED"
