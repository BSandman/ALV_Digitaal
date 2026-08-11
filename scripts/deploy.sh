#!/usr/bin/env bash
# Code-only deploy naar mijn.host .starter. Data-provisioning blijft een aparte Mistral-stap.
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="acceptatie"
ARTIFACT="${DEPLOY_ARTIFACT:-}"
ALLOW_PRODUCTION=false
DRY_RUN=false

usage() {
  cat <<'USAGE'
Gebruik: scripts/deploy.sh [--target acceptatie|portaal] [--artifact pad.tgz]
                         [--allow-production] [--dry-run]

Standaarddoel is acceptatie. Portaal vereist zowel --allow-production als
BAS_PRODUCTION_GO=JA; die dubbele poort wordt nooit impliciet overgeslagen.

Per doel vereist:
  ACCEPTATIE_SSH_HOST / ACCEPTATIE_SSH_PORT / ACCEPTATIE_REMOTE_DIR
  PORTAAL_SSH_HOST    / PORTAAL_SSH_PORT    / PORTAAL_REMOTE_DIR

Optioneel zijn *_HEALTH_URL en *_SECRETS_FILE; veilige defaults zijn ingebouwd.
USAGE
}

while (($# > 0)); do
  case "$1" in
    --target)
      [[ $# -ge 2 ]] || { echo "Waarde ontbreekt voor --target" >&2; exit 2; }
      TARGET="$2"
      shift 2
      ;;
    --artifact)
      [[ $# -ge 2 ]] || { echo "Waarde ontbreekt voor --artifact" >&2; exit 2; }
      ARTIFACT="$2"
      shift 2
      ;;
    --allow-production)
      ALLOW_PRODUCTION=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Onbekend argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$TARGET" in
  acceptatie)
    SSH_HOST="${ACCEPTATIE_SSH_HOST:-}"
    SSH_PORT="${ACCEPTATIE_SSH_PORT:-22}"
    REMOTE_DIR="${ACCEPTATIE_REMOTE_DIR:-}"
    HEALTH_URL="${ACCEPTATIE_HEALTH_URL:-https://acceptatie.honigfabriek.nl/healthz}"
    REMOTE_SECRETS_FILE="${ACCEPTATIE_SECRETS_FILE:-/home/cn111993/secrets/alv-acceptatie.env}"
    EXPECTED_HEALTH_URL="https://acceptatie.honigfabriek.nl/healthz"
    ;;
  portaal)
    if [[ "$ALLOW_PRODUCTION" != true || "${BAS_PRODUCTION_GO:-}" != "JA" ]]; then
      echo "PRODUCTIE GEBLOKKEERD: vereis --allow-production én BAS_PRODUCTION_GO=JA." >&2
      exit 3
    fi
    SSH_HOST="${PORTAAL_SSH_HOST:-}"
    SSH_PORT="${PORTAAL_SSH_PORT:-22}"
    REMOTE_DIR="${PORTAAL_REMOTE_DIR:-}"
    HEALTH_URL="${PORTAAL_HEALTH_URL:-https://portaal.honigfabriek.nl/healthz}"
    REMOTE_SECRETS_FILE="${PORTAAL_SECRETS_FILE:-/home/cn111993/secrets/alv-portaal.env}"
    EXPECTED_HEALTH_URL="https://portaal.honigfabriek.nl/healthz"
    ;;
  *)
    echo "Ongeldig doel: $TARGET (verwacht acceptatie of portaal)." >&2
    exit 2
    ;;
esac

