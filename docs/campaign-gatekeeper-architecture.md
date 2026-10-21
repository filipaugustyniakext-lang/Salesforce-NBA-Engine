# Campaign GateKeeper — Architecture Considerations

**Status:** Draft for future implementation  
**Last updated:** 2026-10-21  
**Context:** NBA Engine — admission control after eligibility, before journeys / SFMC activation

---

## 1. Problem statement

Marketers define campaigns in Salesforce (wizard: tier, exclusions, channels, scoring). **Eligibility** can come from many paths:

- Data Cloud **segment** (always-on daily refresh, one-off manual segment, baseline campaign criteria)
- **Data Graph / Data Action** (real-time or near–real-time)
- Other processes that create **Campaign Members**

Regardless of ingress, the same person must pass a **standardized validation pipeline** before progressing to journey flows or SFMC. The NBA principle: at any moment a client may be eligible for **multiple** campaigns, but only the most relevant / highest-priority activations should proceed.

**GateKeeper** is that pipeline: policy on the Campaign record, evaluated per member (or per client key) at admission time.

---

## 2. Policy vs runtime (what lives where)

### 2.1 Campaign = policy document (already partially implemented)

| Concept | Campaign field(s) | Notes |
|--------|-------------------|--------|
| Manual exclusions (multi-source + mapping) | `Campaign_Exclusions_JSON__c` | JSON array: `source`, `value`/`values`, `display`, `mapping.qualificationColumn`, `mapping.foreignKeyColumn` |
| Campaign-wide member key for joins | Captured in JSON rows + wizard “Campaign member key” | Same qualification column for all exclusion rows on a campaign |
| Legacy single suppression | `Suppression_Campaign__c`, `Suppression_Report_Id__c`, `Suppression_Segment__c` | Prefer JSON; legacy for migration |
| Other marketing activations (tier-gated) | `Exclude_Other_Marketing_Activations__c` | Checkbox; UI gated by tier dictionary |
| Priority / arbitration input | `Priority_Tier__c` | Tier dictionary defines capabilities (exclusions, etc.) |
| Channels, scoring, activation type | Existing Campaign / wizard fields | Future GateKeeper steps: cooldown, consent, score |

**Recommendation:** Treat policy as **versioned**. When exclusions or tier change materially, either bump an **activation policy version** on Campaign or re-run GateKeeper for affected members. Avoid silent rule changes on in-flight members.

### 2.2 Campaign Member = admission outcome (proposed)

Standard `CampaignMember.Status` is marketer/journey oriented (“Sent”, “Responded”). GateKeeper needs **machine-readable admission state**.

**Proposed custom fields on Campaign Member** (names illustrative):

| Field | Purpose |
|-------|---------|
| `Gate_Status__c` | `Pending` \| `Approved` \| `Blocked` \| `Superseded` |
| `Gate_Reason_Code__c` | e.g. `EXCL_SEGMENT`, `EXCL_DMO`, `EXCL_DLO`, `EXCL_CAMPAIGN`, `EXCL_REPORT`, `TIER_COMPETE`, `COOLDOWN`, `CONSENT`, `ERROR` |
| `Gate_Evaluated_At__c` | Last evaluation timestamp |
| `Gate_Policy_Version__c` | Campaign policy snapshot id or `LastModifiedDate` hash |
| `Qualification_Key__c` | Optional denormalized member key used for joins (debug / support) |

- **`Approved`** — may enter journey / SFMC entry flow  
- **`Blocked`** — failed a hard rule (exclusion, consent, cooldown)  
- **`Superseded`** — eligible but lost **cross-campaign arbitration** to a higher-priority campaign  
- **`Pending`** — created or eligibility refreshed; not yet evaluated (or awaiting cooldown DMO refresh)

Standard Status can mirror for humans or stay for downstream journey semantics; **automations should key off `Gate_Status__c`.**

Alternative: child object `Campaign_Member_Gate__c` if full audit history per evaluation is required.

---

## 3. Three lifecycles (do not merge)

