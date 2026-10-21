# Campaign definition — Salesforce data model

**Status:** Reference for admins, builders, and GateKeeper design  
**Last updated:** 2026-10-21  
**Companion:** [campaign-gatekeeper-architecture.md](./campaign-gatekeeper-architecture.md)

This document explains **where the Agentforce Campaign Wizard stores each setting**, why some values are hard to find on the Campaign detail page, and **recommended record page / related list** exposure.

---

## 1. High-level picture

Campaign **policy** is split across three storage patterns:

| Pattern | Examples | Why |
|--------|----------|-----|
| **Fields on `Campaign`** | Tier, topic, offering, scoring, channels (labels), exclusions JSON | Single record = policy document |
| **Junction objects** | Offers, copy variants | Many-to-many to catalogue objects |
| **Marketing Dictionary (`Marketing_Dictionary__c`)** | Topic, campaign group, scoring model, activation type, channels (master data) | Lookups + tier/campaign-type configuration |

```mermaid
erDiagram
    Campaign ||--o{ Campaign_Offer__c : "selected offers"
    Campaign ||--o{ Campaign_Copy_Variant__c : "assigned copy"
    Campaign_Copy_Variant__c }o--|| CC_Message_Metadata__c : "message variant"
    Campaign_Offer__c }o--|| Offer__c : "offer header"
    Offer__c ||--o{ Offer_Version__c : "active version"
    Campaign }o--o| Marketing_Dictionary__c : "Topic_Dict__c"
    Campaign }o--o| Marketing_Dictionary__c : "Campaign_Group_Dict__c"
    Campaign }o--o| Marketing_Dictionary__c : "Scoring_Model_Dict__c"
    Campaign_Tier__c .. Campaign : "Priority_Tier__c label match"
    CC_Message_Metadata__c }o--o| Campaign : "optional source campaign"
```

**Not on Campaign today:** per-channel copy enablement from wizard step 3 is **derived at edit time** from assigned copy variants + `CC_Message_Metadata__c.Channel_Type__c` — there is no separate “copy channel flags” field on Campaign.

---

## 2. Wizard step → persistence map

### Step 1 — Campaign properties

| Wizard concept | Storage | API / object |
|----------------|---------|----------------|
| Activation type | Campaign field | `Activation_Type__c` (matches Marketing Dictionary **Campaign Type** name) |
| Campaign group | Lookup | `Campaign_Group_Dict__c` → `Marketing_Dictionary__c` (subtype Campaign Group) |
| Active from / to | Campaign fields | `Active_From__c`, `Active_To__c` |
| Duration (always-on) | Campaign field | `Duration_Days__c` |
| Priority tier | Campaign field | `Priority_Tier__c` (text label aligned with `Campaign_Tier__c.Name`) |
| **Channels (step 1)** | Campaign field | `Assigned_Channels__c` — **semicolon-separated channel labels** (not junction, not Dictionary Id) |
| Manual exclusions | Campaign field | `Campaign_Exclusions_JSON__c` (long text JSON) |
| Other marketing activations | Campaign field | `Exclude_Other_Marketing_Activations__c` |
| Legacy single suppressions | Campaign fields | `Suppression_Campaign__c`, `Suppression_Report_Id__c`, `Suppression_Segment__c` |
| Onboarding exclusion (legacy flag) | Campaign field | `Exclude_Onboarding__c` |
| Name / status / active | Standard | `Name`, `Status`, `IsActive` |

**Tier capabilities** (what the wizard *allows*, e.g. manual exclusions, other activations) live on **`Campaign_Tier__c`**, not on Campaign — matched by tier label.

---

### Step 2 — Topic & offering

