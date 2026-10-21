# Marketing App Campaign record — what you can change

## The constraint (your App Builder observation)

On **Campaign Record Page** in the Marketing app, the center panel (left nav: Overview, Brief, **Details**, **Related**, … plus Flows / Journeys / Personalization / Performance) is **one packaged workspace component**.

- You can **move or delete the whole block**, not edit inside **Details** or **Related**.
- **Details** and **Related** content comes from **Setup → Object Manager → Campaign → Page Layouts** (for your record type), not from nested App Builder regions.
- Custom LWCs **cannot** be dropped inside the Details tab on that page.

So enhancement is **metadata + actions**, not flexipage surgery.

---

## 1. Details tab → Page layout only

**Layout:** `Campaign-Marketing Campaign Layout`  
**Assign to:** Record type **Marketing Campaign** (and profiles that use the Marketing app).

This controls:

- Accordion sections (Step 1 — …, Step 2 — …, Step 4 — …)
- Fields on each section (including exclusions JSON, assigned channels, scoring, etc.)

Edit in repo or **Setup → Page Layouts**, then deploy / save. Refresh the campaign **Details** tab to see changes.

---

## 2. Related tab → Page layout related lists

Same layout defines:

- **Campaign Offers** — junction number, **Offer Status** (formula)
- **Campaign Copy Variants** — **Eligible Now** (Published formula), **Is Eligible**
- Standard Marketing lists (Flows, etc.) — unchanged

Reorder or add columns in the layout **Related Lists** section.

---

## 3. Rich wizard + catalogues → Quick Actions (modal)

Because Details/Related cannot host LWCs, use **Screen Actions** from the record action bar (same area as Edit / Delete):

| Action | Opens |
|--------|--------|
| **Campaign Configuration Summary** | Full wizard read-only view (steps 1–4, exclusions table, offers/copy with **eligible now**) |
| **Campaign Catalogues** | Offers + Copy Cockpit tables only (Related-style) |

Metadata:

- `Campaign.Campaign_Configuration_Summary` → `campaignConfigurationView`
- `Campaign.Campaign_Catalogues` → `campaignCataloguesQuickView`

These are on **Marketing Campaign Layout** `platformActionList`. If they do not appear on the Marketing header, add them in **Setup → Object Manager → Campaign → Buttons, Links, and Actions → Page Layout Assignment** or the Marketing **Salesforce Mobile and Lightning Experience Actions** editor for that layout.

---

## 4. What not to do

- Do **not** replace the Marketing workspace with a custom-only Lightning record page (you lose Flows, Journeys, Personalization, Performance).
- Do **not** expect **Campaign Configuration View** inside the Details tab without removing the entire Marketing block.

---

## 5. Wizard edits

Use existing **agentforceCampaignWizard** (App Builder component or quick action, depending on org setup) to change policy; use **Configuration Summary** quick action to review it.
