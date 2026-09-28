import {
  deriveBodySlotFromMasterTemplateSlots,
  extractMasterTemplateSlotInnerHtml,
} from "./blockTypeRegistry.js";
import {
  extractReferenceBlockIdFromSlotContent,
  findEmailContentBlockTemplate,
  prepareMasterShellHtmlForPreview,
} from "./emailTemplatePreview.js";
import { deriveShellResourceKeyFromMceAsset } from "./adminMasterTemplateSync.js";
import {
  buildMasterShellLoadWarning,
  createMasterShellLoadStatus,
  listMasterShellResourceKeyCandidates,
  resolveMasterShellResourceKey,
} from "./masterShellResolver.js";
import {
  hasSyncedMasterShellPointer,
  resolveShellResourceKey,
} from "./syncManifest.js";
import {
  fetchShellFromResource,
  getCachedShell,
  primeShellCache,
} from "./syncShellLoader.js";

const DEFAULT_COMMERCIAL_MASTER_SHELL_KEY = "SFMC_CB_Email_Master_Commercial";

function normalizeAdminTemplate(adminTemplate) {
  return adminTemplate && typeof adminTemplate === "object" ? adminTemplate : {};
}

export function hasSyncedAdminMasterHtml(adminTemplate = {}) {
  adminTemplate = normalizeAdminTemplate(adminTemplate);
  const htmlWrapper = String(adminTemplate.htmlWrapper ?? "").trim();
  if (htmlWrapper) return true;
  return hasSyncedMasterShellPointer(adminTemplate);
}

function toPreviewBlockEntry(block = {}) {
  const blockPath = String(block.contentBuilderKey ?? block.blockPath ?? "").trim();
  const blockBody = String(block.htmlShell ?? block.blockBody ?? "").trim();
  if (!blockPath || !blockBody) return null;

  return {
    blockName: String(block.name ?? block.blockName ?? blockPath).trim(),
    blockPath,
    blockBody,
    blockBodyFile: "",
  };
}

function shouldRepairShellResourceKey(template = {}) {
  const current = String(template.shellResourceKey ?? "").trim();
  return (
    !current ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      current,
    )
  );
}

export async function pickPublishedMasterShellResourceKey(
  {
    preferredKeys = [],
    mceTemplateName = "",
    customerKey = "",
    existingShellKey = "",
  } = {},
  { fetchShell = fetchShellFromResource } = {},
) {
  const candidates = listMasterShellResourceKeyCandidates(
    {
      shellResourceKey: existingShellKey,
      contentBuilderTemplateName: mceTemplateName,
      contentBuilderTemplateKey: customerKey,
    },
    { extraKeys: preferredKeys, versionFallbacks: true },
  );

  for (const shellResourceKey of candidates) {
    const cached = getCachedShell(shellResourceKey);
    if (cached) {
      return {
        shellKey: shellResourceKey,
        html: cached,
        source: "cache",
        attemptedKeys: candidates,
      };
    }
    try {
      const html = String((await fetchShell(shellResourceKey)) ?? "").trim();
      if (html) {
        primeShellCache(shellResourceKey, html);
        return {
          shellKey: shellResourceKey,
          html,
          source: "fetch",
          attemptedKeys: candidates,
        };
      }
    } catch (error) {
      console.warn(
        `[Content Center] Published shell not found at "${shellResourceKey}".`,
        error,
      );
    }
  }

  const fallbackKey =
    sanitizePreferredShellKey(existingShellKey) ||
    sanitizePreferredShellKey(
      deriveShellResourceKeyFromMceAsset({
        name: mceTemplateName,
        customerKey,
        existingShellKey,
      }),
    ) ||
    candidates[0] ||
    "";

  return {
    shellKey: fallbackKey,
    html: "",
    source: "missing",
    attemptedKeys: candidates,
  };
}

function sanitizePreferredShellKey(value = "") {
  const key = String(value ?? "").trim();
  if (!key || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
    return "";
  }
  return key;
}