| Wizard concept | Storage | API / object |
|----------------|---------|----------------|
| Topic | Lookup + denormalized label | `Topic_Dict__c` → `Marketing_Dictionary__c` (Topic); `Topic_Name__c` |
| Offering mode | Campaign field | `Offering_Type__c` — `Product Family` or `Family of Needs` |
| Product families | Campaign fields | `Product_Family_Ids__c` (SSOT Ids), `Product_Family__c` (display names) |
| Families of needs | Campaign fields | `Family_of_Needs_Ids__c`, `Family_of_Needs__c` |
| Selected **offers** | Junction | **`Campaign_Offer__c`**: `Campaign__c`, `Offer__c` |

Offer **details** (status, version, parameters) are **not** duplicated on Campaign. They live on:

- `Offer__c` — header, `Offer_Status__c`
- `Offer_Version__c` — active version row (`Is_Active__c = true`), attractiveness fields, etc.

Wizard save replaces all `Campaign_Offer__c` rows for the campaign (`saveCampaignOffers`).

---

### Step 3 — Channels & copy

| Wizard concept | Storage | Notes |
|----------------|---------|--------|
| Which **dictionary channels** exist / tier allows | Loaded from `Campaign_Tier__c` + channel dictionary | Not saved again on Campaign except step 1 `Assigned_Channels__c` |
| **Copy assignment** | Junction | **`Campaign_Copy_Variant__c`**: `Campaign__c`, `Message_Variant__c` → **`CC_Message_Metadata__c`**, `Is_Eligible__c` |
| Copy **status** (Draft / Ready / Published / …) | Copy Cockpit object | **`CC_Message_Metadata__c.Status__c`** — **not** on the junction row |
| Channel for a message | Copy Cockpit | `CC_Message_Metadata__c.Channel_Type__c`, `Channel__c` |
| MCE / Content Builder ids | Copy Cockpit | e.g. `MCE_Campaign_Id__c`, `Content_Builder_Message_Id__c` |

Wizard save **only persists Published** variants to the junction (`replaceCampaignCopyVariants` filters `Status__c = 'Published'`).

**Why you don’t see “copy status” on Campaign:**  
Status is on **`CC_Message_Metadata__c`**. The Campaign related list **`Campaign Copy Variants`** only shows the junction **`Name`** by default — you must open the **Message Variant** lookup or enhance the related list (see §5).

**Why channels can feel missing:**  
Selected channel **names** are on **`Assigned_Channels__c`** (long text area). They appear on layout section **“Step 1 — Campaign Channels”** in **Marketing Campaign Layout** — if the org uses a different page layout or compact layout, this field may be hidden.

---

### Step 4 — Scoring

| Wizard concept | Storage | API / object |
|----------------|---------|----------------|
| Scoring method | Campaign field | `Scoring_Method__c` — e.g. `A-priori`, `Pick a Model` |
| A-priori score | Campaign field | `Overall_Score__c` |
| Scoring model | Lookup | `Scoring_Model_Dict__c` → `Marketing_Dictionary__c` (Scoring Model) |
| Fallback score | Campaign field | `Fallback_Score__c` |
| Source model (display) | Campaign field | `Source_Model__c` |
| A-priori **shared** topic/FoN scores | Separate objects (org) | `Campaign_Scoring_Apriori_State__c`, `Campaign_Scoring_Apriori_History__c` via `CampaignScoringAprioriController.publishAprioriScores` (Apex referenced by wizard; not all metadata may be in repo) |

Topic-derived score snapshots (if populated elsewhere): `Topic_Overall_Score__c`, `Topic_Ease_Score__c`, `Topic_Loyalization_Score__c`, window/duration topic fields on Campaign.

---

## 3. Marketing Dictionary (master data)

| Dictionary role | Typical `Dictionary_Sub_Type__c` | Referenced from Campaign |
|-----------------|----------------------------------|---------------------------|
| Topic | Topic | `Topic_Dict__c` |
| Campaign group | Campaign Group | `Campaign_Group_Dict__c` |
| Scoring model | Scoring Model | `Scoring_Model_Dict__c` |
| Campaign **type** (activation icon, groups, emergency) | Campaign Type (via `getCampaignTypes`) | Drives `Activation_Type__c` string |
| Product family / FoN / Channel | Product / Channel record types | Wizard picklists; Ids on Campaign offering fields |

