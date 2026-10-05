/** MCE Content Builder folder paths for email content blocks. */
export const EMAIL_CONTENT_BLOCKS_FOLDER =
  "Content Builder\\00_Admin\\Custom Apps\\Content Center\\Channels\\Email\\Content Blocks";

function contentBuilderPath(assetName) {
  return `${EMAIL_CONTENT_BLOCKS_FOLDER}\\${assetName}`;
}

export const HARDCODED_EMAIL_CONTENT_BLOCK_DEFS = [
  {
    id: "cb-textimage",
    name: "Text-Image (LR/RL)",
    type: "TextImage",
    contentBuilderKey: contentBuilderPath("CODE_GL_TextImage (LR/RL)"),
    shellResourceKey: "SFMC_CB_Email_TextImage",
  },
  {
    id: "cb-banner",
    name: "Banner (LR/RL)",
    type: "Banner",
    contentBuilderKey: contentBuilderPath("CODE_GL_Banner (LR/RL)"),
    shellResourceKey: "SFMC_CB_Email_Banner",
  },
  {
    id: "cb-richtext",
    name: "Rich Text",
    type: "RichText",
    contentBuilderKey: contentBuilderPath("CODE_GL_RichText"),
    shellResourceKey: "SFMC_CB_Email_RichText",
  },
  {
    id: "cb-image",
    name: "Image",
    type: "Image",
    contentBuilderKey: contentBuilderPath("CODE_GL_Image"),
    shellResourceKey: "SFMC_CB_Email_Image",
  },
  {
    id: "cb-prefooter",
    name: "Prefooter",
    type: "Prefooter",
    contentBuilderKey: contentBuilderPath("CODE_GL_PreFooter"),
    shellResourceKey: "SFMC_CB_Email_Prefooter",
  },
  {
    id: "cb-arrowlist",
    name: "ArrowList",
    type: "ArrowList",
    contentBuilderKey: contentBuilderPath("CODE_GL_ArrowList"),
    shellResourceKey: "SFMC_CB_Email_RichText",
  },
];

export const HARDCODED_EMAIL_CONTENT_BLOCK_IDS =
  HARDCODED_EMAIL_CONTENT_BLOCK_DEFS.map((block) => block.id);

const shellKeyByContentBuilderPath = new Map(
  HARDCODED_EMAIL_CONTENT_BLOCK_DEFS.map((block) => [
    block.contentBuilderKey,
    block.shellResourceKey,
  ]),
);

export function resolveShellResourceKeyForContentBuilderPath(path = "") {
  const normalized = String(path ?? "").trim();
  if (!normalized) return "";
  return shellKeyByContentBuilderPath.get(normalized) ?? "";
}

export function applyHardcodedContentBlockDefaults(block = {}) {
  const id = String(block.id ?? "").trim();
  const hardcoded = HARDCODED_EMAIL_CONTENT_BLOCK_DEFS.find(
    (entry) => entry.id === id,
  );
  if (!hardcoded) {
    return block;
  }
  return {
    ...block,
    name: hardcoded.name,
    type: hardcoded.type,
    contentBuilderKey: hardcoded.contentBuilderKey,
    shellResourceKey: hardcoded.shellResourceKey,
  };
}

export function resolveContentBuilderPathForBlockType(blockType = "") {
  const type = String(blockType ?? "").trim();
  if (!type) return "";
  const match = HARDCODED_EMAIL_CONTENT_BLOCK_DEFS.find(
    (block) => block.type === type,
  );
  return String(match?.contentBuilderKey ?? "").trim();
}

export function resolveContentBuilderPathForBlock(block = {}) {
  return resolveContentBuilderPathForBlockType(block?.type);
}

export function buildHardcodedEmailContentBlockAdminEntry(
  blockDef,
  { jsonFormat = "" } = {},
) {
  return {
    id: blockDef.id,
    name: blockDef.name,
    type: blockDef.type,
    contentBuilderKey: blockDef.contentBuilderKey,
    shellResourceKey: blockDef.shellResourceKey,
    jsonFormat,
    htmlShell: "",
    mceSourceModifiedAt: "",
  };
}
