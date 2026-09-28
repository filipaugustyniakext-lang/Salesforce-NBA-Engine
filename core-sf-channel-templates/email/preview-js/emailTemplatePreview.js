/**
 * Master email template + per-block HTML shells for the editor preview panel.
 * Master templates may use {{CONTENT}} or SFMC Content Builder BODY slots
 * (data-type="slot"). Header/footer slots are left untouched.
 */

export const EMAIL_TEMPLATE_CONTENT_PLACEHOLDER = "{{CONTENT}}";
export const EMAIL_BLOCK_CONFIG_JSON_PLACEHOLDER = "{{CONFIG_JSON}}";

const DEFAULT_BODY_SLOT = {
  slotKey: "49fwfqshzd9",
  slotLabel: "BODY",
};

const DEFAULT_HEADER_SLOT = {
  slotKey: "89k9yhfyvnj",
  slotLabel: "HEADER",
};

const DEFAULT_FOOTER_SLOT = {
  slotKey: "elffysyxus6",
  slotLabel: "FOOTER",
};

/** Block types baked into the SFMC master template — never stored in message JSON. */
const MASTER_SHELL_BLOCK_TYPES = new Set(["Footer", "Header"]);

/** SFMC content-block paths for master shell regions (not editable body blocks). */
const MASTER_SHELL_CONTENT_BLOCK_PATHS = new Set([
  "SFMC_CB_Email_Footer",
  "SFMC_CB_Email_Header",
]);

export function isEmailMasterShellBlockType(type) {
  return MASTER_SHELL_BLOCK_TYPES.has(String(type ?? "").trim());
}

export function isEmailMasterShellContentBlockPath(path) {
  const normalized = String(path ?? "").trim();
  if (!normalized) return false;
  if (MASTER_SHELL_CONTENT_BLOCK_PATHS.has(normalized)) return true;
  return /(?:^|\/)SFMC_CB_Email_(?:Footer|Header)(?:\.html)?$/i.test(normalized);
}

export function filterEmailBodyBlocks(blocks = []) {
  return (Array.isArray(blocks) ? blocks : []).filter(
    (block) =>
      block &&
      typeof block === "object" &&
      !isEmailMasterShellBlockType(block.type) &&
      !isEmailMasterShellContentBlockPath(block.contentBlockPath),
  );
}

import {
  imageBlockFieldsFromConfig,
  populateImageBlockBodyTemplate,
  populateImageBlockFromConfig,
  populateImageBlockFromEditorBlock,
} from "./emailBlockHtml/imageBlockHtml.js";
import {
  populateRichTextBlockBodyTemplate,
  populateRichTextBlockFromEditorBlock,
  richTextFieldsFromConfig,
} from "./emailBlockHtml/richTextBlockHtml.js";
import {
  populateTextImageBlockBodyTemplate,
  populateTextImageBlockFromEditorBlock,
  textImageSectionsFromConfig,
} from "./emailBlockHtml/textImageBlockHtml.js";
import {
  bannerSectionsFromConfig,
  populateBannerBlockBodyTemplate,
  populateBannerBlockFromEditorBlock,
} from "./emailBlockHtml/bannerBlockHtml.js";
import {
  populatePrefooterBlockBodyTemplate,
  populatePrefooterBlockFromEditorBlock,
  prefooterFieldsFromConfig,
} from "./emailBlockHtml/prefooterBlockHtml.js";
import {
  populateSpacerBlockBodyTemplate,
  populateSpacerBlockFromConfig,
  populateSpacerBlockFromEditorBlock,
  spacerFieldsFromConfig,
} from "./emailBlockHtml/spacerBlockHtml.js";
import { resolveMockDataUrl } from "../config/runtimeConfig.js";
import {
  extractMasterTemplateSlotInnerHtml,
  findMasterTemplateSlotRange,
  injectMasterTemplateSlotInnerHtml,
  MASTER_SLOT_ROLE_FIXED,
} from "./blockTypeRegistry.js";
import {
  EMAIL_PREVIEW_EMPTY_BLOCK,
  EMAIL_PREVIEW_EMPTY_BODY,
} from "./emailPreviewEmptyState.js";

