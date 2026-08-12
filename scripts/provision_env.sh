#!/usr/bin/env bash
# Idempotente CloudLinux/mijn.host-inrichting. Toont of logt nooit secretwaarden.
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET=""
SECRETS_SOURCE=""
ALLOW_PRODUCTION=false
DRY_RUN=false

usage() {
  cat <<'USAGE'
Gebruik: scripts/provision_env.sh --target acceptatie|portaal
                                [--secrets-source lokaal.env]
                                [--allow-production] [--dry-run]

De bron blijft lokaal en moet buiten Git staan (binnen de repo dus genegeerd).
Standaard: mistral-lokaal/secure/alv-<target>.env.

Per doel vereist:
  ACCEPTATIE_SSH_HOST / ACCEPTATIE_SSH_PORT / ACCEPTATIE_REMOTE_DIR / ACCEPTATIE_NODE_BIN
  PORTAAL_SSH_HOST    / PORTAAL_SSH_PORT    / PORTAAL_REMOTE_DIR    / PORTAAL_NODE_BIN

Optioneel: *_SECRETS_FILE. Portaal vereist daarnaast --allow-production en
BAS_PRODUCTION_GO=JA. Bekende hosts komen uitsluitend uit ~/.ssh/known_hosts.
USAGE
}

while (($# > 0)); do
  case "$1" in
    --target)
      [[ $# -ge 2 ]] || { echo "Waarde ontbreekt voor --target" >&2; exit 2; }
      TARGET="$2"
      shift 2
      ;;
    --secrets-source)
      [[ $# -ge 2 ]] || { echo "Waarde ontbreekt voor --secrets-source" >&2; exit 2; }
      SECRETS_SOURCE="$2"
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
    NODE_BIN="${ACCEPTATIE_NODE_BIN:-}"
    REMOTE_SECRETS_FILE="${ACCEPTATIE_SECRETS_FILE:-/home/cn111993/secrets/alv-acceptatie.env}"
    ;;
  portaal)
    if [[ "$ALLOW_PRODUCTION" != true || "${BAS_PRODUCTION_GO:-}" != "JA" ]]; then
      echo "PRODUCTIE GEBLOKKEERD: vereis --allow-production én BAS_PRODUCTION_GO=JA." >&2
      exit 3
    fi
    SSH_HOST="${PORTAAL_SSH_HOST:-}"
    SSH_PORT="${PORTAAL_SSH_PORT:-22}"
    REMOTE_DIR="${PORTAAL_REMOTE_DIR:-}"
    NODE_BIN="${PORTAAL_NODE_BIN:-}"
    REMOTE_SECRETS_FILE="${PORTAAL_SECRETS_FILE:-/home/cn111993/secrets/alv-portaal.env}"
    ;;
  *)
    echo "--target acceptatie|portaal is verplicht." >&2
    exit 2
    ;;
esac

[[ "$SSH_HOST" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$ ]] || {
  echo "${TARGET^^}_SSH_HOST ontbreekt of heeft geen veilige user@host-vorm." >&2
  exit 2
}
SSH_USER="${SSH_HOST%%@*}"
REMOTE_DIR="${REMOTE_DIR%/}"
NODE_BIN="${NODE_BIN%/}"
[[ "$SSH_PORT" =~ ^[0-9]+$ ]] && ((SSH_PORT >= 1 && SSH_PORT <= 65535)) || {
  echo "${TARGET^^}_SSH_PORT moet tussen 1 en 65535 liggen." >&2
  exit 2
}
for candidate_name in REMOTE_DIR NODE_BIN REMOTE_SECRETS_FILE; do
  candidate="${!candidate_name}"
  [[ "$candidate" =~ ^/[A-Za-z0-9._/-]+$ ]] || {
    echo "$candidate_name ontbreekt of is geen veilig absoluut pad." >&2
    exit 2
  }
  case "$candidate" in
    *"//"*|*"/../"*|*"/./"*) echo "$candidate_name bevat onveilige padsegmenten." >&2; exit 2;;
  esac
done
case "$REMOTE_DIR" in
  "/home/$SSH_USER/domains/"*/nodeapp) ;;
  *) echo "REMOTE_DIR moet /home/$SSH_USER/domains/.../nodeapp zijn." >&2; exit 2;;
