#!/usr/bin/env bash
# Productie-deploy naar mijn.host .starter — GEEN Docker (voorstel §4.4).
# Dit is een VOORZET/checklist; vul host, pad en gates in na Fase 0.
# Mistral bewaakt dat dit pas draait NA architectuur-, test- en privacygates.
set -euo pipefail

# --- Te configureren na Fase 0 ---
SSH_HOST="${SSH_HOST:-user@starter.mijn.host}"
REMOTE_DIR="${REMOTE_DIR:-~/domains/stem.honigfabriek.nl/app}"

echo ">> 1. Gate-check: zijn alle gates afgegeven (Claude/Gemini/Mistral) en heeft Bas go gegeven?"
echo "   (Deze stap is handmatig; release-zip komt uit CI, niet uit een lokale map.)"

echo ">> 2. Broncode synchroniseren (zonder node_modules, zonder .env, zonder data)"
rsync -av --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude 'data' \
  --exclude 'infra' \
  ./app/ "${SSH_HOST}:${REMOTE_DIR}/"

echo ">> 3. Dependencies installeren op de host via SSH (npm ci --production)"
ssh "${SSH_HOST}" "cd ${REMOTE_DIR} && npm ci --omit=dev --no-audit --no-fund"

echo ">> 4. App (her)starten via DirectAdmin/Node-appbeheer"
echo "   TODO: exacte herstart-commando invullen na support-antwoord (v0.1.0 §13)."

echo ">> 5. Rooktest: healthcheck en één status-poll tegen productie-URL"
echo "   curl -fsS https://stem.honigfabriek.nl/healthz"

echo ">> Klaar. Leg deploytijd, versie (git-tag) en uitkomst vast in het releaselog."