**`Campaign_Tier__c`** is its **own object** (not Marketing Dictionary): tier number, description, supported campaign types, exclusion flags (`Excl_Manual_Suppressions__c`, `Excl_Other_Marketing_Activations__c`), etc.

---

## 4. Copy Cockpit vs Campaign assignment

| Question | Where to look |
|----------|----------------|
| All messages for a product/offer in Copy Cockpit | `CC_Message_Metadata__c` (filters: `Offer__c`, `Product_Family__c`, `Channel_Type__c`, `Status__c`) |
| Which messages this **campaign** uses | `Campaign_Copy_Variant__c` WHERE `Campaign__c = :id` |
| Is this copy live? | `CC_Message_Metadata__c.Status__c` = `Published` |
| SFMC / MCE linkage | Fields on `CC_Message_Metadata__c` (MCE_*, Content Builder_*) |

Optional: `CC_Message_Metadata__c.Campaign__c` may point to a **source** campaign for a message; **assignment** for activation is still the junction from the NBA campaign.

---

## 5. Why the detail page feels incomplete today

The repo includes **`Campaign-Marketing Campaign Layout.layout-meta.xml`**, which already groups:

- Step 1 properties, priority, **`Assigned_Channels__c`**
- Step 2 topic & offering fields
- Step 4 scoring fields
- Related lists: **`Campaign_Offer__c`**, **`Campaign_Copy_Variant__c`**, Campaign Members

**Gaps on that layout (as of this doc):**

| Missing on Campaign layout | Impact |
|----------------------------|--------|
| `Campaign_Exclusions_JSON__c` | Exclusions not visible on detail |
| `Exclude_Other_Marketing_Activations__c` | Tier-gated flag not visible |
| Suppression_* legacy fields | Legacy suppressions not visible |
| Related list columns on copy junction | No **Status**, **Channel**, **Message name** without opening lookup |

Lightning **record pages** may not use this layout at all — check **Object Manager → Campaign → Page Layouts** assignment per profile/record type and the **Lightning Record Page** (flexipage) components.

---

## 6. Recommended record page & related lists

### 6.1 Campaign detail — suggested sections

1. **Activation** — `Activation_Type__c`, `Status`, `IsActive`, `Active_From__c`, `Active_To__c`, `Duration_Days__c`, `Campaign_Group_Dict__c`  
2. **Priority & exclusions** — `Priority_Tier__c`, `Exclude_Other_Marketing_Activations__c`, `Exclude_Onboarding__c`, `Campaign_Exclusions_JSON__c` (or a future rich component), legacy `Suppression_*`  
3. **Channels** — `Assigned_Channels__c` (read-only formatted)  
4. **Topic & offering** — `Topic_Dict__c`, `Offering_Type__c`, `Product_Family__c` / `Family_of_Needs__c` (+ Id fields for support)  
5. **Scoring** — `Scoring_Method__c`, `Overall_Score__c`, `Scoring_Model_Dict__c`, `Fallback_Score__c`  
6. **Related** — see below  

### 6.2 Related lists — suggested columns

**Campaign Offers (`Campaign_Offer__c`)**

| Column | Source |
|--------|--------|
| Offer | `Offer__c` |
| Offer status | `Offer__r.Offer_Status__c` |
| Active version | Subquery or formula / LWC (not on junction today) |

**Campaign Copy Variants (`Campaign_Copy_Variant__c`)**

| Column | Source |
|--------|--------|
| Message Variant | `Message_Variant__c` |
| **Status** | `Message_Variant__r.Status__c` |
| **Channel type** | `Message_Variant__r.Channel_Type__c` |
| **Message name** | `Message_Variant__r.MessageName__c` or `Name` |
| Eligible | `Is_Eligible__c` |

**Campaign Members** — standard; future GateKeeper fields (`Gate_Status__c`, etc.) would appear here when implemented.

### 6.3 Optional LWC for detail page

