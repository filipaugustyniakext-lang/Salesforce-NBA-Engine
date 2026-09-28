import { isCloudPagesRuntime } from "../config/runtimeConfig.js";
import { resolveMockDataUrl } from "../config/runtimeConfig.js";
import {
  syncMceContentBlock,
  syncMceMasterTemplate,
} from "./adminMasterTemplateSync.js";
import { listMasterShellResourceKeyCandidates } from "./masterShellResolver.js";
import {
  resolveMasterTemplateShellResourceKey,
  resolveShellResourceKey,
} from "./syncManifest.js";

const shellCache = new Map();

export function primeShellCache(shellResourceKey = "", html = "") {
  const key = String(shellResourceKey ?? "").trim();
  const body = String(html ?? "").trim();
  if (!key || !body) return;
  shellCache.set(key, body);
}

export function getCachedShell(shellResourceKey = "") {
  const key = String(shellResourceKey ?? "").trim();
  if (!key) return "";
  return String(shellCache.get(key) ?? "").trim();
}

export function clearShellCache() {
  shellCache.clear();
}

async function fetchShellTextFromUrl(shellResourceKey = "") {
  const url = resolveMockDataUrl(shellResourceKey);
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Shell resource not found (${response.status}).`);
  }
  return String(await response.text()).trim();
}

async function ensureMasterTemplateShell(template = {}) {
  const shellResourceKey = resolveShellResourceKey(
    template,
    template.contentBuilderTemplateKey,
  );
  const mcePath = String(template.contentBuilderTemplateKey ?? "").trim();
  if (!shellResourceKey || !mcePath) return "";

  const payload = await syncMceMasterTemplate(mcePath, { shellResourceKey });
  const html = String(payload?.template?.htmlWrapper ?? "").trim();
  if (html) {
    primeShellCache(shellResourceKey, html);
    return html;
  }
  return "";
}

async function ensureContentBlockShell(block = {}) {
  const shellResourceKey = resolveShellResourceKey(
    block,
    block.contentBuilderKey,
  );
  const mcePath = String(block.contentBuilderKey ?? "").trim();
  if (!shellResourceKey || !mcePath) return "";

  const payload = await syncMceContentBlock(mcePath, { shellResourceKey });
  const html = String(payload?.block?.htmlShell ?? "").trim();
  if (html) {
    primeShellCache(shellResourceKey, html);
    return html;
  }
  return "";
}

export async function fetchShellFromResource(
  shellResourceKey = "",
  fetchText,
) {
  const key = String(shellResourceKey ?? "").trim();
  if (!key) return "";
  if (shellCache.has(key)) return shellCache.get(key);

  const loadText =
    typeof fetchText === "function" ? fetchText : fetchShellTextFromUrl;
  const body = String(await loadText(key)).trim();
  if (body) shellCache.set(key, body);
  return body;
}

export async function hydrateSelectedMasterShell(
  adminTemplate = {},
  { autoEnsureMissingShells = true } = {},
) {
  if (!adminTemplate || typeof adminTemplate !== "object") return "";
  if (String(adminTemplate.htmlWrapper ?? "").trim()) {
    return String(adminTemplate.htmlWrapper).trim();
  }

  const candidates = listMasterShellResourceKeyCandidates(adminTemplate);
  for (const shellResourceKey of candidates) {
    const cached = getCachedShell(shellResourceKey);
    if (cached) {
      adminTemplate.htmlWrapper = cached;
      return cached;
    }
    try {
      adminTemplate.htmlWrapper = await fetchShellFromResource(shellResourceKey);
      if (adminTemplate.htmlWrapper) return adminTemplate.htmlWrapper;
    } catch (error) {
      // Try the next candidate shell key.
    }
  }

  const shouldAutoEnsure = autoEnsureMissingShells && isCloudPagesRuntime();
  const shellResourceKey = resolveMasterTemplateShellResourceKey(adminTemplate);
  if (!shellResourceKey) return "";

  try {
    throw new Error(`Shell resource not found (${shellResourceKey}).`);
  } catch (error) {
    if (!shouldAutoEnsure) {
      adminTemplate.htmlWrapper = "";
      return "";
    }
    try {
      adminTemplate.htmlWrapper = await ensureMasterTemplateShell(adminTemplate);
      return adminTemplate.htmlWrapper;
    } catch (ensureError) {
      console.warn(
        `[Content Center] Could not load or create selected master shell "${shellResourceKey}".`,
        ensureError,
      );
      adminTemplate.htmlWrapper = "";
      return "";
    }
  }
}

export async function hydrateAdminConfigShells(
  adminConfig = {},
  {
    autoEnsureMissingShells = true,
    preferredMasterTemplateId = "",
    mastersScope = "all",
  } = {},
) {
  const preferredId = String(preferredMasterTemplateId ?? "").trim();
  const preferredTemplateIds = new Set();
  if (preferredId) {
    const preferredTemplate = (adminConfig.masterTemplates ?? []).find(
      (template) =>
        template.id === preferredId ||
        template.contentBuilderTemplateKey === preferredId ||
        template.shellResourceKey === preferredId,
    );
    if (preferredTemplate) {
      preferredTemplateIds.add(preferredTemplate.id);
      await hydrateSelectedMasterShell(preferredTemplate, {
        autoEnsureMissingShells,
      });
    }
  }
  const shouldAutoEnsure = autoEnsureMissingShells && isCloudPagesRuntime();
  const shouldHydrateOtherMasters = mastersScope === "all";

  const masterJobs = (
    shouldHydrateOtherMasters ? (adminConfig.masterTemplates ?? []) : []
  )
    .filter(
      (template) =>
        !preferredTemplateIds.has(template.id) &&
        !String(template.htmlWrapper ?? "").trim() &&
        hasShellResourceKey(template, template.contentBuilderTemplateKey),
    )
    .map(async (template) => {
      const shellResourceKey = resolveShellResourceKey(
        template,
        template.contentBuilderTemplateKey,
      );
      try {
        template.htmlWrapper = await fetchShellFromResource(shellResourceKey);
      } catch (error) {
        if (!shouldAutoEnsure) {
          template.htmlWrapper = "";
          return;
        }
        try {
          template.htmlWrapper = await ensureMasterTemplateShell(template);
        } catch (ensureError) {
          console.warn(
            `[Content Center] Could not load or create shell "${shellResourceKey}".`,
            ensureError,
          );
          template.htmlWrapper = "";
        }
      }
    });

  const blockJobs = (adminConfig.contentBlocks ?? [])
    .filter(
      (block) =>
        !String(block.htmlShell ?? "").trim() &&
        hasShellResourceKey(block, block.contentBuilderKey),
    )
    .map(async (block) => {
      const shellResourceKey = resolveShellResourceKey(
        block,
        block.contentBuilderKey,
      );
      try {
        block.htmlShell = await fetchShellFromResource(shellResourceKey);
      } catch (error) {
        if (!shouldAutoEnsure) {
          block.htmlShell = "";
          return;
        }
        try {
          block.htmlShell = await ensureContentBlockShell(block);
        } catch (ensureError) {
          console.warn(
            `[Content Center] Could not load or create block shell "${shellResourceKey}".`,
            ensureError,
          );
          block.htmlShell = "";
        }
      }
    });

  await Promise.all([...masterJobs, ...blockJobs]);
}

function hasShellResourceKey(entity = {}, fallbackKey = "") {
  return Boolean(resolveShellResourceKey(entity, fallbackKey));
}
