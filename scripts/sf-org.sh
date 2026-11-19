#!/usr/bin/env bash
# Switch the local Salesforce CLI between the saved sandbox and Production logins.
#
# Both orgs use the same username, and the CLI stores one auth file per username.
# The logins themselves stay outside the repo:
#   ~/.sfdx-sandbox/auth.json
#   ~/.sfdx-prod/auth.json
#
# Usage, from anywhere:
#   ./scripts/sf-org.sh sandbox
#   ./scripts/sf-org.sh production
set -euo pipefail

TARGET="${1:-}"
case "$TARGET" in
  sandbox) BACKUP="${HOME}/.sfdx-sandbox/auth.json" ;;
  production) BACKUP="${HOME}/.sfdx-prod/auth.json" ;;
  *)
    echo "Usage: $0 sandbox|production" >&2
    exit 1
    ;;
esac

if [[ ! -f "$BACKUP" ]]; then
  echo "No saved ${TARGET} login at ${BACKUP}." >&2
  echo "Log in once, then copy ~/.sfdx/<username>.json to that path." >&2
  exit 1
fi

if ! command -v sf >/dev/null 2>&1; then
  if [[ -x "${HOME}/.local/bin/sf" ]]; then
    export PATH="${HOME}/.local/bin:${PATH}"
  else
    echo "Salesforce CLI (sf) is not on PATH." >&2
    exit 1
  fi
fi

read_field() {
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], ""))' "$1" "$2"
}

USERNAME="$(read_field "$BACKUP" username)"
INSTANCE="$(read_field "$BACKUP" instanceUrl)"
if [[ -z "$USERNAME" || -z "$INSTANCE" ]]; then
  echo "Saved ${TARGET} login is missing username or instanceUrl." >&2
  exit 1
fi

AUTH_FILE="${HOME}/.sfdx/${USERNAME}.json"
mkdir -p "${HOME}/.sfdx" "${HOME}/.sfdx-sandbox" "${HOME}/.sfdx-prod"

# Keep the login that is active now, so a newer token is not thrown away.
if [[ -f "$AUTH_FILE" ]]; then
  CURRENT="$(read_field "$AUTH_FILE" instanceUrl)"
  case "$CURRENT" in
    *sandbox.my.salesforce.com) cp "$AUTH_FILE" "${HOME}/.sfdx-sandbox/auth.json" ;;
    *unicrediteu.my.salesforce.com) cp "$AUTH_FILE" "${HOME}/.sfdx-prod/auth.json" ;;
  esac
fi

umask 077
cp "$BACKUP" "$AUTH_FILE"
sf alias set "sandbox=${USERNAME}" "production=${USERNAME}" >/dev/null
sf config set "target-org=${TARGET}" >/dev/null

echo "Active org: ${TARGET}"
echo "Instance:   $(read_field "$AUTH_FILE" instanceUrl)"
sf org display --target-org "$TARGET" | awk -F'│' '
  $2 ~ /Connected Status|Username/ || $2 ~ /^ *Id *$/ {
    gsub(/^ +| +$/, "", $2)
    gsub(/^ +| +$/, "", $3)
    print $2 ": " $3
  }
'