const DEFAULT_MASTER_WRAPPER =
  '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="font-family:Arial,sans-serif;color:#181818">{{CONTENT}}</td></tr></table>';

async function resolveTemplateBodyFile(file, fetchText) {
  const path = String(file ?? "").trim();
  if (!path) return "";
  const url = path.startsWith("/") ? resolveMockDataUrl(path) : resolveMockDataUrl(path);
  try {
    return await fetchText(url);
  } catch (error) {
    return "";
  }
}

export function normalizeEmailTemplatesPayload(payload = {}) {
  const templates = Array.isArray(payload.templates) ? payload.templates : [];
  return {
    templates: templates
      .filter((template) => template && typeof template === "object")
      .map((template) => ({
        templateName: String(template.templateName ?? "").trim(),
        templatePath: String(template.templatePath ?? "").trim(),
        templateBody: String(template.templateBody ?? ""),
        templateBodyFile: String(template.templateBodyFile ?? "").trim(),
        bodySlotKey: String(template.bodySlotKey ?? DEFAULT_BODY_SLOT.slotKey).trim(),
        bodySlotLabel: String(
          template.bodySlotLabel ?? DEFAULT_BODY_SLOT.slotLabel,
        ).trim(),
        headerSlotKey: DEFAULT_HEADER_SLOT.slotKey,
        headerSlotLabel: DEFAULT_HEADER_SLOT.slotLabel,
        footerSlotKey: DEFAULT_FOOTER_SLOT.slotKey,
        footerSlotLabel: DEFAULT_FOOTER_SLOT.slotLabel,
        contentBlocks: (Array.isArray(template.contentBlocks)
          ? template.contentBlocks
          : []
        )
          .filter(
            (block) =>
              block &&
              typeof block === "object" &&
              !isEmailMasterShellContentBlockPath(block.blockPath),
          )
          .map((block) => ({
            blockName: String(block.blockName ?? "").trim(),
            blockPath: String(block.blockPath ?? "").trim(),
            blockBody: String(block.blockBody ?? ""),
            blockBodyFile: String(block.blockBodyFile ?? "").trim(),
          })),
      })),
  };
}

export function findEmailMasterTemplate(
  templatesPayload,
  { templateId = "", templateKey = "", templateName = "" } = {},
) {
  const templates = templatesPayload?.templates ?? [];
  if (!templates.length) return null;

  const id = String(templateId ?? "").trim();
  const key = String(templateKey ?? "").trim();
  const name = String(templateName ?? "").trim();

  return (
    templates.find((template) => key && template.templatePath === key) ??
    templates.find((template) => id && template.templatePath === id) ??
    templates.find(
      (template) =>
        name &&
        template.templateName.toLowerCase() === name.toLowerCase(),
    ) ??
    null
  );
}

export function getContentBuilderKeyForBlockType(blockType, adminContentBlocks = []) {
  const type = String(blockType ?? "").trim();
  const match = adminContentBlocks.find((block) => block.type === type);
  return String(match?.contentBuilderKey ?? "").trim();
}

export function findEmailContentBlockTemplate(
  masterTemplate,
  {
    blockType = "",
    blockName = "",
    blockPath = "",
    contentBuilderKey = "",
  } = {},
) {
  const blocks = masterTemplate?.contentBlocks ?? [];
  if (!blocks.length) return null;

  const path = String(blockPath ?? "").trim();
  const key = String(contentBuilderKey ?? "").trim();
  const name = String(blockName ?? "").trim();
  const type = String(blockType ?? "").trim();

  return (
    blocks.find((block) => key && block.blockPath === key) ??
    blocks.find((block) => path && block.blockPath === path) ??
    blocks.find(
      (block) =>
        name && block.blockName.toLowerCase() === name.toLowerCase(),
    ) ??
    blocks.find(
      (block) =>
        type &&
        block.blockName.toLowerCase().includes(type.toLowerCase()),
    ) ??
    null
  );
}

export function populateTemplatePlaceholders(templateBody, replacements = {}) {
  let html = String(templateBody ?? "");
  for (const [placeholder, value] of Object.entries(replacements)) {
    if (!placeholder) continue;
    html = html.split(placeholder).join(String(value ?? ""));
  }
  return html;
}

