# Core SF Channel Template Shell Extract

Handoff package for implementing **message editor previews** on Salesforce Core (LWC + Apex), ported from Content at Scale (Vue + SFMC Code Resources).

**Package root:** `exports/core-sf-channel-templates/`  
**File count:** ~55  
**Source map:** `SOURCE_MAP.txt` (repo path → export path)

---

## Important architecture notes for Core SF

| Channel | What “shell” means here | Preview strategy in current app |
|--------|-------------------------|----------------------------------|
| **Email** | Real HTML masters + block HTML with `{{CONFIG_JSON}}` / slot injection | Assemble HTML in JS → render in iframe (`emailTemplatePreview.js` + `emailPreviewIframe.js`) |
| **Web Banner** | **No static HTML masters.** Vue components + production CSS under `cloudpages/banner/` | Mount `*BannerPreview.vue` with content JSON; CSS from cloudpages + editor chrome from `app.css` excerpt |
| **Push** | Vue device mock | `PushDevicePreview.vue` |
| **SMS** | No template shell | Tiny HTML string in `App.vue` (`renderSmsPreviewHtml`) + CSS |

Vue SFCs are **reference implementations** for markup/structure/behavior. On Core, reimplement as LWC (or static HTML templates + Apex/JS assembly). Do not expect Vue to run on Core.

---

## 1. Email

### 1.1 Master shell (HTML)

| File | Role |
|------|------|
| `email/master/SFMC_CB_Email_Master_Commercial.html` | Commercial email master. Injectable **BODY** slot key `49fwfqshzd9`. Fixed slots: AMPscript `bxctk7dwic4`, FOOTER `elffysyxus6`. |

Config constants: `email/config/hardcodedEmailMaster.js`  
Registry: `email/config/email-templates.json`  
Business templates (starter block stacks): `email/config/email-business-templates.json`  
Hardcoded block metadata: `email/config/hardcodedContentBlocks.js`

### 1.2 Content block shells (HTML)

All under `email/blocks/`:

| HTML shell | Block type (editor) | Notes |
|------------|---------------------|--------|
| `SFMC_CB_Email_TextImage.html` | TextImage | LR/RL sections |
| `SFMC_CB_Email_Banner.html` | Banner | LR/RL email banner block (not web banner) |
| `SFMC_CB_Email_RichText.html` | RichText / ArrowList | ArrowList reuses RichText shell |
| `SFMC_CB_Email_Image.html` | Image | |
| `SFMC_CB_Email_Prefooter.html` | Prefooter | |
| `SFMC_CB_Email_Spacer.html` | Spacer | |
| `SFMC_CB_Email_Footer.html` | Footer | Master-shell region; filtered out of body blocks |

**No separate `SFMC_CB_Email_Header.html`** in this repo — header is treated as a master-shell block type in JS filters only.

Placeholders used by preview JS:

- Master: `{{CONTENT}}` **or** SFMC BODY slot (`data-type="slot"`, slot key `49fwfqshzd9`)
- Blocks: `{{CONFIG_JSON}}` (and block-specific field substitution in `email/preview-js/*BlockHtml.js`)

### 1.3 Preview assembly (JS) — required for Core parity

| File | Role |
|------|------|
| `email/preview-js/emailTemplatePreview.js` | **Main orchestrator:** filter body blocks, populate each block shell, inject into master |
| `email/preview-js/emailPreviewIframe.js` | iframe write / srcdoc helpers |
| `email/preview-js/masterShellResolver.js` | Resolve which master HTML to use |
| `email/preview-js/syncShellLoader.js` | Load shells (fetch / sync) |
| `email/preview-js/adminEmailPreviewManifest.js` | Admin preview manifest |
| `email/preview-js/textImageBlockHtml.js` | TextImage populate |
| `email/preview-js/bannerBlockHtml.js` | Email Banner block populate |
| `email/preview-js/richTextBlockHtml.js` | RichText populate |
| `email/preview-js/imageBlockHtml.js` | Image populate |
| `email/preview-js/prefooterBlockHtml.js` | Prefooter populate |
| `email/preview-js/spacerBlockHtml.js` | Spacer populate |
| `email/preview-js/footerBlockHtml.js` | Footer populate |

**Core recommendation:** Keep HTML shells as Static Resources (or Custom Metadata / CMS). Port `emailTemplatePreview.js` + `*BlockHtml.js` logic to a shared JS module or Apex that returns final HTML for an LWC `lightning-formatted-rich-text` / iframe / `lwc:dom="manual"` preview.

Email has **no separate CSS files** for templates — styles are inline in the HTML shells (email-safe tables).

---

## 2. Web Banners (4 types)

Banner types (`banners/shared/bannerTypes.js`):

- `mainBanner`
- `photoBanner`
- `vasBanner`
- `smallBanner`

Shared:

