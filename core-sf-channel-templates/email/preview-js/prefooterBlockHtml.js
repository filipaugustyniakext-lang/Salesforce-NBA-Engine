import {
  DEFAULT_EMAIL_BLOCK_PADDING_BOX,
  formatEmailSpacingBox,
  normalizeEmailSpacingBox,
} from "../emailBlockSchema.js";
import {
  normalizeRichTextParagraphContentForSchema,
  sanitizeRichTextHtmlFragment,
} from "../richTextContent.js";
import {
  applyPrefooterInlineDarkModeColorLock,
  PREFOOTER_INLINE_COLOR_DECLARATION,
} from "../prefooterInlineColor.js";
import {
  normalizePrefooterNodes,
  resolvePrefooterComponentsFromSchemaModel,
} from "../prefooterBlock.js";

const DEFAULT_PREFOOTER_PADDING = DEFAULT_EMAIL_BLOCK_PADDING_BOX;

const PREFOOTER_PARAGRAPH_STYLE =
  "line-height:22px;font-size:14px !important;font-weight:light !important;color:#333333 !important;";

const FOOTER_PRODUCT_WRAPPER_STYLE =
  "font-family:Arial, Helvetica, Sans-serif;font-size:13px;line-height:1;text-align:left;color:#333333 !important;";

const FOOTER_LEGAL_WRAPPER_STYLE =
  "font-family:Arial, Helvetica, Sans-serif;font-size:13px;line-height:1;text-align:left;color:#333333 !important;";

function populateTemplatePlaceholders(templateBody, replacements = {}) {
  let html = String(templateBody ?? "");
  for (const [placeholder, value] of Object.entries(replacements)) {
    if (!placeholder) continue;
    html = html.split(placeholder).join(String(value ?? ""));
  }
  return html;
}

function formatCellPaddingStyle(paddingValue) {
  const box = normalizeEmailSpacingBox(paddingValue ?? "");
  const top = String(box.top ?? "").trim() || DEFAULT_PREFOOTER_PADDING.top;
  const right =
    String(box.right ?? "").trim() || DEFAULT_PREFOOTER_PADDING.right;
  const bottom =
    String(box.bottom ?? "").trim() || DEFAULT_PREFOOTER_PADDING.bottom;
  const left = String(box.left ?? "").trim() || DEFAULT_PREFOOTER_PADDING.left;

  if (top === bottom && left === right && top === left) {
    return `padding:${top};`;
  }
  if (top === bottom && left === right) {
    return `padding:${top} ${right};`;
  }
  return `padding:${top} ${right} ${bottom} ${left};`;
}

function normalizeParagraphForPrefooter(content) {
  const normalized = normalizeRichTextParagraphContentForSchema(content);
  const html = applyPrefooterInlineDarkModeColorLock(
    sanitizeRichTextHtmlFragment(normalized),
  );
  if (!html) return "";
  if (/^<p[\s>]/i.test(html)) {
    return html.replace(/<p(\s[^>]*)?>/i, `<p style="${PREFOOTER_PARAGRAPH_STYLE}">`);
  }
  return `<p style="${PREFOOTER_PARAGRAPH_STYLE}">${html}</p>`;
}

function renderListForPrefooter(tag, items = []) {
  const renderedItems = (Array.isArray(items) ? items : [])
    .map((item) =>
      applyPrefooterInlineDarkModeColorLock(
        sanitizeRichTextHtmlFragment(item),
      ),
    )
    .filter(Boolean)
    .map(
      (item) =>
        `<li style="${PREFOOTER_INLINE_COLOR_DECLARATION};">${item}</li>`,
    )
    .join("");
  if (!renderedItems) return "";
  return `<${tag} style="${PREFOOTER_PARAGRAPH_STYLE}margin:0 0 8px 18px;padding:0;">${renderedItems}</${tag}>`;
}