/**
 * Matches SFMC ContentBlockbyID AMPscript variants.
 * SFMC treats AMPscript function names as case-insensitive; shells may use
 * ContentBlockbyID, ContentBlockById, ContentBlockByID, etc.
 */
const CONTENT_BLOCK_BY_ID_PATTERN =
  /%%\s*=\s*ContentBlockbyID\s*\(\s*["']?(\d+)["']?\s*\)\s*%%/gi;

function resetContentBlockByIdPattern() {
  CONTENT_BLOCK_BY_ID_PATTERN.lastIndex = 0;
}

function stripHtmlForAmpInspection(text = "") {
  return String(text ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extracts the first reference block id from slot inner AMPscript, if any. */
/** Merges referenceBlockId values returned by MCE master-template sync into local slot config. */
export function mergeMceSlotReferenceIdsIntoSlots(
  slots = [],
  mceSlots = [],
  html = "",
) {
  const mceByKey = new Map(
    (Array.isArray(mceSlots) ? mceSlots : [])
      .filter((slot) => String(slot?.slotKey ?? "").trim())
      .map((slot) => [String(slot.slotKey).trim(), slot]),
  );

  return (Array.isArray(slots) ? slots : []).map((slot) => {
    const slotKey = String(slot.slotKey ?? "").trim();
    const mceSlot = mceByKey.get(slotKey);
    const referenceBlockId =
      String(slot.referenceBlockId ?? "").trim() ||
      String(mceSlot?.referenceBlockId ?? "").trim() ||
      extractReferenceBlockIdFromSlotContent(
        extractMasterTemplateSlotInnerHtml(html, {
          slotKey,
          slotLabel: slot.slotLabel,
        }),
      );
    return referenceBlockId ? { ...slot, referenceBlockId } : { ...slot };
  });
}

/** Strips MCE reference-block wrapper tables so injected preview HTML nests cleanly. */
export function unwrapMceReferenceBlockHtml(html = "") {
  const source = String(html ?? "").trim();
  if (!source) return "";
  const innerMatch = source.match(
    /class=["'][^"']*camarker-inner[^"']*["'][^>]*>([\s\S]*?)<\/td>\s*<\/tr>\s*<\/table>\s*$/i,
  );
  if (innerMatch) return String(innerMatch[1] ?? "").trim();
  return source;
}

/** Adds referenceBlockId to fixed slots when AMPscript tokens exist in synced shell HTML. */
export function enrichMasterTemplateSlotsWithReferenceBlockIds(
  slots = [],
  html = "",
) {
  return (Array.isArray(slots) ? slots : []).map((slot) => {
    const referenceBlockId =
      String(slot.referenceBlockId ?? "").trim() ||
      extractReferenceBlockIdFromSlotContent(
        extractMasterTemplateSlotInnerHtml(html, {
          slotKey: slot.slotKey,
          slotLabel: slot.slotLabel,
        }),
      );
    return referenceBlockId ? { ...slot, referenceBlockId } : { ...slot };
  });
}

export function extractReferenceBlockIdFromSlotContent(inner = "") {
  const text = stripHtmlForAmpInspection(inner);
  if (!text) return "";
  resetContentBlockByIdPattern();
  const match = CONTENT_BLOCK_BY_ID_PATTERN.exec(text);
  resetContentBlockByIdPattern();
  return String(match?.[1] ?? "").trim();
}

/** True when slot inner is empty or still only unresolved AMPscript tokens. */
export function isUnresolvedAmpReferenceSlotContent(inner = "") {
  const text = String(inner ?? "").trim();
  if (!text) return true;

  const inspectable = stripHtmlForAmpInspection(text);
  if (!inspectable) return true;

  resetContentBlockByIdPattern();
  const withoutTokens = inspectable
    .replace(CONTENT_BLOCK_BY_ID_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
  resetContentBlockByIdPattern();

  // AMPscript is invisible in the preview iframe — treat token-only slots as empty.
  return !withoutTokens;
}

/** Collects unique MCE reference block ids from master shell AMPscript tokens. */
export function listEmailMasterShellReferenceBlockIds(html = "") {
  const source = String(html ?? "");
  if (!source) return [];
  const ids = new Set();
  resetContentBlockByIdPattern();
  let match = CONTENT_BLOCK_BY_ID_PATTERN.exec(source);
  while (match) {
    const id = String(match[1] ?? "").trim();
    if (id) ids.add(id);
    match = CONTENT_BLOCK_BY_ID_PATTERN.exec(source);
  }
  resetContentBlockByIdPattern();
  return [...ids];
}

/**
 * Copies fixed-slot inner HTML from a fallback master shell when the primary
 * shell has empty fixed regions (common when MCE sync preserved empty slot divs).
 * Slots are matched by label first, then by key.
 */
export function mergeFixedMasterSlotsFromFallbackShell(
  primaryShell = "",
  fallbackShell = "",
  fixedSlots = [],
) {
  const primary = String(primaryShell ?? "").trim();
  const fallback = String(fallbackShell ?? "").trim();
  if (!primary || !fallback) return primary;

  let result = primary;
  for (const slot of Array.isArray(fixedSlots) ? fixedSlots : []) {
    if (slot?.role !== MASTER_SLOT_ROLE_FIXED) continue;

    const slotKey = String(slot.slotKey ?? "").trim();
    const slotLabel = String(slot.slotLabel ?? "").trim();
    const existing = extractMasterTemplateSlotInnerHtml(result, {
      slotKey,
      slotLabel,
    });
    if (existing && !isUnresolvedAmpReferenceSlotContent(existing)) continue;

    const fallbackInner =
      (slotLabel
        ? extractMasterTemplateSlotInnerHtml(fallback, { slotLabel })
        : "") ||
      (slotKey
        ? extractMasterTemplateSlotInnerHtml(fallback, { slotKey })
        : "");
    if (!fallbackInner) continue;

    result = injectMasterTemplateSlotInnerHtml(
      result,
      { slotKey, slotLabel },
      fallbackInner,
    );
  }

  return result;
}

/**
 * Expands %%=ContentBlockbyID(…)%% tokens for editor preview only.
 * Persisted shells keep AMPscript; the preview iframe cannot execute it.
 */
export async function resolveEmailMasterShellAmpReferences(
  html = "",
  fetchReferenceBlockHtml,
) {
  const source = String(html ?? "");
  const blockIds = listEmailMasterShellReferenceBlockIds(source);
  if (!blockIds.length || typeof fetchReferenceBlockHtml !== "function") {
    return source;
  }

  const resolvedById = new Map();
  await Promise.all(
    blockIds.map(async (blockId) => {
      try {
        const blockHtml = String(
          (await fetchReferenceBlockHtml(blockId)) ?? "",
        ).trim();
        if (blockHtml) resolvedById.set(blockId, blockHtml);
      } catch (error) {
        console.warn(
          `[Content Center] Could not resolve reference block ${blockId} for preview.`,
          error,
        );
      }
    }),
  );

  resetContentBlockByIdPattern();
  return source.replace(CONTENT_BLOCK_BY_ID_PATTERN, (token, blockId) => {
    const resolved = unwrapMceReferenceBlockHtml(
      resolvedById.get(String(blockId ?? "").trim()) || "",
    );
    return resolved || token;
  });
}

/**
 * Injects reference-block HTML into fixed slots that are empty or still contain
 * unresolved AMPscript tokens (iframe cannot execute server-side AMPscript).
 */
export async function resolveFixedSlotReferenceBlocksForPreview(
  shellHtml = "",
  fixedSlots = [],
  fetchReferenceBlockHtml,
) {
  const source = String(shellHtml ?? "").trim();
  if (!source || typeof fetchReferenceBlockHtml !== "function") {
    return source;
  }

  let result = source;
  for (const slot of Array.isArray(fixedSlots) ? fixedSlots : []) {
    if (slot?.role !== MASTER_SLOT_ROLE_FIXED) continue;

    const slotKey = String(slot.slotKey ?? "").trim();
    const slotLabel = String(slot.slotLabel ?? "").trim();
    const existing = extractMasterTemplateSlotInnerHtml(result, {
      slotKey,
      slotLabel,
    });
    if (existing && !isUnresolvedAmpReferenceSlotContent(existing)) continue;

    const blockId = String(
      slot.referenceBlockId ??
        extractReferenceBlockIdFromSlotContent(existing) ??
        "",
    ).trim();
    if (!blockId) continue;

    try {
      const blockHtml = unwrapMceReferenceBlockHtml(
        String((await fetchReferenceBlockHtml(blockId)) ?? "").trim(),
      );
      if (!blockHtml) continue;
      result = injectMasterTemplateSlotInnerHtml(
        result,
        { slotKey, slotLabel },
        blockHtml,
      );
    } catch (error) {
      console.warn(
        `[Content Center] Could not resolve fixed slot reference block ${blockId} for preview.`,
        error,
      );
    }
  }

  return result;
}

/** True when any fixed slot still has no previewable HTML after reference resolution. */
export function fixedSlotsNeedShellFallback(html = "", fixedSlots = []) {
  for (const slot of Array.isArray(fixedSlots) ? fixedSlots : []) {
    if (slot?.role !== MASTER_SLOT_ROLE_FIXED) continue;
    const existing = extractMasterTemplateSlotInnerHtml(html, {
      slotKey: slot.slotKey,
      slotLabel: slot.slotLabel,
    });
    if (!existing || isUnresolvedAmpReferenceSlotContent(existing)) {
      return true;
    }
  }
  return false;
}

/**
 * Preview-only shell preparation: resolve AMPscript reference blocks first,
 * then fill any still-empty fixed slots from a fallback master shell.
 */
export async function prepareMasterShellHtmlForPreview(
  shellHtml = "",
  {
    fixedSlots = [],
    fallbackShell = "",
    resolveFallbackShell = null,
    fetchReferenceBlockHtml = null,
  } = {},
) {
  let html = String(shellHtml ?? "").trim();
  if (!html) return "";

  const slots = Array.isArray(fixedSlots) ? fixedSlots : [];

  if (typeof fetchReferenceBlockHtml === "function") {
    html = await resolveEmailMasterShellAmpReferences(
      html,
      fetchReferenceBlockHtml,
    );
    html = await resolveFixedSlotReferenceBlocksForPreview(
      html,
      slots,
      fetchReferenceBlockHtml,
    );
  }

  let fallback = String(fallbackShell ?? "").trim();
  if (
    !fallback &&
    typeof resolveFallbackShell === "function" &&
    fixedSlotsNeedShellFallback(html, slots)
  ) {
    fallback = String((await resolveFallbackShell()) ?? "").trim();
  }
  if (fallback && slots.length && fixedSlotsNeedShellFallback(html, slots)) {
    html = mergeFixedMasterSlotsFromFallbackShell(html, fallback, slots);
  }

  return html;
}

/**
 * Injects rendered blocks into the configured injectable master template slot
 * (or {{CONTENT}}). Fixed slots (header/footer) are left untouched.
 */
export function injectMasterTemplateBodyContent(
  masterBody,
  contentHtml,
  { bodySlotKey, bodySlotLabel } = {},
) {
  const html = String(masterBody ?? "");
  const content = String(contentHtml ?? "");
  const slotKey = String(bodySlotKey ?? DEFAULT_BODY_SLOT.slotKey).trim();
  const slotLabel = String(bodySlotLabel ?? DEFAULT_BODY_SLOT.slotLabel).trim();

  if (html.includes(EMAIL_TEMPLATE_CONTENT_PLACEHOLDER)) {
    return populateTemplatePlaceholders(html, {
      [EMAIL_TEMPLATE_CONTENT_PLACEHOLDER]: content,
    });
  }

  const slotRange =
    findMasterTemplateSlotRange(html, { slotKey, slotLabel }) ??
    findMasterTemplateSlotRange(html, { slotLabel });
  if (slotRange) {
    const inner = content ? `\n${content}\n` : "";
    return `${html.slice(0, slotRange.contentStart)}${inner}${html.slice(slotRange.closeStart)}`;
  }

  return populateTemplatePlaceholders(html, {
    [EMAIL_TEMPLATE_CONTENT_PLACEHOLDER]: content,
  });
}

export async function resolveEmailTemplateBodies(
  templatesPayload,
  fetchText = (url) => fetch(url).then((response) => response.text()),
) {
  const templates = templatesPayload?.templates ?? [];
  await Promise.all(
    templates.map(async (template) => {
      if (!String(template.templateBody ?? "").trim()) {
        template.templateBody = await resolveTemplateBodyFile(
          template.templateBodyFile,
          fetchText,
        );
      }

      const contentBlocks = template.contentBlocks ?? [];
      await Promise.all(
        contentBlocks.map(async (block) => {
          if (String(block.blockBody ?? "").trim()) return;
          block.blockBody = await resolveTemplateBodyFile(
            block.blockBodyFile,
            fetchText,
          );
        }),
      );
    }),
  );
  return templatesPayload;
}

export function escapeHtmlForPreview(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Wraps one rendered block so the preview iframe can map clicks back to editor blocks. */
export function wrapEmailPreviewBlockHtml(block, html) {
  const content = String(html ?? "").trim();
  if (!content || !block?.id) return content;
  const blockId = escapeHtmlForPreview(String(block.id));
  const blockType = escapeHtmlForPreview(String(block.type ?? "Block"));
  const blockOrder = escapeHtmlForPreview(String(block.contentBlockOrder ?? ""));
  return `<div class="email-preview-block" role="button" tabindex="-1" data-preview-block-id="${blockId}" data-preview-block-type="${blockType}" data-preview-block-order="${blockOrder}">${content}</div>`;
}

/**
 * Renders one block for preview: optional HTML shell (blockBody) + config JSON slot.
 */
function renderBlockHtmlFromTemplate({
  block,
  blockTemplate,
  renderedHtml,
  configJson,
}) {
  const body = String(blockTemplate?.blockBody ?? "").trim();
  if (!body) return "";

  if (block?.type === "Image") {
    const configFields = imageBlockFieldsFromConfig(configJson);
    const hasConfigImage =
      configFields &&
      (configFields.imageURLDesktop || configFields.imageURLMobile);
    if (hasConfigImage) {
      const fromConfig = populateImageBlockBodyTemplate(body, configFields);
      if (fromConfig) return fromConfig;
    }
    const fromEditor = populateImageBlockFromEditorBlock(block, body);
    if (fromEditor) return fromEditor;
  }

  if (block?.type === "RichText") {
    const configFields = richTextFieldsFromConfig(configJson);
    const hasConfigContent =
      configFields && String(configFields.rows ?? "").trim();
    if (hasConfigContent) {
      const fromConfig = populateRichTextBlockBodyTemplate(body, configFields);
      if (fromConfig) return fromConfig;
    }
    const fromEditor = populateRichTextBlockFromEditorBlock(block, body);
    if (fromEditor) return fromEditor;
  }

  if (block?.type === "TextImage") {
    const configSections = textImageSectionsFromConfig(configJson);
    if (configSections) {
      const fromConfig = populateTextImageBlockBodyTemplate(body, configSections);
      if (fromConfig) return fromConfig;
    }
    const fromEditor = populateTextImageBlockFromEditorBlock(block, body);
    if (fromEditor) return fromEditor;
  }

  if (block?.type === "Banner") {
    const configSections = bannerSectionsFromConfig(configJson);
    if (configSections) {
      const fromConfig = populateBannerBlockBodyTemplate(body, configSections);
      if (fromConfig) return fromConfig;
    }
    const fromEditor = populateBannerBlockFromEditorBlock(block, body);
    if (fromEditor) return fromEditor;
  }

  if (block?.type === "Prefooter") {
    const configFields = prefooterFieldsFromConfig(configJson);
    if (configFields?.productHtml || configFields?.legalHtml) {
      const fromConfig = populatePrefooterBlockBodyTemplate(body, configFields);
      if (fromConfig) return fromConfig;
    }
    const fromEditor = populatePrefooterBlockFromEditorBlock(block, body);
    if (fromEditor) return fromEditor;
  }

  if (block?.type === "Spacer") {
    const configFields = spacerFieldsFromConfig(configJson);
    if (configFields) {
      const fromConfig = populateSpacerBlockBodyTemplate(body, configFields);
      if (fromConfig) return fromConfig;
    }
    const fromEditor = populateSpacerBlockFromEditorBlock(block, body);
    if (fromEditor) return fromEditor;
  }

  return "";
}

export function renderBlockPreviewFromTemplate({
  block,
  blockTemplate,
  renderedHtml,
  configJson,
  formatConfigJson = (value) =>
    `<pre class="email-preview-config-json" style="display:none;font-size:10px;white-space:pre-wrap;margin:0;">${escapeHtmlForPreview(
      typeof value === "string" ? value : JSON.stringify(value, null, 2),
    )}</pre>`,
}) {
  const mappedHtml = renderBlockHtmlFromTemplate({
    block,
    blockTemplate,
    renderedHtml,
    configJson,
  });
  if (mappedHtml) return mappedHtml;

  const fallbackHtml = String(renderedHtml ?? "");
  if (!String(blockTemplate?.blockBody ?? "").trim()) return fallbackHtml;

  const configPayload =
    typeof configJson === "string"
      ? configJson
      : JSON.stringify(configJson ?? {}, null, 2);

  return populateTemplatePlaceholders(String(blockTemplate.blockBody), {
    [EMAIL_TEMPLATE_CONTENT_PLACEHOLDER]: fallbackHtml,
    [EMAIL_BLOCK_CONFIG_JSON_PLACEHOLDER]: formatConfigJson(configPayload),
  });
}

const BLOCK_ONLY_PREVIEW_WRAPPER = `<!DOCTYPE html><html lang="und"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;background:transparent;">${EMAIL_TEMPLATE_CONTENT_PLACEHOLDER}</body></html>`;

/** Single-block editor preview: block HTML only, no master HEADER/FOOTER shell. */
export function wrapBlockOnlyPreviewDocument(
  contentHtml,
  emptyContentHtml = EMAIL_PREVIEW_EMPTY_BLOCK,
) {
  const content = String(contentHtml ?? "").trim();
  return populateTemplatePlaceholders(BLOCK_ONLY_PREVIEW_WRAPPER, {
    [EMAIL_TEMPLATE_CONTENT_PLACEHOLDER]: content || emptyContentHtml,
  });
}

/**
 * Builds full email preview HTML from master template + ordered blocks.
 * @param {"message"|"block"} previewScope - `message` uses master template chrome; `block` renders BODY content only.
 */
export function renderEmailPreviewDocument({
  masterTemplate,
  blocks = [],
  renderBlockHtml,
  serializeBlockConfig,
  adminContentBlocks = [],
  formatBlockTypeLabel = (type) => String(type ?? "Block"),
  fallbackMasterWrapper = DEFAULT_MASTER_WRAPPER,
  emptyContentHtml = EMAIL_PREVIEW_EMPTY_BODY,
  markInteractiveBlocks = false,
  previewScope = "message",
}) {
  const blockHtml = filterEmailBodyBlocks(blocks)
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const contentBuilderKey = getContentBuilderKeyForBlockType(
        block.type,
        adminContentBlocks,
      );
      const blockTemplate = findEmailContentBlockTemplate(masterTemplate, {
        blockType: block.type,
        blockName: formatBlockTypeLabel(block.type),
        blockPath: block.contentBlockPath,
        contentBuilderKey,
      });
      const renderedHtml = renderBlockHtml(block);
      const configJson =
        typeof serializeBlockConfig === "function"
          ? serializeBlockConfig(block)
          : block.content ?? {};
      const blockMarkup = renderBlockPreviewFromTemplate({
        block,
        blockTemplate,
        renderedHtml,
        configJson,
      });
      return markInteractiveBlocks
        ? wrapEmailPreviewBlockHtml(block, blockMarkup)
        : blockMarkup;
    })
    .filter(Boolean)
    .join("");

  const contentHtml = blockHtml || emptyContentHtml;

  if (previewScope === "block") {
    return wrapBlockOnlyPreviewDocument(contentHtml);
  }

  const masterBody = String(masterTemplate?.templateBody ?? "").trim();
  const wrapper = masterBody || fallbackMasterWrapper;

  if (masterBody) {
    return injectMasterTemplateBodyContent(wrapper, contentHtml, {
      bodySlotKey: masterTemplate?.bodySlotKey,
      bodySlotLabel: masterTemplate?.bodySlotLabel,
    });
  }

  return populateTemplatePlaceholders(wrapper, {
    [EMAIL_TEMPLATE_CONTENT_PLACEHOLDER]: contentHtml,
  });
}
