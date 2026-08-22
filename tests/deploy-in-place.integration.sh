#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT="${1:-$PROJECT_ROOT/dist/alv-digitaal-app-v0.2.0.tgz}"
[[ -f "$ARTIFACT" ]] || { echo "Testartefact ontbreekt: $ARTIFACT" >&2; exit 1; }
command -v rsync >/dev/null 2>&1 || { echo "rsync is vereist voor de deploy-integratietest." >&2; exit 1; }

TEST_USER="$(id -un)"
TEST_HOME="/home/$TEST_USER"
mkdir -p "$TEST_HOME/domains" "$TEST_HOME/secrets" "$TEST_HOME/nodevenv"
TEST_BASE="$(mktemp -d "$TEST_HOME/domains/alv-in-place-test.XXXXXX")"
REMOTE_DIR="$TEST_BASE/nodeapp"
REMOTE_DEPLOY_ROOT="${REMOTE_DIR}.deploy"
NODE_ENV_TEST_BASE="$TEST_HOME/nodevenv${TEST_BASE#"$TEST_HOME"}"
NODE_ENV_ROOT="$NODE_ENV_TEST_BASE/nodeapp/20"
NODE_BIN="$NODE_ENV_ROOT/bin"
mkdir -p "$NODE_BIN"
SECRETS_FILE="$(mktemp "$TEST_HOME/secrets/alv-acceptatie-test.XXXXXX.env")"
FAKE_BIN="$(mktemp -d)"
HEALTH_STATE="$(mktemp)"
NPM_STATE="$(mktemp)"
STDERR_OUTPUT="$(mktemp)"

cleanup() {
  rm -rf "$TEST_BASE" "$REMOTE_DEPLOY_ROOT" "$NODE_ENV_TEST_BASE" "$FAKE_BIN"
  rm -f "$SECRETS_FILE" "$HEALTH_STATE" "$NPM_STATE" "$STDERR_OUTPUT"
}
trap cleanup EXIT

cat > "$FAKE_BIN/ssh" <<'FAKE_SSH'
#!/usr/bin/env bash
set -eu
while (($# > 0)); do
  case "$1" in
    -p|-o) shift 2 ;;
    *) shift; break ;;
  esac
done
exec "$@"
FAKE_SSH

cat > "$FAKE_BIN/scp" <<'FAKE_SCP'
#!/usr/bin/env bash
set -eu
while (($# > 0)); do
  case "$1" in
    -P|-o) shift 2 ;;
    *) break ;;
  esac
done
source_file="$1"
destination="${2#*:}"
cp "$source_file" "$destination"
FAKE_SCP

cat > "$FAKE_BIN/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -eu
if grep -qx success "$FAKE_HEALTH_STATE"; then
  printf '{"ok":true,"database":"up"}\n'
  exit 0
fi
exit 22
FAKE_CURL

cat > "$FAKE_BIN/sleep" <<'FAKE_SLEEP'
#!/usr/bin/env sh
exit 0
FAKE_SLEEP

cat > "$NODE_BIN/npm" <<'FAKE_NPM'
#!/usr/bin/env bash
set -eu
[[ "${1:-}" = "ci" ]] || { echo "Onverwachte npm-aanroep in deploytest." >&2; exit 90; }
if grep -qx fail-once "$FAKE_NPM_STATE"; then
  printf 'success\n' > "$FAKE_NPM_STATE"
  echo "Gesimuleerde npm-installatiefout." >&2
  exit 91
fi
mkdir -p node_modules
printf 'fake npm ci\n' > node_modules/.deploy-test
FAKE_NPM
cat > "$NODE_BIN/node" <<'FAKE_NODE'
#!/usr/bin/env sh
exit 0
FAKE_NODE
chmod 700 "$FAKE_BIN/ssh" "$FAKE_BIN/scp" "$FAKE_BIN/curl" "$FAKE_BIN/sleep" "$NODE_BIN/npm" "$NODE_BIN/node"

mkdir -p "$REMOTE_DIR/src" "$REMOTE_DIR/public"
printf 'oude code\n' > "$REMOTE_DIR/src/old.txt"
printf 'oude asset\n' > "$REMOTE_DIR/public/old.txt"
printf '{"name":"oude-app","version":"0.1.0","private":true}\n' > "$REMOTE_DIR/package.json"
printf '{"name":"oude-app","version":"0.1.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"oude-app","version":"0.1.0"}}}\n' > "$REMOTE_DIR/package-lock.json"