A read-only **“Campaign configuration summary”** component (same sections as wizard summary step) can:

- Parse `Campaign_Exclusions_JSON__c` for human-readable exclusions  
- List offers via `getCampaignOffers` / junction  
- List copy with status via junction + `CC_Message_Metadata__c`  
- Split `Assigned_Channels__c` into badges  

This avoids admins hunting long text and JSON fields.

---

## 7. Useful SOQL (Developer Console / reports)

**Campaign shell + scoring + channels**

```sql
SELECT Id, Name, Status, IsActive,
       Activation_Type__c, Priority_Tier__c,
       Assigned_Channels__c,
       Topic_Dict__c, Topic_Name__c, Offering_Type__c,
       Product_Family__c, Family_of_Needs__c,
       Scoring_Method__c, Overall_Score__c, Scoring_Model_Dict__c,
       Campaign_Exclusions_JSON__c, Exclude_Other_Marketing_Activations__c
FROM Campaign
WHERE Id = '701...'
```

**Assigned copy with Copy Cockpit status**

```sql
SELECT Id, Is_Eligible__c,
       Message_Variant__r.Name,
       Message_Variant__r.Status__c,
       Message_Variant__r.Channel_Type__c,
       Message_Variant__r.Channel__c
FROM Campaign_Copy_Variant__c
WHERE Campaign__c = '701...'
```

**Assigned offers**

```sql
SELECT Id, Offer__r.Name, Offer__r.Offer_Status__c
FROM Campaign_Offer__c
WHERE Campaign__c = '701...'
```

---

## 8. Objects checklist (campaign definition flow)

| Object | Role in campaign definition |
|--------|------------------------------|
| **`Campaign`** | Central policy record |
| **`Campaign_Tier__c`** | Tier rules (wizard gating, not linked by lookup) |
| **`Marketing_Dictionary__c`** | Topics, groups, types, scoring models, PF/FoN/channel catalogue |
| **`Campaign_Offer__c`** | Campaign ↔ Offer selection |
| **`Offer__c` / `Offer_Version__c`** | Offer catalogue + active version attributes |
| **`Campaign_Copy_Variant__c`** | Campaign ↔ assigned copy variant |
| **`CC_Message_Metadata__c`** | Copy Cockpit message; **status & channel** |
| **`CampaignMember`** | Audience / members (eligibility & future GateKeeper) |
| **`Campaign_Scoring_Apriori_*`** (org) | Shared a-priori state when using slider + publish |
| **Suppression / segment / report / DMO/DLO** | Exclusion **sources** referenced inside JSON or legacy fields |

---

## 9. Repo metadata pointers

| Artifact | Path |
|----------|------|
| Wizard save logic | `force-app/main/default/lwc/agentforceCampaignWizard/agentforceCampaignWizard.js` (`executeSubCampaignSave`, `_applyExclusionsToSaveFields`) |
| Offer / copy persistence | `MarketingDictionaryController.cls` (`saveCampaignOffers`, `saveCampaignCopyVariants`, `getCampaignById`) |
| Marketing Campaign layout | `force-app/main/default/layouts/Campaign-Marketing Campaign Layout.layout-meta.xml` |
| Junction objects | `objects/Campaign_Offer__c`, `objects/Campaign_Copy_Variant__c` |
| Copy Cockpit entity | `objects/CC_Message_Metadata__c` |

---

## 10. Next steps (implementation backlog)

1. Add exclusion + `Exclude_Other_Marketing_Activations__c` to **Marketing Campaign Layout** (or Lightning page).  
2. Enhance **Campaign Copy Variants** related list with `Message_Variant__r.Status__c` and `Channel_Type__c`.  
3. Confirm org assigns **Marketing Campaign Layout** to NBA users / campaign record type.  
4. Optional: **Campaign Configuration Summary** LWC on record page.  
5. Align with [GateKeeper](./campaign-gatekeeper-architecture.md): read same fields + junctions for runtime policy.
