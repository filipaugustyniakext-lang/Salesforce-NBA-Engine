#!/usr/bin/env bash
# Replace force-app with the metadata currently in a Salesforce org.
# Run this from the repo root in Code Builder (or any machine already logged in).
#
# Usage:
#   ./scripts/snapshot-org-to-force-app.sh <org-alias-or-username>
#
# What it does:
#   1. Builds a package.xml of unmanaged metadata in the org.
#   2. Moves force-app aside, retrieves into a fresh force-app.
#   3. Blanks MCE Client_Secret__c if the retrieve brought a value back.
#   4. Leaves the result uncommitted so you can review `git status` before pushing main.
set -euo pipefail

ORG="${1:-}"
if [[ -z "$ORG" ]]; then
  echo "Usage: $0 <org-alias-or-username>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v sf >/dev/null 2>&1; then
  echo "Salesforce CLI (sf) is not on PATH." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean (including staged files). Commit or stash first, then re-run." >&2
  git status --short >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MANIFEST_DIR="$ROOT/manifest/org-snapshot-$STAMP"
BACKUP="$ROOT/.org-snapshot-backup-$STAMP"
mkdir -p "$MANIFEST_DIR"

echo "Building manifest from org: $ORG"
# Unmanaged metadata only (managed and unlocked packages stay out).
# Settings and profiles are excluded: they are org-wide, huge, and not this app's source.
sf project generate manifest \
  --from-org "$ORG" \
  --output-dir "$MANIFEST_DIR" \
  --name package.xml \
  --excluded-metadata Settings \
  --excluded-metadata Profile \
  --excluded-metadata ProfilePasswordPolicy \
  --excluded-metadata ProfileSessionSetting \
  --excluded-metadata SharingRules \
  --excluded-metadata CustomIndex \
  --api-version 66.0

echo "Moving current force-app to $BACKUP"
mv "$ROOT/force-app" "$BACKUP"
mkdir -p "$ROOT/force-app"

set +e
sf project retrieve start \
  --manifest "$MANIFEST_DIR/package.xml" \
  --target-org "$ORG" \
  --wait 60 \
  --ignore-conflicts
RETRIEVE_STATUS=$?
set -e

if [[ "$RETRIEVE_STATUS" -ne 0 ]]; then
  echo "Retrieve failed ($RETRIEVE_STATUS). Restoring previous force-app." >&2
  rm -rf "$ROOT/force-app"
  mv "$BACKUP" "$ROOT/force-app"
  exit "$RETRIEVE_STATUS"
fi

SECRET="$ROOT/force-app/main/default/customMetadata/MCE_Settings__mdt.Default.md-meta.xml"
if [[ -f "$SECRET" ]]; then
  python3 - "$SECRET" << 'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
needle = "<field>Client_Secret__c</field>"
if needle not in text:
    sys.exit(0)
parts = text.split(needle, 1)
head, tail = parts
# Blank only the value element that follows this field.
import re
tail2, n = re.subn(
    r"(<value xsi:type=\"xsd:string\">)[^<]*(</value>)",
    r"\1\2",
    tail,
    count=1,
)
if n:
    path.write_text(head + needle + tail2)
    print("Cleared Client_Secret__c so it is not committed.")
PY
fi

echo
echo "Org snapshot is in force-app. Previous source is in:"
echo "  $BACKUP"
echo "Manifest:"
echo "  $MANIFEST_DIR/package.xml"
echo
echo "Review, then publish main:"
echo "  git checkout main && git pull origin main"
echo "  git add -A force-app manifest"
echo "  git commit -m 'chore: replace force-app with org snapshot'"
echo "  git push origin main"
echo
echo "Remove the backup only after you are satisfied:"
echo "  rm -rf $BACKUP"