cat > "$SECRETS_FILE" <<'TEST_SECRETS'
DEPLOY_TARGET=acceptatie
DB_HOST=localhost
DB_NAME=cn111993_acceptatie
DB_USER=cn111993_acceptatie
DB_PASSWORD=fictief
AUTH_PEPPER=abcdefghijklmnopqrstuvwxyz-123456
TRUST_PROXY=1
TEST_SECRETS
chmod 600 "$SECRETS_FILE"

export PATH="$FAKE_BIN:$PATH"
export FAKE_HEALTH_STATE="$HEALTH_STATE"
export FAKE_NPM_STATE="$NPM_STATE"
export ACCEPTATIE_SSH_HOST="${TEST_USER}@test.invalid"
export ACCEPTATIE_SSH_PORT=26
export ACCEPTATIE_REMOTE_DIR="$REMOTE_DIR"
export ACCEPTATIE_NODE_BIN="$NODE_BIN"
export ACCEPTATIE_SECRETS_FILE="$SECRETS_FILE"
export DEPLOY_COMMIT_SHA=1111111111111111111111111111111111111111

saved_node_bin="$ACCEPTATIE_NODE_BIN"
unset ACCEPTATIE_NODE_BIN
set +e
"$PROJECT_ROOT/scripts/deploy.sh" --target acceptatie --dry-run >/dev/null 2>&1
missing_node_bin_status=$?
set -e
[[ "$missing_node_bin_status" -eq 2 ]] || { echo "Deploy zonder nodevenv-bin gaf $missing_node_bin_status in plaats van 2." >&2; exit 1; }
export ACCEPTATIE_NODE_BIN="$FAKE_BIN"
set +e
"$PROJECT_ROOT/scripts/deploy.sh" --target acceptatie --dry-run >/dev/null 2>&1
unsafe_node_bin_status=$?
set -e
[[ "$unsafe_node_bin_status" -eq 2 ]] || { echo "Deploy met nodevenv-bin buiten /home/<user>/nodevenv gaf $unsafe_node_bin_status in plaats van 2." >&2; exit 1; }
export ACCEPTATIE_NODE_BIN="$NODE_ENV_TEST_BASE/nodeapp/20/bin/../bin"
set +e
"$PROJECT_ROOT/scripts/deploy.sh" --target acceptatie --dry-run >/dev/null 2>&1
traversal_node_bin_status=$?
set -e
[[ "$traversal_node_bin_status" -eq 2 ]] || { echo "Deploy met pad-ontsnapping in nodevenv-bin gaf $traversal_node_bin_status in plaats van 2." >&2; exit 1; }
export ACCEPTATIE_NODE_BIN="/home/andere_gebruiker/nodevenv${REMOTE_DIR#"$TEST_HOME"}/20/bin"
set +e
"$PROJECT_ROOT/scripts/deploy.sh" --target acceptatie --dry-run >/dev/null 2>&1
other_user_node_bin_status=$?
set -e
[[ "$other_user_node_bin_status" -eq 2 ]] || { echo "Deploy met nodevenv van een andere gebruiker gaf $other_user_node_bin_status in plaats van 2." >&2; exit 1; }
export ACCEPTATIE_NODE_BIN="$NODE_ENV_TEST_BASE/nodeapp/21/bin"
set +e
"$PROJECT_ROOT/scripts/deploy.sh" --target acceptatie --confirm-no-open-round --artifact "$ARTIFACT" >/dev/null 2>&1
missing_remote_node_bin_status=$?
set -e
[[ "$missing_remote_node_bin_status" -eq 10 ]] || { echo "Deploy met ontbrekende remote nodevenv-versie gaf $missing_remote_node_bin_status in plaats van 10." >&2; exit 1; }
export ACCEPTATIE_NODE_BIN="$saved_node_bin"

set +e
"$PROJECT_ROOT/scripts/deploy.sh" --target acceptatie --artifact "$ARTIFACT" >/dev/null 2>&1
missing_window_status=$?
set -e
[[ "$missing_window_status" -eq 4 ]] || { echo "Deploy zonder open-rondebevestiging gaf $missing_window_status in plaats van 4." >&2; exit 1; }