esac
EXPECTED_SECRETS_FILE="/home/$SSH_USER/secrets/alv-$TARGET.env"
[[ "$REMOTE_SECRETS_FILE" == "$EXPECTED_SECRETS_FILE" ]] || {
  echo "SECRETS_FILE moet voor $TARGET exact $EXPECTED_SECRETS_FILE zijn." >&2
  exit 2
}
NODE_BIN_PREFIX="/home/$SSH_USER/nodevenv${REMOTE_DIR#"/home/$SSH_USER"}"
case "$NODE_BIN" in
  "$NODE_BIN_PREFIX"/*/bin) ;;
  *) echo "NODE_BIN moet bij dezelfde CloudLinux app-root horen." >&2; exit 2;;
esac
NODE_VERSION="${NODE_BIN#"$NODE_BIN_PREFIX"/}"
NODE_VERSION="${NODE_VERSION%/bin}"
[[ "$NODE_VERSION" =~ ^20([.][0-9]+){0,2}$ ]] || {
  echo "NODE_BIN moet expliciet een Node 20-versie bevatten." >&2
  exit 2
}

if [[ -z "$SECRETS_SOURCE" ]]; then
  SECRETS_SOURCE="$PROJECT_ROOT/mistral-lokaal/secure/alv-$TARGET.env"
fi
[[ -f "$SECRETS_SOURCE" && ! -L "$SECRETS_SOURCE" ]] || {
  echo "Lokale secretsbron ontbreekt of is geen regulier niet-symlinkbestand." >&2
  exit 2
}
SECRETS_SOURCE="$(cd "$(dirname "$SECRETS_SOURCE")" && pwd -P)/$(basename "$SECRETS_SOURCE")"
case "$SECRETS_SOURCE" in
  "$PROJECT_ROOT"/*)
    git -C "$PROJECT_ROOT" check-ignore -q -- "$SECRETS_SOURCE" || {
      echo "Lokale secretsbron binnen de repo moet door Git genegeerd zijn." >&2
      exit 2
    }
    ;;
esac
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *)
    source_mode="$(stat -c '%a' "$SECRETS_SOURCE")"
    [[ "$source_mode" == "600" || "$source_mode" == "400" ]] || {
      echo "Lokale secretsbron moet chmod 600 of 400 zijn." >&2
      exit 2
    }
    ;;
esac

node "$PROJECT_ROOT/scripts/validate-provision-secrets.mjs" "$SECRETS_SOURCE" "$TARGET"

echo ">> Provisioningdoel: $TARGET"
echo ">> Host: $SSH_HOST (poort $SSH_PORT)"
echo ">> App-root: $REMOTE_DIR"
echo ">> Node-runtime: $NODE_BIN"
echo ">> Secretsdoel: $REMOTE_SECRETS_FILE (inhoud wordt niet getoond)"
if [[ "$DRY_RUN" == true ]]; then
  echo ">> DRY-RUN groen: lokale bron en alle doelgrenzen zijn geldig; geen verbinding gemaakt."
  exit 0
fi

SSH_OPTIONS=(
  -p "$SSH_PORT"
  -o BatchMode=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$HOME/.ssh/known_hosts"
)
REMOTE_TEMP="${REMOTE_SECRETS_FILE}.provision.$$.$RANDOM"

echo ">> 1. Veilige mappen en afgeschermd tijdelijk bestand voorbereiden"
ssh "${SSH_OPTIONS[@]}" "$SSH_HOST" sh -s -- \
  "$REMOTE_DIR" "$REMOTE_SECRETS_FILE" "$REMOTE_TEMP" "$NODE_BIN" <<'REMOTE_PREPARE'
set -eu
remote_dir="$1"
secrets_file="$2"
temp_file="$3"
node_bin="$4"
remote_user="$(id -un)"
case "$remote_dir" in "/home/$remote_user/domains/"*/nodeapp) ;; *) echo "Onveilige app-root." >&2; exit 10;; esac
test "$secrets_file" = "/home/$remote_user/secrets/alv-acceptatie.env" || \
  test "$secrets_file" = "/home/$remote_user/secrets/alv-portaal.env" || {
    echo "Onveilig secrets-pad." >&2; exit 10;
  }