[[ "$SSH_HOST" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$ ]] || {
  echo "${TARGET^^}_SSH_HOST ontbreekt of heeft geen veilige user@host-vorm." >&2
  exit 2
}
[[ "$SSH_PORT" =~ ^[0-9]+$ ]] && ((SSH_PORT >= 1 && SSH_PORT <= 65535)) || {
  echo "${TARGET^^}_SSH_PORT moet tussen 1 en 65535 liggen." >&2
  exit 2
}
[[ "$REMOTE_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || {
  echo "${TARGET^^}_REMOTE_DIR ontbreekt of is geen veilig absoluut pad." >&2
  exit 2
}
[[ "$REMOTE_SECRETS_FILE" =~ ^/[A-Za-z0-9._/-]+$ ]] || {
  echo "Secrets-pad is geen veilig absoluut pad." >&2
  exit 2
}
[[ "$HEALTH_URL" == "$EXPECTED_HEALTH_URL" ]] || {
  echo "Health-URL hoort niet bij doel $TARGET: $HEALTH_URL" >&2
  exit 2
}
case "$REMOTE_SECRETS_FILE" in
  "$REMOTE_DIR"|"$REMOTE_DIR"/*)
    echo "Secrets-bestand moet buiten de application root staan (ADR-0012)." >&2
    exit 2
    ;;
esac

echo ">> Doel: $TARGET"
echo ">> Host: $SSH_HOST"
echo ">> SSH-poort: $SSH_PORT"
echo ">> Application root: $REMOTE_DIR/current"
echo ">> Healthcheck: $HEALTH_URL"
echo ">> Secrets: server-side buiten application root (inhoud wordt niet gelezen of getoond)"

if [[ "$DRY_RUN" == true ]]; then
  echo ">> DRY-RUN groen: doelkeuze en veiligheidsgrenzen zijn geldig; geen verbinding gemaakt."
  exit 0
fi

[[ -n "$ARTIFACT" ]] || { echo "--artifact of DEPLOY_ARTIFACT is verplicht." >&2; exit 2; }
[[ -f "$ARTIFACT" ]] || { echo "Release-artefact ontbreekt: $ARTIFACT" >&2; exit 2; }
ARTIFACT="$(cd "$(dirname "$ARTIFACT")" && pwd)/$(basename "$ARTIFACT")"

echo ">> 1. Lokale release- en privacygate"
node "$PROJECT_ROOT/mistral-lokaal/scripts/pii_scan" --artifact "$ARTIFACT"
if command -v sha256sum >/dev/null 2>&1; then
  ARTIFACT_SHA256="$(sha256sum "$ARTIFACT" | awk '{print $1}')"
else
  ARTIFACT_SHA256="$(shasum -a 256 "$ARTIFACT" | awk '{print $1}')"
fi
COMMIT_SHA="${DEPLOY_COMMIT_SHA:-$(git -C "$PROJECT_ROOT" rev-parse HEAD)}"
[[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "DEPLOY_COMMIT_SHA is geen volledige Git-SHA." >&2; exit 2; }
RELEASE_ID="${COMMIT_SHA:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
REMOTE_RELEASE="$REMOTE_DIR/releases/$RELEASE_ID"

echo ">> 2. Server-side secretsgrens controleren"
ssh -p "$SSH_PORT" "$SSH_HOST" sh -s -- "$REMOTE_DIR" "$REMOTE_SECRETS_FILE" "$TARGET" <<'REMOTE_CHECK'
set -eu
remote_dir="$1"
secrets_file="$2"
target="$3"
test -f "$secrets_file" || { echo "Secrets-bestand ontbreekt." >&2; exit 10; }
test "$(stat -c '%a' "$secrets_file")" = "600" || { echo "Secrets-bestand moet chmod 600 zijn." >&2; exit 11; }
case "$secrets_file" in "$remote_dir"|"$remote_dir"/*) echo "Secrets-bestand staat binnen application root." >&2; exit 12;; esac
for key in DEPLOY_TARGET DB_HOST DB_NAME DB_USER DB_PASSWORD AUTH_PEPPER TRUST_PROXY; do
  grep -Eq "^${key}=.+" "$secrets_file" || { echo "Verplichte sleutel ontbreekt: $key" >&2; exit 13; }
done
grep -Eq "^DEPLOY_TARGET=${target}$" "$secrets_file" || { echo "DEPLOY_TARGET hoort niet bij deploydoel." >&2; exit 14; }
REMOTE_CHECK

echo ">> 3. Nieuwe, onveranderlijke release uploaden en installeren"
ssh -p "$SSH_PORT" "$SSH_HOST" "umask 077; test ! -e '$REMOTE_RELEASE'; mkdir -p '$REMOTE_RELEASE'"
scp -P "$SSH_PORT" "$ARTIFACT" "$SSH_HOST:$REMOTE_RELEASE/app.tgz"
ssh -p "$SSH_PORT" "$SSH_HOST" sh -s -- "$REMOTE_RELEASE" "$ARTIFACT_SHA256" <<'REMOTE_INSTALL'
set -eu
release_dir="$1"
expected_hash="$2"
cd "$release_dir"
printf '%s  app.tgz\n' "$expected_hash" | sha256sum -c -
tar -xzf app.tgz
rm app.tgz
npm ci --omit=dev --no-audit --no-fund
REMOTE_INSTALL

echo ">> 4. Atomair activeren en Passenger herstarten"
PREVIOUS_RELEASE="$(ssh -p "$SSH_PORT" "$SSH_HOST" "readlink '$REMOTE_DIR/current' || true")"
if [[ -n "$PREVIOUS_RELEASE" && "$PREVIOUS_RELEASE" != "$REMOTE_DIR/releases/"* ]]; then
  echo "Bestaande current-link wijst niet naar een beheerde release; deploy afgebroken." >&2
  exit 15
fi
ssh -p "$SSH_PORT" "$SSH_HOST" sh -s -- "$REMOTE_DIR" "$REMOTE_RELEASE" <<'REMOTE_ACTIVATE'
set -eu
remote_dir="$1"
release_dir="$2"
ln -sfn "$release_dir" "$remote_dir/current.next"
mv -Tf "$remote_dir/current.next" "$remote_dir/current"
mkdir -p "$remote_dir/current/tmp"
touch "$remote_dir/current/tmp/restart.txt"
REMOTE_ACTIVATE

echo ">> 5. HTTPS- en database-healthcheck"
HEALTH_OK=false
for attempt in $(seq 1 12); do
  if response="$(curl -fsS --max-time 10 "$HEALTH_URL")" && grep -q '"database":"up"' <<<"$response"; then
    HEALTH_OK=true
    break
  fi
  sleep 5
done

if [[ "$HEALTH_OK" != true ]]; then
  echo "Healthcheck rood; vorige release wordt hersteld." >&2
  ssh -p "$SSH_PORT" "$SSH_HOST" sh -s -- "$REMOTE_DIR" "$PREVIOUS_RELEASE" <<'REMOTE_ROLLBACK'
set -eu
remote_dir="$1"
previous_release="$2"
if [ -n "$previous_release" ]; then
  ln -sfn "$previous_release" "$remote_dir/current.next"
  mv -Tf "$remote_dir/current.next" "$remote_dir/current"
  mkdir -p "$remote_dir/current/tmp"
  touch "$remote_dir/current/tmp/restart.txt"
else
  rm -f "$remote_dir/current"
fi
REMOTE_ROLLBACK
  exit 20
fi

echo ">> DEPLOY GROEN: target=$TARGET commit=$COMMIT_SHA artifact_sha256=$ARTIFACT_SHA256 release=$RELEASE_ID"
echo ">> Data is niet gewijzigd; provisioning en hersteltest blijven aparte Mistral-gates."
