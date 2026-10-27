# Marketing Dictionary — data model rebuild (parked)

**Status:** Parked — sandbox only; no production cutover required yet.  
**Purpose:** Capture architecture direction and a safe migration plan so we can resume without re-discovering context.  
**SSOT for metadata today:** Git `main` ([manifest/README.md](../manifest/README.md)).

---

## Why this follow-up exists

The Marketing Dictionary **app** has outgrown a single “dictionary of values.” Operators use it as the **NBA engine control plane**: campaign catalog, tiers, scoring, channels, templates tied to **Copy Center**, Data Cloud bindings, and more.

The underlying pattern is largely **single-table inheritance** on `Marketing_Dictionary__c`: record types + `Dictionary_Sub_Type__c`, with many fields that apply only to one subtype. That leads to:

- Sparse, human-unreadable rows in Salesforce (most columns empty).
- Mixed **lifecycles** in one object (labels vs policy vs packaged content vs integrations).
- Growing channel and template settings that fit poorly on generic dictionary rows.

We **defer a full rebuild** until we can execute it in phases (cost, entanglement). Current behavior in sandbox is **production-quality** and must be preserved when we migrate.

---

## Non-negotiable behaviors (do not break)

| Capability | Intent | Implementation touchpoints (indicative) |
|------------|--------|----------------------------------------|
| **Id SSOT** | Campaign and wizards store dictionary **Ids**; labels are display/healed | Campaign lookup fields, `healCampaignOfferingLabels`, wizard save paths |
| **Dependency checks** | Block or guide delete/change when dependents exist | `MarketingDictionaryDeleteGuard`, manager save/delete APIs |
| **Value chaining** | UI options depend on prior selections (type → groups, topic group → topics, tier → exclusions, offering scope, etc.) | `MarketingDictionaryManagerController`, `MarketingDictionaryController`, Campaign Wizard LWCs |
| **Cross-app consumers** | Same config read by Dictionary UI, Campaign Wizard, Copy Center, scoring, MCE | Channel templates, cockpit controllers, scoring apriori/catalog |

Any rebuild must keep these contracts (prefer a **facade API** so storage can change without rewriting every LWC).

---

## Current shape (high level)

| Area | Typical storage today | Notes |
|------|------------------------|--------|
| Campaign catalog (types, groups, topics, locales, paths, …) | `Marketing_Dictionary__c` (Campaign RT / subtypes) | Heavy use of self-lookups on same object |
| Tiers | `Campaign_Tier__c` | Already extracted — policy, not flat dictionary |
| Channels (dictionary row) | `Marketing_Dictionary__c` (Channel RT) | Settings growing beyond initial scope |
| Templates / Copy Center | `Channel_Template__c` (+ manifest, assets) | Should **not** drift back onto MD |
| Scoring models / groups | `Marketing_Dictionary__c` (Scoring subtypes) | Rich fields (version, DMO, expiration, offering scope) — strong extract candidate |

---

## Target direction (normalize by lifecycle, not by UI tab)

**A. Catalog / hierarchy** — slim dictionary: Id, name, type, active, description, ordering, parent links.  
Examples: topic, topic group, campaign type, campaign group, locale, product family / FoN **catalog** rows.

**B. Policy / rules** — dedicated objects (tier is the precedent).  
Examples: activation path distribution rules, tier exclusion flags, consent/cooldown behavior where not “per campaign only.”

**C. Content / packages** — Copy Center SSOT.  
Examples: channel templates, content blocks, manifest — stay on template/channel content model.

**D. Integration bindings** — on the object they belong to, or 1:1 extension objects.  
Examples: Data360 DMO/DLO, external model id, MCE-related references — avoid new nullable columns on a shared MD parent.

**Rule while parked:** Do **not** add new cross-cutting fields to `Marketing_Dictionary__c` for templates, channel runtime, or scoring; add or extend a **dedicated object** and surface it in the Dictionary app via existing tab patterns.

---

## Recommended migration approach (when resumed)

### Phase 0 — Inventory (no schema delete)

- Build a **reference matrix**: each config kind → stored where → read/written by → delete guard? → Id referenced from Campaign/other?
- List every lookup on `Campaign`, templates, scoring, and MD self-refs.
- Snapshot sandbox to git `main` and tag commit (e.g. `pre-dictionary-rebuild`).

### Phase 1 — Additive schema

- New objects / 1:1 extensions only; **no** removal of MD fields yet.
- **Dual-read:** new storage first, fallback to legacy MD row.
- Optional dual-write during transition.

### Phase 2 — Backfill

- Migrate rows by subtype (script/Apex), with **legacy Id → new Id** mapping table if primary keys move.
- Prefer keeping **Campaign lookup Ids stable** or updating through a controlled mapping + heal job.

### Phase 3 — Switch consumers (order by risk)

1. Templates / channels (Copy Center isolation).  
2. Tiers / exclusions (already on `Campaign_Tier__c` — align all readers).  
3. Scoring models (extract + versioning/D360 fields).  
4. Campaign catalog subtypes on MD (most references — last big move).  
5. Deprecate MD fields/subtypes; shrink MD to catalog-only.

### Phase 4 — Cleanup

- Remove unused MD fields when zero readers (grep + dependency registry).
- Update permission sets and layouts.

### Facade layer

Evolve or wrap `MarketingDictionaryManagerController` (or introduce `NbaConfigCatalogService`) so LWCs keep stable DTOs; **all deletes** go through the guard registry.

---

## Sandbox regression checklist (run after each phase)

- [ ] Marketing Dictionary: every tab loads and saves (including tiers `@wire` + tier saves with `refreshApex`).
- [ ] Campaign Wizard: create/edit campaign, tier exclusions (visual picker + Data360 search), scoring, channels, copy step.
- [ ] Id SSOT: rename dictionary entry → campaign/list shows updated label without broken lookups.
- [ ] Delete blocked with clear dependents; delete succeeds after resolving dependents.
- [ ] Copy Center: message from template, variant Id, MCE sync log.
- [ ] Channel template studio / manifest validation path still works.

---

## Containment until rebuild (active now)

1. **Object ownership:** templates → `Channel_Template__c`; tiers → `Campaign_Tier__c`; do not store Copy Center package data on MD.  
2. **Facade + guard:** new references must register in delete dependency logic.  
3. **Branch discipline:** feature work merges to `main`; avoid long-lived parallel branches that overwrite shared LWCs (see recent exclusions vs tier-wire fixes).  
4. **Operator UX:** prefer LWC modals and subtype-specific list views over raw MD record pages.

---

## Open questions (for kickoff meeting)

- Which tab is the worst “frankenstein” today: **channels**, **scoring**, or **campaign catalog**? (Drives Phase 3 order.)  
- Should any baseline config move to **Custom Metadata** (deploy-driven) vs stay operator-editable in objects?  
- Naming: keep `Marketing_Dictionary__c` as slim catalog vs rename for clarity.  
- Single mapping object for legacy Id redirects vs in-field migration only.

---

## Related repo notes

- Copy Center deploy surface: [manifest/DEPLOY-COPY-CENTER.md](../manifest/DEPLOY-COPY-CENTER.md)  
- Org snapshot as reset: [manifest/README.md](../manifest/README.md)  

---

## Task handoff (when prioritized)

**Title:** Marketing Dictionary data model — phased rebuild (sandbox)  
**Goal:** Readable, lifecycle-separated objects without losing Id SSOT, dependency prompts, or Copy Center integration.  
**Start with:** Phase 0 inventory doc + dependency matrix spreadsheet (can extend this file).  
**Explicitly out of scope for first slice:** Production migration, big-bang UI rewrite.