test "$temp_file" != "$secrets_file"
case "$temp_file" in "$secrets_file".provision.*) ;; *) echo "Onveilig tijdelijk pad." >&2; exit 10;; esac
secrets_dir="$(dirname "$secrets_file")"
umask 077
mkdir -p "$remote_dir" "$secrets_dir"
test ! -L "$remote_dir" && test ! -L "$secrets_dir"
test "$(realpath -e "$remote_dir")" = "$remote_dir" || { echo "App-root bevat symlinks of omwegen." >&2; exit 10; }
test "$(realpath -e "$secrets_dir")" = "$secrets_dir" || { echo "Secretsmap bevat symlinks of omwegen." >&2; exit 10; }
node_prefix="/home/$remote_user/nodevenv${remote_dir#"/home/$remote_user"}"
case "$node_bin" in "$node_prefix"/20*/bin) ;; *) echo "Nodevenv hoort niet bij app-root/Node 20." >&2; exit 10;; esac
node_real="$(CDPATH= cd -P "$node_bin" 2>/dev/null && pwd -P)" || { echo "Nodevenv-bin ontbreekt." >&2; exit 10; }
case "$node_real" in "$node_prefix"/20*/bin) ;; *) echo "Nodevenv ontsnapt uit app-specifieke map." >&2; exit 10;; esac
PATH="$node_real:$PATH"
export PATH
node_version="$(node --version)"
case "$node_version" in v20.*) ;; *) echo "Remote runtime is geen Node 20." >&2; exit 10;; esac
test -f "$remote_dir/src/start.js" && test ! -L "$remote_dir/src/start.js" || {
  echo "src/start.js ontbreekt of is een symlink; deploy eerst de gevalideerde code." >&2; exit 10;
}
: > "$temp_file"
chmod 600 "$temp_file"
REMOTE_PREPARE

cleanup_remote_temp() {
  ssh "${SSH_OPTIONS[@]}" "$SSH_HOST" sh -s -- "$REMOTE_TEMP" "$REMOTE_SECRETS_FILE" <<'REMOTE_CLEANUP' >/dev/null 2>&1 || true
set -eu
temp_file="$1"
secrets_file="$2"
case "$temp_file" in "$secrets_file".provision.*) rm -f "$temp_file" "$temp_file.keys" "$temp_file.keys.unsorted";; esac
REMOTE_CLEANUP
}
trap cleanup_remote_temp EXIT HUP INT TERM

echo ">> 2. Secretsbron afgeschermd streamen en remote opnieuw valideren"
ssh "${SSH_OPTIONS[@]}" "$SSH_HOST" sh -c '
  set -eu
  temp_file="$1"
  secrets_file="$2"
  case "$temp_file" in "$secrets_file".provision.*) ;; *) exit 20;; esac
  test -f "$temp_file" && test ! -L "$temp_file"
  cat > "$temp_file"
  chmod 600 "$temp_file"
' sh "$REMOTE_TEMP" "$REMOTE_SECRETS_FILE" < "$SECRETS_SOURCE"

ssh "${SSH_OPTIONS[@]}" "$SSH_HOST" sh -s -- \
  "$REMOTE_DIR" "$REMOTE_SECRETS_FILE" "$REMOTE_TEMP" "$TARGET" "$NODE_BIN" <<'REMOTE_FINALIZE'
set -eu
remote_dir="$1"
secrets_file="$2"
temp_file="$3"
target="$4"
node_bin="$5"
remote_user="$(id -un)"
case "$temp_file" in "$secrets_file".provision.*) ;; *) echo "Onveilig tijdelijk pad." >&2; exit 20;; esac
test -f "$temp_file" && test ! -L "$temp_file" || { echo "Tijdelijk secretsbestand is onveilig." >&2; exit 20; }
test "$(stat -c '%a' "$temp_file")" = "600" || { echo "Tijdelijk secretsbestand is niet chmod 600." >&2; exit 20; }
if [ -e "$secrets_file" ]; then
  test -f "$secrets_file" && test ! -L "$secrets_file" || { echo "Bestaand secretsdoel is onveilig." >&2; exit 20; }
