# Copy Center — deploy as one unit

Partial deploys (for example only `copyCockpit` LWC or only `CopyCockpitController`) have regressed **MCE SOAP delete** and other cross-cutting behavior. Treat Copy Center as a **single deploy surface**.

## Source of truth

- **`main`** should contain the full Copy Center + MCE delete stack after merges.
- Feature branches (`cursor/*-be82`) are short-lived; merge to `main` before sandbox validation when possible.

## Recommended deploy (sandbox / CI)

```bash
sf project deploy start \
  --target-org cac-sandbox \
  --manifest manifest/package-copy-center-full.xml \
  --test-level NoTestRun
```

This bundle includes:

- Copy Cockpit LWCs (`copyCockpit`, `copyCockpitAddModal`, `copyCockpitEditor`, `copyMessageNaming`)
- Marketing Dictionary Campaign tab (Locales)
- `CopyCockpitController` (variant delete → `MarketingCloudCopyDelete.enqueueVariantDeletes`)
- MCE delete Apex, trigger, delete log object, SOAP remote site, permission set field access

## MCE delete only (hotfix)

```bash
sf project deploy start \
  --target-org cac-sandbox \
  --manifest manifest/package-mce-delete-deploy.xml \
  --test-level NoTestRun
```

Permission set FLS for the delete log (if needed):

```bash
sf project deploy start \
  --target-org cac-sandbox \
  --manifest manifest/package-mce-delete-perms.xml \
  --test-level NoTestRun
```

## Do not

- Deploy **only** `CopyCockpitController` without the MCE delete classes and trigger.
- Deploy **only** LWCs when Apex naming or delete behavior changed in the same change set.

## Refresh manifest from repo

After adding metadata under `force-app/main/default`:

```bash
python3 scripts/generate-retrieve-manifest.py
```
