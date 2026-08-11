#!/usr/bin/env bash
# Code-only deploy naar mijn.host .starter. Data-provisioning blijft een aparte Mistral-stap.
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="acceptatie"
ARTIFACT="${DEPLOY_ARTIFACT:-}"
ALLOW_PRODUCTION=false
DRY_RUN=false
CONFIRM_NO_OPEN_ROUND=false

usage() {
  cat <<'USAGE'
Gebruik: scripts/deploy.sh [--target acceptatie|portaal] [--artifact pad.tgz]
                         [--confirm-no-open-round] [--allow-production] [--dry-run]

Standaarddoel is acceptatie. Portaal vereist zowel --allow-production als
BAS_PRODUCTION_GO=JA; die dubbele poort wordt nooit impliciet overgeslagen.
Een echte deploy vereist daarnaast --confirm-no-open-round: de operator bevestigt
dat er op het doel geen stemronde openstaat.

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
    --confirm-no-open-round)
      CONFIRM_NO_OPEN_ROUND=true
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
SSH_USER="${SSH_HOST%%@*}"
REMOTE_DIR="${REMOTE_DIR%/}"
[[ "$SSH_PORT" =~ ^[0-9]+$ ]] && ((SSH_PORT >= 1 && SSH_PORT <= 65535)) || {
  echo "${TARGET^^}_SSH_PORT moet tussen 1 en 65535 liggen." >&2
  exit 2
}
[[ "$REMOTE_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || {
  echo "${TARGET^^}_REMOTE_DIR ontbreekt of is geen veilig absoluut pad." >&2
  exit 2
}
case "$REMOTE_DIR" in
  *"//"*|*"/../"*|*"/./"*)
    echo "${TARGET^^}_REMOTE_DIR bevat onveilige padsegmenten." >&2
    exit 2
    ;;
esac
case "$REMOTE_DIR" in
  "/home/$SSH_USER/domains/"*/nodeapp) ;;
  *)
    echo "${TARGET^^}_REMOTE_DIR moet de vaste CloudLinux app-root /home/$SSH_USER/domains/.../nodeapp zijn." >&2
    exit 2
    ;;
esac
[[ "$REMOTE_SECRETS_FILE" =~ ^/[A-Za-z0-9._/-]+$ ]] || {
  echo "Secrets-pad is geen veilig absoluut pad." >&2
  exit 2
}
case "$REMOTE_SECRETS_FILE" in
  *"//"*|*"/../"*|*"/./"*)
    echo "Secrets-pad bevat onveilige padsegmenten." >&2
    exit 2
    ;;
esac
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
echo ">> Application root (in-place): $REMOTE_DIR"
echo ">> Backup root: ${REMOTE_DIR}.deploy/backups"
echo ">> Healthcheck: $HEALTH_URL"
echo ">> Secrets: server-side buiten application root (inhoud wordt niet gelezen of getoond)"

if [[ "$DRY_RUN" == true ]]; then
  echo ">> DRY-RUN groen: doelkeuze en veiligheidsgrenzen zijn geldig; geen verbinding gemaakt."
  exit 0
fi

if [[ "$CONFIRM_NO_OPEN_ROUND" != true ]]; then
  echo "DEPLOY GEBLOKKEERD: bevestig met --confirm-no-open-round dat geen stemronde openstaat." >&2
  exit 4
fi

SSH_OPTIONS=(
  -p "$SSH_PORT"
  -o BatchMode=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$HOME/.ssh/known_hosts"
)
SCP_OPTIONS=(
  -P "$SSH_PORT"
  -o BatchMode=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$HOME/.ssh/known_hosts"
)

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
RELEASE_ID="${COMMIT_SHA:0:12}-$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM"
REMOTE_DEPLOY_ROOT="${REMOTE_DIR}.deploy"
REMOTE_WORK="$REMOTE_DEPLOY_ROOT/work/$RELEASE_ID"
REMOTE_BACKUP="$REMOTE_DEPLOY_ROOT/backups/$RELEASE_ID"