fi

keys_file="$temp_file.keys"
unsorted_keys_file="$temp_file.keys.unsorted"
if ! awk '
  { sub(/\r$/, "") }
  /^[[:space:]]*$/ || /^[[:space:]]*#/ { next }
  !/^[A-Z][A-Z0-9_]*=/ { exit 2 }
  {
    key=substr($0, 1, index($0, "=") - 1)
    if (seen[key]++) exit 3
    print key
  }
' "$temp_file" > "$unsorted_keys_file"; then
  echo "Ongeldige of dubbele secretsleutel." >&2
  exit 20
fi
LC_ALL=C sort "$unsorted_keys_file" > "$keys_file"
rm -f "$unsorted_keys_file"
expected_keys='AUTH_PEPPER
DB_HOST
DB_NAME
DB_PASSWORD
DB_PORT
DB_USER
DEPLOY_TARGET
TRUST_PROXY'
actual_keys="$(cat "$keys_file")"
test "$actual_keys" = "$expected_keys" || { echo "Secretsbestand bevat niet exact de acht toegestane sleutels." >&2; exit 20; }
rm -f "$keys_file"

grep -Eq "^DEPLOY_TARGET=${target}\r?$" "$temp_file"
grep -Eq '^DB_HOST=localhost\r?$' "$temp_file"
grep -Eq '^DB_PORT=3306\r?$' "$temp_file"
grep -Eq '^TRUST_PROXY=1\r?$' "$temp_file"
case "$target" in
  acceptatie)
    grep -Eq '^DB_NAME=cn111993_acceptatie\r?$' "$temp_file"
    grep -Eq '^DB_USER=cn111993_acceptatie\r?$' "$temp_file"
    ;;
  portaal)
    grep -Eq '^DB_NAME=cn111993_portaal\r?$' "$temp_file"
    grep -Eq '^DB_USER=cn111993_portaal\r?$' "$temp_file"
    ;;
  *) exit 20;;
esac

node_prefix="/home/$remote_user/nodevenv${remote_dir#"/home/$remote_user"}"
node_real="$(CDPATH= cd -P "$node_bin" 2>/dev/null && pwd -P)"
case "$node_real" in "$node_prefix"/20*/bin) ;; *) echo "Nodevenv ontsnapt uit app-specifieke map." >&2; exit 20;; esac
PATH="$node_real:$PATH"
export PATH
echo ">> 3. Node 20 + lsnode require()-compatibiliteit controleren"
NODE_ENV=production SECRETS_FILE="$temp_file" PORT=0 node --input-type=commonjs --eval '
  const { once } = require("node:events");
  const entry = require(process.argv[1]);
  if (!entry.startupPromise || typeof entry.startupPromise.then !== "function") {
    throw new Error("startupPromise ontbreekt");
  }
  entry.startupPromise.then(async (server) => {
    if (!server.listening) await once(server, "listening");
    server.close((error) => { if (error) throw error; });
  }).catch((error) => { console.error(error); process.exitCode = 1; });
' "$remote_dir/src/start.js"

if [ -f "$secrets_file" ] && cmp -s "$temp_file" "$secrets_file"; then
  rm -f "$temp_file"
  result="ongewijzigd"
else
  mv -f "$temp_file" "$secrets_file"
  result="bijgewerkt"
fi
# Laatste muterende stap: het definitieve secretsbestand is uitsluitend owner-read/write.
chmod 600 "$secrets_file"
test "$(stat -c '%a' "$secrets_file")" = "600"
echo ">> PROVISIONING GROEN: target=$target secrets=$result Node=20 lsnode=require-ok"
REMOTE_FINALIZE

trap - EXIT HUP INT TERM
echo ">> G3 GROEN: $TARGET is idempotent ingericht; DirectAdmin-controles staan in docs/gates/provisioning-runbook.md."