function renderPrefooterRichTextHtml(
  nodes = [],
  { wrapperClass, wrapperStyle } = {},
) {
  const normalized = normalizePrefooterNodes(nodes);
  if (!normalized.length) {
    return applyPrefooterInlineDarkModeColorLock(
      `<div data-ogsc="" class="${wrapperClass}" style="${wrapperStyle}"><p style="${PREFOOTER_PARAGRAPH_STYLE}"><br></p></div>`,
    );
  }

  const parts = [];
  for (const node of normalized) {
    const type = Object.keys(node ?? {})[0];
    if (type === "paragraph") {
      const rendered = normalizeParagraphForPrefooter(node.paragraph);
      if (rendered) parts.push(rendered);
      continue;
    }
    if (type === "list_ordered") {
      const rendered = renderListForPrefooter("ol", node.list_ordered);
      if (rendered) parts.push(rendered);
      continue;
    }
    if (type === "list_unordered") {
      const rendered = renderListForPrefooter("ul", node.list_unordered);
      if (rendered) parts.push(rendered);
    }
  }

  const inner = parts.join("") || `<p style="${PREFOOTER_PARAGRAPH_STYLE}"><br></p>`;
  return applyPrefooterInlineDarkModeColorLock(
    `<div data-ogsc="" class="${wrapperClass}" style="${wrapperStyle}">${inner}</div>`,
  );
}

/**
 * Renders prefooter product copy as email-safe markup.
 */
export function renderPrefooterProductHtml(nodes = []) {
  return renderPrefooterRichTextHtml(nodes, {
    wrapperClass: "footer-product-text",
    wrapperStyle: FOOTER_PRODUCT_WRAPPER_STYLE,
  });
}

/**
 * Renders prefooter legal copy as email-safe markup (desktop + mobile share content).
 */
export function renderPrefooterLegalHtml(nodes = []) {
  return renderPrefooterRichTextHtml(nodes, {
    wrapperClass: "footer-legal-text",
    wrapperStyle: FOOTER_LEGAL_WRAPPER_STYLE,
  });
}

export function extractPrefooterComponentsFromConfig(configJson) {
  const model =
    typeof configJson === "string"
      ? (() => {
          try {
            return JSON.parse(configJson);
          } catch {
            return null;
          }
        })()
      : configJson;
  if (!model?.columns?.length) return null;
  return model.columns[0]?.components ?? [];
}

export function prefooterFieldsFromConfig(configJson) {
  const model =
    typeof configJson === "string"
      ? (() => {
          try {
            return JSON.parse(configJson);
          } catch {
            return null;
          }
        })()
      : configJson;
  if (!model?.columns?.length) return null;

  const { productNodes, legalNodes } =
    resolvePrefooterComponentsFromSchemaModel(model);

  return {
    productHtml: renderPrefooterProductHtml(productNodes),
    legalHtml: renderPrefooterLegalHtml(legalNodes),
    padding: formatEmailSpacingBox(model?.blockSettings?.padding ?? ""),
  };
}

export function populatePrefooterBlockBodyTemplate(
  blockBody,
  { productHtml = "", legalHtml = "", padding = "" } = {},
) {
  const template = String(blockBody ?? "").trim();
  if (!template) return "";

  const paddingStyle = formatCellPaddingStyle(padding);
  const productContent = String(productHtml ?? "").trim();
  const legalContent = String(legalHtml ?? "").trim();
  const hasProductPlaceholder = template.includes("{{PREFOOTER_PRODUCT_HTML}}");
  const hasLegalPlaceholder = template.includes("{{PREFOOTER_LEGAL_HTML}}");

  let html = populateTemplatePlaceholders(template, {
    "{{PREFOOTER_PRODUCT_HTML}}": productContent,
    "{{PREFOOTER_LEGAL_HTML}}": legalContent,
    "{{CELL_PADDING_STYLE}}": paddingStyle,
  });

  // Shells synced from SFMC may only declare one placeholder; still render full JSON.
  if (productContent && !hasProductPlaceholder) {
    html = `${productContent}${html}`;
  }
  if (legalContent && !hasLegalPlaceholder) {
    html = `${html}${legalContent}`;
  }

  return html;
}

export function populatePrefooterBlockFromEditorBlock(block, blockBody) {
  if (!block || block.type !== "Prefooter" || !Array.isArray(block.content)) {
    return "";
  }

  const productNodes = block.content[0]?.productNodes ?? [];
  const legalNodes = block.content[0]?.legalNodes ?? [];
  const blockSettings = block.content[1]?.blockSettings ?? {};

  return populatePrefooterBlockBodyTemplate(blockBody, {
    productHtml: renderPrefooterProductHtml(productNodes),
    legalHtml: renderPrefooterLegalHtml(legalNodes),
    padding: formatEmailSpacingBox(blockSettings.padding ?? ""),
  });
}

export function populatePrefooterBlockFromConfig(configJson, blockBody) {
  const fields = prefooterFieldsFromConfig(configJson);
  if (!fields) return "";
  return populatePrefooterBlockBodyTemplate(blockBody, fields);
}