printf 'success\n' > "$HEALTH_STATE"
printf 'success\n' > "$NPM_STATE"
"$PROJECT_ROOT/scripts/deploy.sh" --target acceptatie --confirm-no-open-round --artifact "$ARTIFACT"
[[ -f "$REMOTE_DIR/src/start.js" ]]
[[ -f "$REMOTE_DIR/public/deelnemen/index.html" ]]
[[ ! -e "$REMOTE_DIR/current" ]]
[[ -f "$REMOTE_DIR/tmp/restart.txt" ]]
[[ -f "$REMOTE_DIR/node_modules/.deploy-test" ]]
first_backup="$(find "$REMOTE_DEPLOY_ROOT/backups" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[[ -f "$first_backup/.backup-ready" ]]
[[ "$(cat "$first_backup/managed/src/old.txt")" = "oude code" ]]
[[ "$(cat "$first_backup/managed/public/old.txt")" = "oude asset" ]]

printf 'stabiele code vóór fout\n' > "$REMOTE_DIR/src/rollback-marker.txt"
printf 'stabiele asset vóór fout\n' > "$REMOTE_DIR/public/rollback-marker.txt"
printf 'ERR_REQUIRE_ASYNC_MODULE: testmarker\nDB_PASSWORD = dotenv-mag-niet\n{"AUTH_PEPPER":"json-mag-niet"}\nmysql://stemmer:uri-mag-niet@localhost/alv\n' > "$REMOTE_DIR/stderr.log"
printf 'failure\n' > "$HEALTH_STATE"
set +e
"$PROJECT_ROOT/scripts/deploy.sh" --target acceptatie --confirm-no-open-round --artifact "$ARTIFACT" >"$STDERR_OUTPUT" 2>&1
rollback_status=$?
set -e
[[ "$rollback_status" -eq 20 ]] || { echo "Rode healthcheck gaf $rollback_status in plaats van 20." >&2; exit 1; }
grep -q 'ERR_REQUIRE_ASYNC_MODULE: testmarker' "$STDERR_OUTPUT"
grep -q 'DB_PASSWORD =\[REDACTED\]' "$STDERR_OUTPUT"
grep -q '"AUTH_PEPPER":"\[REDACTED\]"' "$STDERR_OUTPUT"
grep -q 'mysql://stemmer:\[REDACTED\]@localhost/alv' "$STDERR_OUTPUT"
! grep -Eq 'dotenv-mag-niet|json-mag-niet|uri-mag-niet' "$STDERR_OUTPUT"
[[ "$(cat "$REMOTE_DIR/src/rollback-marker.txt")" = "stabiele code vóór fout" ]]
[[ "$(cat "$REMOTE_DIR/public/rollback-marker.txt")" = "stabiele asset vóór fout" ]]
[[ -f "$REMOTE_DIR/tmp/restart.txt" ]]
[[ ! -e "$REMOTE_DIR/current" ]]

printf 'stabiele code vóór installatiefout\n' > "$REMOTE_DIR/src/rollback-marker.txt"
printf 'stabiele asset vóór installatiefout\n' > "$REMOTE_DIR/public/rollback-marker.txt"
printf 'success\n' > "$HEALTH_STATE"
printf 'fail-once\n' > "$NPM_STATE"
set +e
"$PROJECT_ROOT/scripts/deploy.sh" --target acceptatie --confirm-no-open-round --artifact "$ARTIFACT"
install_failure_status=$?
set -e
[[ "$install_failure_status" -eq 19 ]] || { echo "Installatiefout gaf $install_failure_status in plaats van 19." >&2; exit 1; }
[[ "$(cat "$REMOTE_DIR/src/rollback-marker.txt")" = "stabiele code vóór installatiefout" ]]
[[ "$(cat "$REMOTE_DIR/public/rollback-marker.txt")" = "stabiele asset vóór installatiefout" ]]
[[ -f "$REMOTE_DIR/tmp/restart.txt" ]]
[[ ! -e "$REMOTE_DIR/current" ]]

echo "CloudLinux in-place deploytest: GROEN — backup, installatiefout-rollback en health-rollback werken zonder current-symlink."
