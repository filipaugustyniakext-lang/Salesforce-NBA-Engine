# Client Activation Center development branch

Use branch **`cursor/cac-development-workspace-be82`** (or its descendants) for day-to-day CAC work.

## What this branch contains

- **`force-app/`** — CAC-only Salesforce metadata, materialized from the sandbox org snapshot on `main` (commit `9f2be7a`), not the full org export (~19k files).
- **`core-sf-channel-templates/`** — channel template reference assets (not deployed as-is; used for Copy Center previews and manifests).
- **`manifest/client-activation-center-retrieve.xml`** — deploy/retrieve manifest generated from this trimmed tree.

`main` keeps the **full org snapshot** for audit and recovery. Do not develop on `main` unless you intentionally change org-wide metadata.

## Rebuild CAC `force-app` after refreshing `main`

```bash
git checkout main && git pull origin main
git checkout cursor/cac-development-workspace-be82
git merge main   # or rebase; resolve force-app by re-running the builder
python3 scripts/build-cac-force-app.py
python3 scripts/generate-retrieve-manifest.py
git add force-app manifest/client-activation-center-retrieve.xml
git commit -m "chore: refresh CAC force-app from main org snapshot"
```

## Deploy to sandbox

```bash
sf project deploy start \
  --manifest manifest/client-activation-center-retrieve.xml \
  --target-org cac-sandbox
```

Assign permission set **Client Activation Center** and set **MCE Settings** client secret in the org after deploy (secret is blank in git).

## Copy Center: MCE and Data 360

| Feature | Metadata |
|---------|----------|
| **Sync with MCE** (UI) | `copyCockpit`, `MarketingCloudCopySync.syncWithMCE` |
| **Scheduled MCE sync** | `MCEContentCenterHourlySyncScheduler` → `MCEContentCenterHourlySyncQueueable` → `MarketingCloudCopySync.syncAllWithMCE()` (15-minute lookback) |
| **Push to D360** | `FlowInit_TriggerDataSourceObjectRefresh`, flow `FL_Trigger_DataStreamObject_Refresh` |

After deploy, schedule incremental MCE sync in the org (Scheduled Jobs) if it is not already present:

```text
Cron: 0 */15 * * * ?
Class: MCEContentCenterHourlySyncScheduler
```

The Copy Center **Push to D360** action still uses a sandbox-specific Data Stream Object Id in `copyCockpit.js`; replace it per environment or wire channel → DSO mapping when that metadata is in git.

## Included scope (summary)

| Area | Examples |
|------|----------|
| Copy Center | `copyCockpit*`, `CopyCockpitController`, `MarketingCloudCopySync`, `FlowInit_TriggerDataSourceObjectRefresh`, `FL_Trigger_DataStreamObject_Refresh`, `CC_Message_*` |
| Marketing Dictionary | `marketingDictionary*`, `MarketingDictionary*Controller`, `Marketing_Dictionary__c` |
| Campaign wizard | `agentforceCampaignWizard`, `CampaignOfferingLabelSync`, `Campaign` fields |
| Offers & products | `offerManager`, `productManager`, `Offer__c`, `Product2` extensions |
| Channel templates | `channelTemplateManager`, `Channel_Template__c`, banner/cooldown objects |
| Blackout & scoring | blackout tabs, `Scoring_Model_Setting__c`, scoring tab LWC |
| Security | `ClientActivationCenter` permission set, Marketing Cloud remote sites, MCE custom metadata type |

Utility-bar flexipages, sample resort agents, Wave Analytics, and org-wide CRM sample metadata are **excluded**.