```
Eligibility (D360 / DG / RT)  →  Campaign Member created  →  GateKeeper  →  Activation (Journey / SFMC)
         "in pool"                      "candidate"              "admitted?"        "message sent"
```

1. **Eligibility** — high volume; prefer **Data Cloud** for segment math.  
2. **Admission (GateKeeper)** — apply Campaign policy at a point in time.  
3. **Activation** — only for `Gate_Status__c = Approved` (and after any global arbitration pass if required).

---

## 4. GateKeeper validation stages (roadmap)

Order suggested: **cheap / deterministic first**, then heavier joins.

### 4.0 Catalogue resolution (before or with activation)

After admission policy checks, **offer selection** and **content assignment** must not use values frozen at campaign save time. Resolve from junction + live catalogue:

| Engine input | Resolver | “Available now” criteria (v1) |
|--------------|----------|-----------------------------|
| Assigned offers | `CampaignRuntimeCatalogService.resolveEligibleOffersForCampaign` | Junction + `Offer_Status__c = Active` + `Offer_Version__c` with `Is_Active__c` and valid `Valid_From__c` / `Valid_To__c` |
| Assigned copy | `CampaignRuntimeCatalogService.resolveEligibleCopyVariantsForCampaign` | Junction + `CC_Message_Metadata__c.Status__c = Published` |

If resolution returns no eligible offer or copy for a channel, treat as **Blocked** (or route to fallback policy) with reason codes such as `NO_ELIGIBLE_OFFER` / `NO_ELIGIBLE_COPY` — do not send stale content.

See [campaign-definition-data-model.md §1.1](./campaign-definition-data-model.md).

| Stage | Depends on | Tier / campaign flag |
|-------|------------|----------------------|
| 1. Consent | Consent DMO / Profile (future) | All campaigns |
| 2. Channel cooldown | Cooldown DMO (hourly refresh, future) | Campaign assigned channels |
| 3. Manual exclusions | `Campaign_Exclusions_JSON__c` | Tier: manual suppressions |
| 4. Other marketing activations | Active campaigns + member overlap | `Exclude_Other_Marketing_Activations__c` + tier |
| 5. Cross-campaign arbitration | Priority tier + score DMO (future) | NBA “single winner” per client/window |
| 6. Channel availability | Cooldown + consent composite | Before journey branch |

Not all DMOs exist yet; implement as **pluggable evaluators** behind one service interface.

---

## 5. Exclusion evaluation (aligns with wizard JSON)

For each exclusion row:

- **Member side:** value of campaign-level **qualification column** (segment field, Data Graph key, or Campaign Member / Contact path e.g. `Contact.externalCustomerId__c`).
- **Exclusion side:** **foreign key column** on the source (segment attribute, DMO/DLO column, campaign member attribute, report column).

**Rule:** If member key exists in **any** configured exclusion source → `Blocked` + reason `EXCL_<SOURCE>`.

### Scalable execution (avoid per-member callouts)

| Source | Scalable pattern |
|--------|------------------|
| Segment | Anti-join in D360 before CM insert; or materialized exclusion key set |
| DMO / DLO (Profile) | Data Cloud SQL join; optional materialized `Exclusion_Keys__dlm` |
| Campaign | Bulk extract keys from suppression campaign members (mapped Contact path) |
| Report | Scheduled snapshot to D360 / keyed table; avoid live Report API per member |

**Apex GateKeeper** should bulk-evaluate: one (or few) queries per exclusion source per batch, not N×M callouts.

---

## 6. Tier and competing campaigns

When tier requires checking other activations:

- Find other campaigns where the same **client key** has `Approved` or `Pending` admission (or is eligible in D360).
- **Arbitration:** lower tier number / higher priority wins; tie-break with **score** (future).
- Losers → `Superseded`, not `Blocked` (different reason code and UX).

Always-on campaigns: re-run arbitration after daily eligibility refresh.  
RT campaigns: evaluate on insert; use **idempotency** (same key + campaign + window) to prevent duplicate journey entry.

---

## 7. Orchestration options

### Option A — Salesforce-centric (moderate volume, Journey-first)

