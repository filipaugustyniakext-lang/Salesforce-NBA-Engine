import {
  isMceUuidCustomerKey,
  sanitizeCodeResourceName,
} from "./adminMasterTemplateSync.js";

/** CloudPages URL keys must not be MCE UUID customer keys. */
export function resolveMasterShellResourceKey(template = {}) {
  if (!template || typeof template !== "object") template = {};
  const explicit = String(template.shellResourceKey ?? "").trim();
  if (explicit && !isMceUuidCustomerKey(explicit)) {
    return explicit;
  }

  const fromDisplayName = sanitizeCodeResourceName(
    template.contentBuilderTemplateName ?? "",
  );
  if (fromDisplayName) return fromDisplayName;

  const fromName = sanitizeCodeResourceName(template.name ?? "");
  if (fromName) return fromName;

  const fromKey = String(template.contentBuilderTemplateKey ?? "").trim();
  if (fromKey && !isMceUuidCustomerKey(fromKey)) return fromKey;

  return fromDisplayName || fromName || explicit;
}

/** Ordered URL candidates for loading a master template shell from Code Resources. */
export function listMasterShellResourceKeyCandidates(
  template = {},
  { extraKeys = [], versionFallbacks = true } = {},
) {
  if (!template || typeof template !== "object") template = {};
  const candidates = [];
  const add = (value) => {
    const key = String(value ?? "").trim();
    if (!key || isMceUuidCustomerKey(key)) return;
    if (!candidates.includes(key)) candidates.push(key);
  };

  for (const key of Array.isArray(extraKeys) ? extraKeys : []) {
    add(key);
  }
  add(template.publishedShellResourceKey);
  add(template.shellResourceKey);
  add(sanitizeCodeResourceName(template.contentBuilderTemplateName));
  add(sanitizeCodeResourceName(template.name));
  add(template.contentBuilderTemplateKey);

  return versionFallbacks
    ? appendVersionFallbackShellKeys(candidates)
    : candidates;
}

/** Resolve configured shell key without probing CloudPages URLs (admin sync/picker). */
export function resolveConfiguredMasterShellResourceKey({
  preferredKeys = [],
  mceTemplateName = "",
  existingShellKey = "",
} = {}) {
  for (const key of preferredKeys) {
    const resolved = sanitizeCodeResourceName(key);
    if (resolved) return resolved;
  }
  const fromName = sanitizeCodeResourceName(mceTemplateName);
  if (fromName) return fromName;
  const existing = sanitizeCodeResourceName(existingShellKey);
  if (existing) return existing;
  return "";
}

/** e.g. TMP_GL_GEN_Commercial_V6 → also try _V5, _V4 when newer shell is missing. */
export function appendVersionFallbackShellKeys(candidates = [], maxSteps = 3) {
  const result = [...candidates];
  const add = (value) => {
    const key = String(value ?? "").trim();
    if (!key || isMceUuidCustomerKey(key)) return;
    if (!result.includes(key)) result.push(key);
  };

  for (const key of candidates) {
    const match = key.match(/^(.*)_V(\d+)$/i);
    if (!match) continue;
    const prefix = match[1];
    const version = Number.parseInt(match[2], 10);
    if (Number.isNaN(version) || version <= 1) continue;
    for (
      let step = 1;
      step <= maxSteps && version - step >= 1;
      step += 1
    ) {
      add(`${prefix}_V${version - step}`);
    }
  }

  return result;
}

export function createMasterShellLoadStatus(adminTemplate = {}) {
  if (!adminTemplate || typeof adminTemplate !== "object") adminTemplate = {};
  const primaryShellKey = resolveMasterShellResourceKey(adminTemplate);
  const templateLabel =
    String(adminTemplate.contentBuilderTemplateName ?? "").trim() ||
    String(adminTemplate.name ?? "").trim() ||
    primaryShellKey ||
    "master template";

  return {
    templateLabel,
    primaryShellKey,
    loadedShellKey: "",
    attemptedKeys: listMasterShellResourceKeyCandidates(adminTemplate),
    usedFallback: false,
    primaryLoadFailed: false,
    message: "",
  };
}

export function buildMasterShellLoadWarning(status = {}) {
  if (!status?.message) return "";
  return String(status.message).trim();
}