export async function fetchMasterShellHtmlByCandidates(
  adminTemplate = {},
  { fetchShell = fetchShellFromResource, extraKeys = [] } = {},
) {
  adminTemplate = normalizeAdminTemplate(adminTemplate);
  const inline = String(adminTemplate.htmlWrapper ?? "").trim();
  if (inline) {
    return {
      html: inline,
      shellKey: resolveMasterShellResourceKey(adminTemplate),
      source: "inline",
      attemptedKeys: [],
    };
  }

  const candidates = listMasterShellResourceKeyCandidates(adminTemplate, {
    extraKeys,
  });
  const attemptedKeys = [];

  for (const shellResourceKey of candidates) {
    attemptedKeys.push(shellResourceKey);
    const cached = getCachedShell(shellResourceKey);
    if (cached) {
      adminTemplate.htmlWrapper = cached;
      if (shouldRepairShellResourceKey(adminTemplate)) {
        adminTemplate.shellResourceKey = shellResourceKey;
      }
      return {
        html: cached,
        shellKey: shellResourceKey,
        source: "cache",
        attemptedKeys,
      };
    }

    try {
      const html = String((await fetchShell(shellResourceKey)) ?? "").trim();
      if (html) {
        primeShellCache(shellResourceKey, html);
        adminTemplate.htmlWrapper = html;
        if (shouldRepairShellResourceKey(adminTemplate)) {
          adminTemplate.shellResourceKey = shellResourceKey;
        }
        return {
          html,
          shellKey: shellResourceKey,
          source: "fetch",
          attemptedKeys,
        };
      }
    } catch (error) {
      console.warn(
        `[Content Center] Master shell not found at "${shellResourceKey}".`,
        error,
      );
    }
  }

  return {
    html: "",
    shellKey: "",
    source: "missing",
    attemptedKeys,
  };
}

/** @deprecated Use fetchMasterShellHtmlByCandidates — kept for simple string callers. */
export async function resolveAdminMasterShellHtml(
  adminTemplate = {},
  { fetchShell = fetchShellFromResource } = {},
) {
  const result = await fetchMasterShellHtmlByCandidates(adminTemplate, {
    fetchShell,
  });
  return result.html;
}

export async function resolveCommercialMasterFallbackShell(
  adminMasterTemplates = [],
  { fetchShell = fetchShellFromResource } = {},
) {
  const commercialTemplate = (adminMasterTemplates ?? []).find(
    (template) =>
      String(template.shellResourceKey ?? "").trim() ===
        DEFAULT_COMMERCIAL_MASTER_SHELL_KEY ||
      String(template.contentBuilderTemplateKey ?? "").trim() ===
        DEFAULT_COMMERCIAL_MASTER_SHELL_KEY,
  );

  let html = String(commercialTemplate?.htmlWrapper ?? "").trim();
  if (!html) {
    html = getCachedShell(DEFAULT_COMMERCIAL_MASTER_SHELL_KEY);
  }
  if (!html) {
    html = await resolveAdminMasterShellHtml(
      commercialTemplate ?? {
        shellResourceKey: DEFAULT_COMMERCIAL_MASTER_SHELL_KEY,
        contentBuilderTemplateKey: DEFAULT_COMMERCIAL_MASTER_SHELL_KEY,
      },
      { fetchShell },
    );
  }
  if (!html) {
    try {
      html = String(
        (await fetchShell(DEFAULT_COMMERCIAL_MASTER_SHELL_KEY)) ?? "",
      ).trim();
      if (html) primeShellCache(DEFAULT_COMMERCIAL_MASTER_SHELL_KEY, html);
    } catch (error) {
      html = "";
    }
  }
  return html;
}

