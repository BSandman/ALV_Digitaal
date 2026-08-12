#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_USER="$(id -un)"
TEST_HOME="/home/$TEST_USER"
mkdir -p "$TEST_HOME/domains" "$TEST_HOME/secrets" "$TEST_HOME/nodevenv"
TEST_BASE="$(mktemp -d "$TEST_HOME/domains/alv-provision-test.XXXXXX")"
REMOTE_DIR="$TEST_BASE/nodeapp"
NODE_ROOT="$TEST_HOME/nodevenv${REMOTE_DIR#"$TEST_HOME"}/20"
NODE_BIN="$NODE_ROOT/bin"
SECRETS_FILE="$TEST_HOME/secrets/alv-acceptatie.env"
SOURCE_DIR="$PROJECT_ROOT/mistral-lokaal/secure"
SOURCE_FILE="$SOURCE_DIR/alv-acceptatie.env"
FAKE_BIN="$(mktemp -d)"
SSH_STATE="$(mktemp)"
NODE_STATE="$(mktemp)"
REAL_NODE_BIN="$(command -v node)"
ORIGINAL_SECRETS_BACKUP=""

if [[ -e "$SECRETS_FILE" ]]; then
  ORIGINAL_SECRETS_BACKUP="$(mktemp)"
  cp "$SECRETS_FILE" "$ORIGINAL_SECRETS_BACKUP"
fi

cleanup() {
  rm -rf "$TEST_BASE" "$TEST_HOME/nodevenv${TEST_BASE#"$TEST_HOME"}" "$FAKE_BIN"
  rm -f "$SOURCE_FILE" "$SSH_STATE" "$NODE_STATE"
  if [[ -n "$ORIGINAL_SECRETS_BACKUP" ]]; then
    cp "$ORIGINAL_SECRETS_BACKUP" "$SECRETS_FILE"
    chmod 600 "$SECRETS_FILE"
    rm -f "$ORIGINAL_SECRETS_BACKUP"
  else
    rm -f "$SECRETS_FILE"
  fi
}
trap cleanup EXIT

mkdir -p "$REMOTE_DIR/src" "$NODE_BIN" "$SOURCE_DIR"
cat > "$REMOTE_DIR/package.json" <<'JSON'
{"name":"provision-test","private":true,"type":"module"}
JSON
cat > "$REMOTE_DIR/src/start.js" <<'JS'
export const startupPromise = Promise.resolve({
  listening: true,
  close(callback) { callback(); }
});
JS

cat > "$FAKE_BIN/ssh" <<'FAKE_SSH'
#!/usr/bin/env bash
set -eu
printf 'ssh\n' >> "$FAKE_SSH_STATE"
while (($# > 0)); do
  case "$1" in
    -p|-o) shift 2 ;;
    *) shift; break ;;
  esac
done
exec "$@"
FAKE_SSH

