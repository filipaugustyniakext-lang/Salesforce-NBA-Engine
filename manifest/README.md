# Metadata manifests and source of truth

**Day-to-day development:** Git **`main`** is the source of truth for Client Activation Center metadata. Merge feature branches into `main` before sandbox deploys when possible. For Copy Center, use the unified manifest described in [DEPLOY-COPY-CENTER.md](./DEPLOY-COPY-CENTER.md) so Apex, triggers, and LWCs stay in sync.

## Make the Salesforce org the source of truth (snapshot reset)

Git `main` and the org can still diverge after manual org edits. To reset the repo to **what is deployed now**, run the snapshot on a machine that is already logged into that org (Code Builder).

## Replace `force-app` with the org

```bash
cd /home/codebuilder/client-activation-center
git fetch origin
git checkout main
git pull origin main
chmod +x scripts/snapshot-org-to-force-app.sh
./scripts/snapshot-org-to-force-app.sh <org-alias-or-username>
```

The script:

1. Builds a manifest of **unmanaged** metadata currently in the org.
2. Moves the existing `force-app` aside and retrieves into a new `force-app`.
3. Clears `Client_Secret__c` if Marketing Cloud settings come back with a secret.
4. Stops before commit so you can review the diff.

Then publish that snapshot as `main`:

```bash
git add -A force-app manifest
git status
git commit -m "chore: replace force-app with the deployed org snapshot"
git push origin main
```

That push is a normal update of `main`. It replaces Salesforce source with the org. It does not delete `core-sf-channel-templates` or other non-metadata files, because those are not in the org.

## What “everything deployed” includes

`sf project generate manifest --from-org` lists unmanaged metadata and skips managed and unlocked packages. The script also skips Settings and Profiles: those are org-wide, very large, and not the Client Activation Center source.

After the snapshot, the org’s copy of the wizard and the Campaign tab is what `main` will contain. If From/To or the tier-modal comment differ from an older git branch, the org version wins.

## Narrower retrieve

`client-activation-center-retrieve.xml` lists only the metadata types already in this repository. Use it to refresh those members without dropping files the org does not return:

```bash
sf project retrieve start --manifest manifest/client-activation-center-retrieve.xml --target-org <alias>
```

Regenerate that file after local metadata changes:

```bash
python3 scripts/generate-retrieve-manifest.py
```
