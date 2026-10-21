# Marketing App Campaign record — Details & Related enhancement

The **Marketing** app Campaign workspace (Overview, Brief, Details, Related, Flows, Journeys, etc.) is the standard Salesforce Marketing record experience. **Do not replace** that Lightning record page.

Enhance only **Details** and **Related** using metadata + two lightweight components.

## 1. Page layout (Details tab)

**Marketing Campaign Layout** (`Campaign-Marketing Campaign Layout`) drives the Details field sections (Step 1–4). Assign it to the **Marketing Campaign** record type for NBA users.

Deployed sections include exclusions fields and enriched related list definitions used on the Related tab.

## 2. Custom components (one bundle, two placements)

**Component:** `campaignMarketingRecordPanels`  
**Property:** `Panel Mode`

| Placement | Panel Mode | Content |
|-----------|------------|---------|
| **Details** tab (bottom of field sections) | `details` | Step 1 exclusions table (from JSON), Step 3 copy runtime health |
| **Related** tab (top, above standard lists) | `related` | Full **Campaign offers** and **Campaign copy variants** tables with live eligibility |

### App Builder steps (once per org)

1. Open any **Marketing Campaign** record in the Marketing app.
2. **Setup (gear) → Edit Page** (opens the Marketing Campaign record page — not a new page).
3. Select the **Details** tab region → drag **Campaign Marketing Record Panels** below the detail fields → set **Panel Mode** = `details`.
4. Select the **Related** tab region → drag a second instance (or the same component) → set **Panel Mode** = `related`.
5. **Save** → **Activation** → assign to Marketing app / profiles as needed.

Standard Marketing features (Flows, Journeys, Personalization, Performance) stay on the left nav unchanged.

## 3. Related list columns (fallback)

The layout also defines related lists with **Offer**, **Offer Status**, **Message Variant**, and **Eligible Now** formula columns if you keep the standard related lists visible below the custom panel.

## 4. Do not use

`Campaign_Marketing_Record_Page` was removed — it replaced the whole record page and hid Marketing workspace features.