cat > "$FAKE_BIN/git" <<'FAKE_GIT'
#!/usr/bin/env bash
set -eu
if [[ "${1:-}" == "-C" && "${3:-}" == "check-ignore" ]]; then
  candidate="${@: -1}"
  case "$candidate" in */mistral-lokaal/secure/*) exit 0;; *) exit 1;; esac
fi
echo "Onverwachte git-aanroep in provisioningtest." >&2
exit 90
FAKE_GIT

cat > "$NODE_BIN/node" <<'FAKE_NODE'
#!/usr/bin/env bash
set -eu
if [[ "${1:-}" == "--version" ]]; then
  echo "${FAKE_REMOTE_NODE_VERSION:-v20.19.0}"
  exit 0
fi
printf '%s\n' "$*" >> "$FAKE_NODE_STATE"
exec "$REAL_NODE_BIN" "$@"
FAKE_NODE
chmod 700 "$FAKE_BIN/ssh" "$FAKE_BIN/git" "$NODE_BIN/node"

write_source() {
  local password="$1"
  cat > "$SOURCE_FILE" <<EOF
DEPLOY_TARGET=acceptatie
DB_HOST=localhost
DB_PORT=3306
DB_NAME=cn111993_acceptatie
DB_USER=cn111993_acceptatie
DB_PASSWORD=$password
AUTH_PEPPER=abcdefghijklmnopqrstuvwxyz-123456
TRUST_PROXY=1
EOF
  chmod 600 "$SOURCE_FILE"
}

write_source 'fictief-eerste-wachtwoord'
export PATH="$FAKE_BIN:$PATH"
export FAKE_SSH_STATE="$SSH_STATE"
export FAKE_NODE_STATE="$NODE_STATE"
export FAKE_REMOTE_NODE_VERSION='v20.19.0'
export REAL_NODE_BIN
export ACCEPTATIE_SSH_HOST="$TEST_USER@test.invalid"
export ACCEPTATIE_SSH_PORT=26
export ACCEPTATIE_REMOTE_DIR="$REMOTE_DIR"
export ACCEPTATIE_NODE_BIN="$NODE_BIN"
export ACCEPTATIE_SECRETS_FILE="$SECRETS_FILE"

"$PROJECT_ROOT/scripts/provision_env.sh" --target acceptatie --dry-run
[[ ! -s "$SSH_STATE" ]] || { echo "Dry-run maakte onverwacht een SSH-verbinding." >&2; exit 1; }

set +e
"$PROJECT_ROOT/scripts/provision_env.sh" --target acceptatie \
  --secrets-source "$PROJECT_ROOT/infra/.env.example" --dry-run >/dev/null 2>&1
tracked_source_status=$?
set -e
[[ "$tracked_source_status" -eq 2 ]] || { echo "Niet-genegeerde bron gaf $tracked_source_status i.p.v. 2." >&2; exit 1; }

set +e
"$PROJECT_ROOT/scripts/provision_env.sh" --target portaal --dry-run >/dev/null 2>&1
production_gate_status=$?
set -e
[[ "$production_gate_status" -eq 3 ]] || { echo "Portaal zonder dubbele poort gaf $production_gate_status i.p.v. 3." >&2; exit 1; }

saved_node_bin="$ACCEPTATIE_NODE_BIN"
export ACCEPTATIE_NODE_BIN="${NODE_BIN%/20/bin}/21/bin"
set +e
"$PROJECT_ROOT/scripts/provision_env.sh" --target acceptatie --dry-run >/dev/null 2>&1
wrong_node_path_status=$?
set -e
[[ "$wrong_node_path_status" -eq 2 ]] || { echo "Node-21-pad gaf $wrong_node_path_status i.p.v. 2." >&2; exit 1; }
export ACCEPTATIE_NODE_BIN="$saved_node_bin"

export FAKE_REMOTE_NODE_VERSION='v21.1.0'
set +e
"$PROJECT_ROOT/scripts/provision_env.sh" --target acceptatie >/dev/null 2>&1
wrong_remote_node_status=$?
set -e
[[ "$wrong_remote_node_status" -eq 10 ]] || { echo "Remote Node 21 gaf $wrong_remote_node_status i.p.v. 10." >&2; exit 1; }
export FAKE_REMOTE_NODE_VERSION='v20.19.0'

mv "$REMOTE_DIR/src/start.js" "$REMOTE_DIR/src/start.js.afwezig"
set +e
"$PROJECT_ROOT/scripts/provision_env.sh" --target acceptatie >/dev/null 2>&1
missing_entry_status=$?
set -e
[[ "$missing_entry_status" -eq 10 ]] || { echo "Ontbrekende startentry gaf $missing_entry_status i.p.v. 10." >&2; exit 1; }
mv "$REMOTE_DIR/src/start.js.afwezig" "$REMOTE_DIR/src/start.js"

"$PROJECT_ROOT/scripts/provision_env.sh" --target acceptatie
cmp -s "$SOURCE_FILE" "$SECRETS_FILE"
[[ "$(stat -c '%a' "$SECRETS_FILE")" == "600" ]]
grep -q -- '--input-type=commonjs' "$NODE_STATE"
first_mtime="$(stat -c '%Y' "$SECRETS_FILE")"

"$PROJECT_ROOT/scripts/provision_env.sh" --target acceptatie
second_mtime="$(stat -c '%Y' "$SECRETS_FILE")"
[[ "$first_mtime" == "$second_mtime" ]] || { echo "Idempotente run wijzigde het secretsbestand." >&2; exit 1; }

write_source 'fictief-geroteerd-wachtwoord'
"$PROJECT_ROOT/scripts/provision_env.sh" --target acceptatie
grep -qx 'DB_PASSWORD=fictief-geroteerd-wachtwoord' "$SECRETS_FILE"
[[ "$(stat -c '%a' "$SECRETS_FILE")" == "600" ]]

printf 'NODE_ENV=production\n' >> "$SOURCE_FILE"
set +e
"$PROJECT_ROOT/scripts/provision_env.sh" --target acceptatie --dry-run >/dev/null 2>&1
forbidden_key_status=$?
set -e
[[ "$forbidden_key_status" -eq 1 ]] || { echo "Verboden sleutel gaf $forbidden_key_status i.p.v. 1." >&2; exit 1; }

echo "Provisioning-integratietest: GROEN — dry-run, productiepoort, atomische installatie, idempotentie, rotatie, chmod 600 en lsnode-check werken."