1. Campaign Member created/updated → `Gate_Status__c = Pending`.  
2. Flow or Platform Event → Queueable / Batch **`CampaignGateKeeperService`**.  
3. Service updates `Gate_Status__c` / reason.  
4. Record-triggered Flow: `Gate_Status__c = Approved` → SFMC / Journey entry.

### Option B — Data Cloud-centric (high volume, always-on)

1. D360 pipeline: Eligible population → SQL Gate transform → `Activation_Ready__dlm` (status + reason).  
2. Sync only **Approved** keys to Salesforce CM or activate directly from D360.  
3. Salesforce GateKeeper for edge paths (manual CM, report-driven, RT API).

### Option C — Hybrid (likely)

- **Segment-fed / batch:** heavy lifting in D360 (exclusions as joins).  
- **DG / RT / API-created members:** Salesforce GateKeeper with same **compiled policy**.  
- **Single specification** for rules; two **executors** (D360 SQL vs Apex).

---

## 8. Campaign type vs trigger matrix

| Activation pattern | Eligibility refresh | GateKeeper trigger |
|--------------------|---------------------|-------------------|
| Always-on | D360 scheduled (e.g. daily) | Batch after export: Pending → bulk evaluate → Approved subset |
| One-off | On segment publish | One-time or daily batch until campaign ends |
| RT / Data Action | Per event | Queueable micro-batch; dedupe by qualification key + Campaign Id |

---

## 9. Compiled policy (performance)

At campaign save or first gate run, **compile** JSON + flags into a runtime structure (custom object `Campaign_Gate_Policy__c`, Platform Cache, or metadata):

- Member key field API name  
- List of exclusion **probes** (type, resolved id, foreign key field)  
- Flags: check other activations, assigned channels, min tier behavior  

Runtime reads compiled policy, not raw JSON on every row.

---

## 10. Proposed Apex / Flow contract (sketch)

```text
CampaignGateKeeperService.evaluate(List<GateInput> inputs) → List<GateResult>

GateInput:
  - campaignId
  - campaignMemberId (or contactId + key only)
  - qualificationKey (optional if service resolves from CM)
  - policyVersion (optional)

GateResult:
  - campaignMemberId
  - status: Pending | Approved | Blocked | Superseded
  - reasonCode
  - details (optional, for logging)
```

Flow-invokable bulk method for Flow; Queueable chunks for large batches; same core for RT (batch size 1–N).

---

## 11. Phased delivery

| Phase | Scope |
|-------|--------|
| **1** | CM gate fields; compile policy from `Campaign_Exclusions_JSON__c`; bulk exclusion evaluator; Flow on Approved |
| **2** | Tier / `Exclude_Other_Marketing_Activations__c`; arbitration + `Superseded` |
| **3** | Cooldown DMO + consent checks in same pipeline |
| **4** | Scoring DMO; global NBA winner across campaigns |

---

## 12. Open decisions (for next discussion)

1. **Authoritative store for RT at scale:** Salesforce CM only vs D360 activation table + sync.  
2. **Policy versioning field** on Campaign (explicit version number vs LastModifiedDate).  
3. **Re-gate frequency** for always-on when cooldown DMO updates hourly.  
4. **SFMC entry trigger:** Flow on CM vs API from GateKeeper vs D360 activation export.  
5. **Child object** for gate audit history vs fields only on CM.  
6. **Materialized exclusion tables** in D360: org-wide vs per-campaign.

---

## 13. Related repo artifacts

- Wizard UI / save: `force-app/main/default/lwc/agentforceCampaignWizard/`  
- Exclusion catalog & field options: `CampaignExclusionController.cls`  
- Campaign load/save: `MarketingDictionaryController.getCampaignById`  
- Campaign fields: `force-app/main/default/objects/Campaign/fields/Campaign_Exclusions_JSON__c.field-meta.xml`, `Exclude_Other_Marketing_Activations__c`, suppression fields  

---

## 14. References (internal)

- PR branch: `cursor/wizard-campaign-exclusions-be82` (exclusions UX + JSON persistence)  
- Exclusion mapping UX: campaign member key + per-source foreign key attribute (combobox)