echo ">> 2. CloudLinux app-root en server-side secretsgrens controleren"
ssh "${SSH_OPTIONS[@]}" "$SSH_HOST" sh -s -- "$REMOTE_DIR" "$REMOTE_SECRETS_FILE" "$TARGET" "$REMOTE_DEPLOY_ROOT" "$REMOTE_WORK" <<'REMOTE_CHECK'
set -eu
remote_dir="$1"
secrets_file="$2"
target="$3"
deploy_root="$4"
work_dir="$5"
case "$remote_dir" in /home/*/domains/*/nodeapp) ;; *) echo "Onveilige CloudLinux app-root." >&2; exit 10;; esac
test -d "$remote_dir" || { echo "CloudLinux app-root ontbreekt." >&2; exit 10; }
test ! -L "$remote_dir" || { echo "CloudLinux app-root mag geen symlink zijn." >&2; exit 10; }
test ! -e "$remote_dir/current" || { echo "Oud current-layout aangetroffen; app-root moet nodeapp zelf blijven." >&2; exit 10; }
test "$deploy_root" = "${remote_dir}.deploy" || { echo "Backup-root hoort niet bij app-root." >&2; exit 10; }
test ! -L "$deploy_root" || { echo "Backup-root mag geen symlink zijn." >&2; exit 10; }
for command_name in rsync npm tar sha256sum realpath; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Servercommando ontbreekt: $command_name" >&2; exit 10; }
done
remote_real="$(realpath -e "$remote_dir")"
secrets_real="$(realpath -e "$secrets_file")"
test "$remote_real" = "$remote_dir" || { echo "CloudLinux app-root bevat symlinks of omwegen." >&2; exit 10; }
test -f "$secrets_real" || { echo "Secrets-bestand ontbreekt." >&2; exit 10; }
test "$(stat -c '%a' "$secrets_real")" = "600" || { echo "Secrets-bestand moet chmod 600 zijn." >&2; exit 11; }
case "$secrets_real" in "$remote_real"|"$remote_real"/*) echo "Secrets-bestand staat binnen application root." >&2; exit 12;; esac
for key in DEPLOY_TARGET DB_HOST DB_NAME DB_USER DB_PASSWORD AUTH_PEPPER TRUST_PROXY; do
  grep -Eq "^${key}=.+" "$secrets_real" || { echo "Verplichte sleutel ontbreekt: $key" >&2; exit 13; }
done
grep -Eq "^DEPLOY_TARGET=${target}$" "$secrets_real" || { echo "DEPLOY_TARGET hoort niet bij deploydoel." >&2; exit 14; }
umask 077
mkdir -p "$deploy_root/work" "$deploy_root/backups"
test ! -e "$work_dir" || { echo "Deploy-werkmap bestaat al; herhaal met een nieuwe run." >&2; exit 15; }
mkdir "$work_dir"
REMOTE_CHECK

echo ">> 3. Code-only release uploaden, backup maken en in-place installeren"
scp "${SCP_OPTIONS[@]}" "$ARTIFACT" "$SSH_HOST:$REMOTE_WORK/app.tgz"

rollback_remote() {
  ssh "${SSH_OPTIONS[@]}" "$SSH_HOST" sh -s -- "$REMOTE_DIR" "$REMOTE_DEPLOY_ROOT" "$REMOTE_BACKUP" <<'REMOTE_ROLLBACK'
set -eu
remote_dir="$1"
deploy_root="$2"
backup_dir="$3"
case "$remote_dir" in /home/*/domains/*/nodeapp) ;; *) echo "Rollback weigert onveilige app-root." >&2; exit 30;; esac
test "$deploy_root" = "${remote_dir}.deploy" || { echo "Rollback weigert onveilige backup-root." >&2; exit 30; }
test -d "$remote_dir" && test ! -L "$remote_dir"
test "$(realpath -e "$remote_dir")" = "$remote_dir" || { echo "Rollback weigert app-root met symlinks of omwegen." >&2; exit 30; }
test -f "$backup_dir/.backup-ready" || { echo "Rollback-backup is niet compleet." >&2; exit 31; }
lock_dir="$deploy_root/deploy.lock"
mkdir "$lock_dir" 2>/dev/null || { echo "Een andere deploy of rollback is actief." >&2; exit 32; }
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT HUP INT TERM
for name in src package.json package-lock.json; do
  if [ -L "$remote_dir/$name" ]; then rm -f "$remote_dir/$name"; else rm -rf "$remote_dir/$name"; fi
done
for name in src package.json package-lock.json; do
  if [ -e "$backup_dir/managed/$name" ]; then
    rsync -a "$backup_dir/managed/$name" "$remote_dir/"
  fi
done
if [ -f "$remote_dir/package.json" ] && [ -f "$remote_dir/package-lock.json" ]; then
  (cd "$remote_dir" && npm ci --omit=dev --no-audit --no-fund)
fi
mkdir -p "$remote_dir/tmp"
touch "$remote_dir/tmp/restart.txt"
REMOTE_ROLLBACK
}

if ! ssh "${SSH_OPTIONS[@]}" "$SSH_HOST" sh -s -- "$REMOTE_DIR" "$REMOTE_DEPLOY_ROOT" "$REMOTE_WORK" "$REMOTE_BACKUP" "$ARTIFACT_SHA256" "$COMMIT_SHA" <<'REMOTE_INSTALL'
set -eu
remote_dir="$1"
deploy_root="$2"
work_dir="$3"
backup_dir="$4"
expected_hash="$5"
commit_sha="$6"
case "$remote_dir" in /home/*/domains/*/nodeapp) ;; *) echo "Installatie weigert onveilige app-root." >&2; exit 16;; esac
test "$deploy_root" = "${remote_dir}.deploy" || { echo "Installatie weigert onveilige deploy-root." >&2; exit 16; }
test -d "$remote_dir" && test ! -L "$remote_dir"
test "$(realpath -e "$remote_dir")" = "$remote_dir" || { echo "Installatie weigert app-root met symlinks of omwegen." >&2; exit 16; }
lock_dir="$deploy_root/deploy.lock"
mkdir "$lock_dir" 2>/dev/null || { echo "Een andere deploy is actief." >&2; exit 17; }
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT HUP INT TERM

cd "$work_dir"
printf '%s  app.tgz\n' "$expected_hash" | sha256sum -c -
tar -tzf app.tgz > entries.txt
while IFS= read -r original_entry; do
  entry="${original_entry#./}"
  case "$entry" in
    package.json|package-lock.json|src|src/|src/*) ;;
    *) echo "Onverwacht pad in release-artefact: $entry" >&2; exit 18;;
  esac
  case "$entry" in
    /*|../*|*/../*|*/..) echo "Pad-ontsnapping in release-artefact: $entry" >&2; exit 18;;
  esac