export function buildAdminMasterTemplateForPreview(
  adminTemplate = {},
  adminContentBlocks = [],
  { shellHtml = "" } = {},
) {
  adminTemplate = normalizeAdminTemplate(adminTemplate);
  const htmlWrapper =
    String(shellHtml ?? "").trim() ||
    String(adminTemplate.htmlWrapper ?? "").trim() ||
    getCachedShell(resolveMasterShellResourceKey(adminTemplate));

  if (!htmlWrapper) {
    if (!hasSyncedAdminMasterHtml(adminTemplate)) return null;
    return null;
  }

  const supportedIds = new Set(adminTemplate.supportedContentBlockIds ?? []);
  const contentBlocks = (adminContentBlocks ?? [])
    .filter((block) => supportedIds.has(block.id))
    .map(toPreviewBlockEntry)
    .filter(Boolean);
  const derivedBodySlot = deriveBodySlotFromMasterTemplateSlots(
    adminTemplate.masterTemplateSlots ?? [],
  );
  const bodySlotKey =
    String(adminTemplate.bodySlotKey ?? derivedBodySlot.bodySlotKey).trim();
  const bodySlotLabel =
    String(adminTemplate.bodySlotLabel ?? derivedBodySlot.bodySlotLabel).trim() ||
    "BODY";

  return {
    templateName:
      String(adminTemplate.name ?? "").trim() ||
      String(adminTemplate.contentBuilderTemplateName ?? "").trim(),
    templatePath: String(adminTemplate.contentBuilderTemplateKey ?? "").trim(),
    templateBody: htmlWrapper,
    templateBodyFile: "",
    bodySlotKey,
    bodySlotLabel,
    contentBlocks,
  };
}

export async function buildAdminMasterTemplateForPreviewAsync(
  adminTemplate = {},
  adminContentBlocks = [],
  {
    fetchShell = fetchShellFromResource,
    adminMasterTemplates = [],
    fetchReferenceBlockHtml = null,
  } = {},
) {
  adminTemplate = normalizeAdminTemplate(adminTemplate);
  const shellStatus = createMasterShellLoadStatus(adminTemplate);
  const primaryResolution = await fetchMasterShellHtmlByCandidates(adminTemplate, {
    fetchShell,
  });
  shellStatus.attemptedKeys = primaryResolution.attemptedKeys;

  let shellHtml = primaryResolution.html;
  let loadedShellKey = primaryResolution.shellKey;

  if (!shellHtml) {
    shellStatus.primaryLoadFailed = true;
    const fallbackHtml = await resolveCommercialMasterFallbackShell(
      adminMasterTemplates,
      { fetchShell },
    );
    if (fallbackHtml) {
      shellHtml = fallbackHtml;
      loadedShellKey = DEFAULT_COMMERCIAL_MASTER_SHELL_KEY;
      shellStatus.usedFallback = true;
      shellStatus.loadedShellKey = loadedShellKey;
      shellStatus.message =
        `Template shell for "${shellStatus.templateLabel}" was not found` +
        (shellStatus.primaryShellKey
          ? ` (tried: ${shellStatus.attemptedKeys.join(", ")})`
          : "") +
        `. Preview uses fallback shell "${DEFAULT_COMMERCIAL_MASTER_SHELL_KEY}".`;
    } else {
      shellStatus.message =
        `Template shell for "${shellStatus.templateLabel}" was not found` +
        (shellStatus.attemptedKeys.length
          ? ` (tried: ${shellStatus.attemptedKeys.join(", ")})`
          : "") +
        ", and no fallback shell is available.";
      return { entry: null, shellStatus };
    }
  } else {
    shellStatus.loadedShellKey = loadedShellKey;
  }

  const primaryShellKey = loadedShellKey || resolveMasterShellResourceKey(adminTemplate);
  const fixedSlots = (adminTemplate.masterTemplateSlots ?? [])
    .filter((slot) => slot?.role === "fixed")
    .map((slot) => {
      const slotInner = extractMasterTemplateSlotInnerHtml(shellHtml, {
        slotKey: slot.slotKey,
        slotLabel: slot.slotLabel,
      });
      const referenceBlockId =
        String(slot.referenceBlockId ?? "").trim() ||
        extractReferenceBlockIdFromSlotContent(slotInner);
      return referenceBlockId ? { ...slot, referenceBlockId } : slot;
    });
  const canUseCommercialFallback =
    !shellStatus.usedFallback &&
    fixedSlots.length > 0 &&
    primaryShellKey !== DEFAULT_COMMERCIAL_MASTER_SHELL_KEY;
  const preparedShellHtml = await prepareMasterShellHtmlForPreview(shellHtml, {
    fixedSlots,
    fetchReferenceBlockHtml,
    resolveFallbackShell: canUseCommercialFallback
      ? () =>
          resolveCommercialMasterFallbackShell(adminMasterTemplates, {
            fetchShell,
          })
      : null,
  });

  const entry = buildAdminMasterTemplateForPreview(
    adminTemplate,
    adminContentBlocks,
    { shellHtml: preparedShellHtml },
  );

  if (!entry) {
    shellStatus.message =
      buildMasterShellLoadWarning(shellStatus) ||
      `Could not build preview for "${shellStatus.templateLabel}".`;
    return { entry: null, shellStatus };
  }

  shellStatus.message = "";
  return { entry, shellStatus };
}

