# Marketing App Campaign record — Details & Related

The **Marketing** app Campaign page is a **single flexipage** (e.g. “Campaign Record Page”). It is **not** split into separate App Builder regions per left-nav item (Overview, Details, Related). Those tabs are part of the **Marketing workspace shell**; **Details** typically renders the standard **Record Detail** component, which reads **Campaign page layout** metadata (`Campaign-Marketing Campaign Layout`).

You **cannot** drop LWCs into a “Details region” the way you would on a custom three-column record page. You have two supported paths:

---

## Path A — Page layout only (what you see today)

**Setup → Object Manager → Campaign → Page Layouts → Marketing Campaign Layout**

- Controls the accordion sections on **Details** (Step 1–4 field groups).
- Controls **Related** list columns (Campaign Offers, Campaign Copy Variants, Flows, etc.).

We deploy layout updates (exclusions fields, Offer Status / Eligible Now columns) through metadata. No App Builder change.

**Limitation:** Related lists show junction rows only; rich runtime notes need Path B.

---

## Path B — Campaign Configuration View (recommended wizard UI)

**Component:** `campaignConfigurationView` (label: **Campaign Configuration View**)

Custom LWC already in the org: wizard steps, offers, copy tables, runtime eligibility, Copy Center links.

### Details tab

1. **Edit Page** on the Campaign record (Marketing app).
2. Select the main **Record Detail** block on **Details** (the large panel showing Step 1 / Step 2 sections).
3. **Remove** Record Detail **or** hide it, and add **Campaign Configuration View** in the same slot.
4. Set **View Mode** = `wizard`.

This replaces layout-driven accordions with one wizard-aligned read-only summary (including exclusions JSON and runtime catalogue health).

### Related tab (if the flexipage exposes a slot on that tab)

If App Builder lets you select the **Related** tab content area, add a second **Campaign Configuration View** with **View Mode** = `catalogues` (offers + copy only).

If Related stays layout-only, rely on enhanced related lists on **Marketing Campaign Layout** plus the offers/copy tables inside **View Mode = wizard** on Details.

---

## Path C — Legacy helpers (optional)

- `campaignCatalogHealthPanel` — standalone health card (superseded by Configuration View for Details).
- `campaignMarketingRecordPanels` — same idea split by `panelMode`; prefer **Configuration View**.

---

## Record type

Assign **Marketing Campaign Layout** to the **Marketing Campaign** record type for profiles that use the Marketing app.

---

## Do not use

Standalone **Marketing Campaign Record Page** flexipage (removed) — it replaced the full Marketing workspace (Flows, Journeys, Personalization, Performance).