| File | Role |
|------|------|
| `banners/shared/bannerTypes.js` | Type enum + labels |
| `banners/shared/bannerPlacements.js` | Placement options |
| `banners/shared/bannerIntents.js` | Intent / action target normalization (`primaryActionMode` / `intent` / `url`) |
| `banners/shared/BannerActionTargetField.vue` | Editor UX reference |
| `banners/shared/BannerImageSourcePanel.vue` | Image light/dark picker reference |
| `banners/shared/editor-preview-excerpt.css` | Phone mock + preview chrome from `app.css` |

Production CSS (use these for faithful preview/publish look):

- `banners/mainBanner/main-banner.css`
- `banners/photoBanner/photo-banner.css`
- `banners/vasBanner/vas-banner.css`
- `banners/smallBanner/small-banner.css`

### 2.1 `mainBanner`

| Asset | Path |
|-------|------|
| CSS | `banners/mainBanner/main-banner.css` |
| Content model (JS) | `banners/mainBanner/mainBannerContent.js` |
| Preview (Vue) | `banners/mainBanner/MainBannerPreview.vue` |
| Carousel preview | `banners/mainBanner/MainBannerCarouselPreview.vue` |
| Editor (Vue) | `banners/mainBanner/MainBannerEditor.vue` |

**Dimensions / tokens (from content model):** 315×191; image 100; phone mock 375×720, inset 20.  
**Layouts:** `threeButtons` \| `twoButtonsA` \| `twoButtonsB` \| `oneButton`.  
**Key content fields:** `title`, `description`, `imageUrlLight`, `imageUrlDark`, `legalLabel`, `legalNote`, `secondaryLabel` + action target, `primaryLabel` + action target, `showClose`, `buttonLayout`, `darkMode`.

### 2.2 `photoBanner`

| Asset | Path |
|-------|------|
| CSS | `banners/photoBanner/photo-banner.css` |
| Content model | `banners/photoBanner/photoBannerContent.js` |
| Preview | `banners/photoBanner/PhotoBannerPreview.vue` |
| Editor | `banners/photoBanner/PhotoBannerEditor.vue` |

**Dimensions:** banner 315×248; content card 144×240; same layout enum as main. Image-led with left glass card.

### 2.3 `smallBanner`

| Asset | Path |
|-------|------|
| CSS | `banners/smallBanner/small-banner.css` |
| Content model | `banners/smallBanner/smallBannerContent.js` |
| Preview | `banners/smallBanner/SmallBannerPreview.vue` |
| Editor | `banners/smallBanner/SmallBannerEditor.vue` |

**Dimensions:** width ~335 (100% in phone), min-height 48, image 40×40.  
**Fields:** `text`, `imageUrlLight` / `imageUrlDark`, single action target (`actionMode` / `intent` / `url`).

### 2.4 `vasBanner`

| Asset | Path |
|-------|------|
| CSS | `banners/vasBanner/vas-banner.css` |
| Content model | `banners/vasBanner/vasBannerContent.js` |
| Preview | `banners/vasBanner/VasBannerPreview.vue` |
| Grid preview | `banners/vasBanner/VasBannerGridPreview.vue` |
| Editor | `banners/vasBanner/VasBannerEditor.vue` |

**Layouts (all stored in DE JSON):** `expanded` (100%×164), `halfExpandedLong` (50%×240), `halfExpandedShort` (50%×164). Grid gap 8px; not a carousel. Grid count options: 2–5.

**Core recommendation:** Port CSS as Static Resources. Rebuild preview markup from Vue templates into LWC. Reuse content-model constants/limits from `*BannerContent.js` (or regenerate equivalent Apex DTOs).

---

## 3. Push (secondary)

| File | Role |
|------|------|
| `push/PushDevicePreview.vue` | Device mock UI |
| `push/pushTypes.js` | Push type options |
| `push/pushBehaviours.js` | Open / deep-link behaviours |
| `push/contentBuilderPushMessage.js` | CB payload helpers |

No HTML master shell.

---

## 4. SMS (secondary)

| File | Role |
|------|------|
| `sms/renderSmsPreviewHtml.js` | Extracted preview HTML builder (`fromName` + `body` bubble) |
| `sms/sms-preview.css` | SMS preview/editor CSS excerpt |

No HTML/CSS/JS template shell beyond this bubble UI.

---

## Suggested Core SF implementation order

1. **Email:** load master + block HTML → port populate/inject from `emailTemplatePreview.js` → iframe preview in LWC.  
2. **Banners:** Static Resource CSS per type → LWC markup mirroring `*BannerPreview.vue` → hydrate from BannerContent JSON using `*BannerContent.js` field shapes.  
3. Wire `bannerType` switch (main / photo / vas / small).  
4. Push/SMS last (simpler mocks).

---

## What is intentionally not in this package

- Full `App.vue` (huge; only SMS preview snippet extracted)
- SFMC publish / CloudPage runtime JS (banner CSS only)
- Images / brand assets URLs (content-dependent)
- Unit tests
- Node/build tooling

If you need the original repo paths, see `SOURCE_MAP.txt`.