export function mergeAdminMasterTemplateWithMock(
  adminEntry,
  mockEntry,
  adminContentBlocks = [],
) {
  if (!adminEntry) return mockEntry ?? null;

  const merged = {
    ...adminEntry,
    templateBody:
      String(adminEntry.templateBody ?? "").trim() ||
      String(mockEntry?.templateBody ?? "").trim(),
    bodySlotKey:
      adminEntry.bodySlotKey ||
      String(mockEntry?.bodySlotKey ?? "").trim(),
    bodySlotLabel:
      adminEntry.bodySlotLabel ||
      String(mockEntry?.bodySlotLabel ?? "BODY").trim() ||
      "BODY",
    contentBlocks: [...(adminEntry.contentBlocks ?? [])],
  };

  const byPath = new Map(
    merged.contentBlocks.map((block) => [block.blockPath, block]),
  );

  for (const adminBlock of adminContentBlocks ?? []) {
    const previewBlock = toPreviewBlockEntry(adminBlock);
    if (!previewBlock || byPath.has(previewBlock.blockPath)) continue;
    byPath.set(previewBlock.blockPath, previewBlock);
  }

  for (const mockBlock of mockEntry?.contentBlocks ?? []) {
    const path = String(mockBlock.blockPath ?? "").trim();
    if (!path || byPath.has(path)) continue;
    const blockBody = String(mockBlock.blockBody ?? "").trim();
    if (!blockBody) continue;
    byPath.set(path, {
      blockName: String(mockBlock.blockName ?? path).trim(),
      blockPath: path,
      blockBody,
      blockBodyFile: "",
    });
  }

  merged.contentBlocks = [...byPath.values()];
  return merged;
}

export function resolveAdminContentBlockShell(
  adminContentBlocks = [],
  { blockType = "", contentBuilderKey = "", blockPath = "" } = {},
  mockMasterTemplate = null,
) {
  const key = String(contentBuilderKey ?? blockPath ?? "").trim();
  const adminBlock = (adminContentBlocks ?? []).find(
    (block) => block.contentBuilderKey === key,
  );
  const adminShell = String(adminBlock?.htmlShell ?? "").trim();
  if (adminShell) {
    return {
      blockBody: adminShell,
      source: "admin",
      adminBlock,
    };
  }

  const mockBlock = findEmailContentBlockTemplate(mockMasterTemplate, {
    blockType,
    contentBuilderKey: key,
    blockPath: key,
  });
  const mockShell = String(mockBlock?.blockBody ?? "").trim();
  if (mockShell) {
    return { blockBody: mockShell, source: "mock", adminBlock };
  }

  return { blockBody: "", source: "none", adminBlock };
}