done < entries.txt
mkdir payload
tar -xzf app.tgz -C payload
test -f payload/package.json
test -f payload/package-lock.json
test -d payload/src
if find payload -type l -print -quit | grep -q .; then
  echo "Release-artefact mag geen symlinks bevatten." >&2
  exit 18
fi
for name in src package.json package-lock.json; do
  test ! -L "$remote_dir/$name" || { echo "Beheerd app-pad mag geen symlink zijn: $name" >&2; exit 18; }
done

umask 077
test ! -e "$backup_dir" || { echo "Backup-map bestaat al; deploy-id is niet uniek." >&2; exit 18; }
mkdir -p "$backup_dir/managed"
for name in src package.json package-lock.json; do
  if [ -e "$remote_dir/$name" ]; then
    rsync -a "$remote_dir/$name" "$backup_dir/managed/"
  fi
done
printf 'commit=%s\ncreated_utc=%s\n' "$commit_sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$backup_dir/metadata"
touch "$backup_dir/.backup-ready"

mkdir -p "$remote_dir/src"
rsync -a --delete payload/src/ "$remote_dir/src/"
rsync -a payload/package.json payload/package-lock.json "$remote_dir/"
(cd "$remote_dir" && npm ci --omit=dev --no-audit --no-fund)
mkdir -p "$remote_dir/tmp"
touch "$remote_dir/tmp/restart.txt"
REMOTE_INSTALL
then
  echo "In-place installatie mislukt; backup wordt hersteld." >&2
  if rollback_remote; then
    echo "Rollback na installatiefout voltooid." >&2
    exit 19
  fi
  echo "ROLLBACK MISLUKT: handmatige interventie vereist; backup=$REMOTE_BACKUP" >&2
  exit 21
fi

echo ">> 4. HTTPS- en database-healthcheck"
HEALTH_OK=false
for attempt in $(seq 1 12); do
  if response="$(curl -fsS --max-time 10 "$HEALTH_URL")" && grep -q '"database":"up"' <<<"$response"; then
    HEALTH_OK=true
    break
  fi
  sleep 5
done

if [[ "$HEALTH_OK" != true ]]; then
  echo "Healthcheck rood; getimestampte backup wordt hersteld." >&2
  if rollback_remote; then
    echo "Rollback na rode healthcheck voltooid." >&2
    exit 20
  fi
  echo "ROLLBACK MISLUKT: handmatige interventie vereist; backup=$REMOTE_BACKUP" >&2
  exit 21
fi

if ! ssh "${SSH_OPTIONS[@]}" "$SSH_HOST" sh -s -- "$REMOTE_DEPLOY_ROOT" "$REMOTE_WORK" <<'REMOTE_CLEANUP'
set -eu
deploy_root="$1"
work_dir="$2"
case "$work_dir" in "$deploy_root"/work/*) rm -rf "$work_dir";; *) echo "Cleanup weigert onveilige werkmap." >&2; exit 22;; esac
REMOTE_CLEANUP
then
  echo "WAARSCHUWING: tijdelijke uploadmap kon niet worden opgeruimd: $REMOTE_WORK" >&2
fi

echo ">> DEPLOY GROEN: target=$TARGET commit=$COMMIT_SHA artifact_sha256=$ARTIFACT_SHA256 backup=$REMOTE_BACKUP"
echo ">> Data is niet gewijzigd; provisioning en hersteltest blijven aparte Mistral-gates."
