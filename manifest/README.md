# Salesforce DX retrieve (Client Activation Center)

Use these commands from a machine where the Salesforce CLI is installed and your sandbox or scratch org is authorized (for example Code Builder).

## Option A — Retrieve everything this repo tracks (recommended)

Updates local files under `force-app` with whatever is currently deployed in the org:

```bash
sf org login web --alias cac-dev --set-default
sf project retrieve start --source-dir force-app --target-org cac-dev
```

Compare the result with git to see org vs repo drift (missing wizard dates, old LWC bundles, and so on).

## Option B — Retrieve using the generated manifest

`client-activation-center-retrieve.xml` lists metadata types and members that exist in this repository (Apex, LWC, objects, permission sets, tabs, flexipages, MCE settings, and related pieces).

```bash
sf project retrieve start --manifest manifest/client-activation-center-retrieve.xml --target-org cac-dev
```

## Option C — Quick check for the two reported UI issues

```bash
sf project retrieve start \
  --metadata LightningComponentBundle:agentforceCampaignWizard \
  --metadata LightningComponentBundle:marketingDictionaryCampaignTab \
  --target-org cac-dev
```

If the retrieved wizard bundle has no `From` / `To` date inputs under Campaign Name, the org is behind `main` — deploy from git rather than retrieve.

If the campaign tab HTML still contains bare `TIER MODAL` text outside a comment, retrieve will show the broken template until you deploy the fix from `main`.

## Notes

- Retrieve **overwrites** local metadata with org versions. Commit or stash local changes first.
- Custom metadata secrets (for example MCE client secret) may come back empty or omitted depending on org values; do not commit secrets.
- Regenerate the manifest after adding new metadata under `force-app`:

```bash
python3 scripts/generate-retrieve-manifest.py
```

(Or re-run the generation logic documented in the repo history if the script is not present yet.)
