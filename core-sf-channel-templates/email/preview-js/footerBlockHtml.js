import {
  formatEmailSpacingBox,
  normalizeEmailSpacingBox,
} from "../emailBlockSchema.js";
import {
  normalizeRichTextParagraphContentForSchema,
  sanitizeRichTextHtmlFragment,
} from "../richTextContent.js";
import {
  DEFAULT_FOOTER_COPYRIGHT_TEXT,
  DEFAULT_FOOTER_LEGAL_NOTE_TEXT,
  DEFAULT_FOOTER_SECTION_PADDING,
  FOOTER_LOGO_URL,
  normalizeFooterNodes,
  schemaContentToFooterNodes,
} from "../footerBlock.js";

const FOOTER_TEXT_COLOR = "#CCCCCC";
const FOOTER_LEGAL_PARAGRAPH_STYLE = `line-height:22px;font-size:14px !important;font-weight:light !important;color:${FOOTER_TEXT_COLOR};`;
const FOOTER_COPYRIGHT_PARAGRAPH_STYLE = `font-size:14px !important;font-weight:light !important;color:#cccccc;`;
const FOOTER_WRAPPER_STYLE = `font-family:Arial, Helvetica, Sans-serif;font-size:13px;line-height:1;text-align:center;color:${FOOTER_TEXT_COLOR};`;
const FOOTER_LOGO_WIDTH = "107";

function populateTemplatePlaceholders(templateBody, replacements = {}) {
  let html = String(templateBody ?? "");
  for (const [placeholder, value] of Object.entries(replacements)) {
    if (!placeholder) continue;
    html = html.split(placeholder).join(String(value ?? ""));
  }
  return html;
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatFooterSectionPadding(paddingValue) {
  const box = normalizeEmailSpacingBox(paddingValue ?? DEFAULT_FOOTER_SECTION_PADDING);
  const top = String(box.top ?? "").trim() || DEFAULT_FOOTER_SECTION_PADDING.top;
  const right =
    String(box.right ?? "").trim() || DEFAULT_FOOTER_SECTION_PADDING.right;
  const bottom =
    String(box.bottom ?? "").trim() || DEFAULT_FOOTER_SECTION_PADDING.bottom;
  const left = String(box.left ?? "").trim() || DEFAULT_FOOTER_SECTION_PADDING.left;

  if (top === bottom && left === right && top === left) {
    return `padding:${top};`;
  }
  if (top === bottom && left === right) {
    return `padding:${top} ${right};`;
  }
  return `padding:${top} ${right} ${bottom} ${left};`;
}

function normalizeParagraphForFooter(content, paragraphStyle) {
  const normalized = normalizeRichTextParagraphContentForSchema(content);
  const html = sanitizeRichTextHtmlFragment(normalized);
  if (!html) return "";
  if (/^<p[\s>]/i.test(html)) {
    return html.replace(/<p(\s[^>]*)?>/i, `<p style="${paragraphStyle}">`);
  }
  return `<p style="${paragraphStyle}">${html}</p>`;
}

function renderListForFooter(tag, items = [], paragraphStyle) {
  const renderedItems = (Array.isArray(items) ? items : [])
    .map((item) => sanitizeRichTextHtmlFragment(item))
    .filter(Boolean)
    .map((item) => `<li>${item}</li>`)
    .join("");
  if (!renderedItems) return "";
  return `<${tag} style="${paragraphStyle}margin:0 0 8px 18px;padding:0;text-align:left;">${renderedItems}</${tag}>`;
}

export function renderFooterRichTextInnerHtml(nodes = [], paragraphStyle) {
  const normalized = normalizeFooterNodes(nodes);
  if (!normalized.length) {
    return `<p style="${paragraphStyle}"><br></p>`;
  }

  const parts = [];
  for (const node of normalized) {
    const type = Object.keys(node ?? {})[0];
    if (type === "paragraph") {
      const rendered = normalizeParagraphForFooter(node.paragraph, paragraphStyle);
      if (rendered) parts.push(rendered);
      continue;
    }
    if (type === "list_ordered") {
      const rendered = renderListForFooter("ol", node.list_ordered, paragraphStyle);
      if (rendered) parts.push(rendered);
      continue;
    }
    if (type === "list_unordered") {
      const rendered = renderListForFooter("ul", node.list_unordered, paragraphStyle);
      if (rendered) parts.push(rendered);
    }
  }

  return parts.join("") || `<p style="${paragraphStyle}"><br></p>`;
}

export function renderFooterLogoHtml() {
  return `<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;">
                        <tr>
                          <td style="width:${FOOTER_LOGO_WIDTH}px;padding-top:10px;padding-bottom:20px;">
                            <img alt="" src="${escapeAttr(FOOTER_LOGO_URL)}" style="border:0;display:block;outline:none;text-decoration:none;height:auto;width:100%;font-size:13px;" width="${FOOTER_LOGO_WIDTH}" height="auto">
                          </td>
                        </tr>
                      </table>`;
}

export function renderFooterLegalSectionHtml(nodes = [], padding = "") {
  const inner = renderFooterRichTextInnerHtml(nodes, FOOTER_LEGAL_PARAGRAPH_STYLE);
  const cellPadding = formatFooterSectionPadding(padding);

  return `<!--Footer Legal Note-->
<!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#262626" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
<div style="background-color:#262626;margin:0px auto;max-width:600px;">
  <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#010101;background-color:#010101;width:100%;background: linear-gradient(#262626, #262626); background-color: #262626;">
    <tr>
      <td style="direction:ltr;font-size:0px;${cellPadding}text-align:center;">
        <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
        <div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;">
          <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%">
            <tr>
              <td align="center" style="font-size:0px;padding:0;word-break:break-word;">
                <div style="${FOOTER_WRAPPER_STYLE}">
                  ${inner}
                </div>
              </td>
            </tr>
          </table>
        </div>
        <!--[if mso | IE]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</div>
<!--[if mso | IE]></td></tr></table><![endif]-->`;
}

export function renderFooterCopyrightSectionHtml(nodes = [], padding = "") {
  const copyrightInner = renderFooterRichTextInnerHtml(
    nodes,
    FOOTER_COPYRIGHT_PARAGRAPH_STYLE,
  );
  const cellPadding = formatFooterSectionPadding(padding);
  const logoHtml = renderFooterLogoHtml();

  return `<!--Footer Copyrights-->
<!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#262626" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
<div style="background-color:#262626;margin:0px auto;max-width:600px;">
  <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#010101;background-color:#010101;width:100%;background: linear-gradient(#262626, #262626); background-color: #262626;">
    <tr>
      <td style="direction:ltr;font-size:0px;${cellPadding}text-align:center;">
        <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
        <div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;">
          <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
            <tr>
              <td style="vertical-align:top;padding:0;">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="" width="100%">
                  <tr>
                    <td align="center" style="font-size:0px;padding:0;word-break:break-word;">
                      <div style="font-family:Arial, Helvetica, Sans-serif;font-size:13px;line-height:1;text-align:center;color:#cccccc;">
                        ${copyrightInner}
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="font-size:0px;padding:0;word-break:break-word;">
                      ${logoHtml}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </div>
        <!--[if mso | IE]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</div>
<!--[if mso | IE]></td></tr></table><![endif]-->`;
}

export function footerFieldsFromConfig(configJson) {
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

  const components = model.columns[0]?.components ?? [];
  const legalComponent = components[0];
  const copyrightComponent = components[1];
  if (!legalComponent || !copyrightComponent) return null;

  return {
    legalNoteNodes: schemaContentToFooterNodes(legalComponent.content ?? []),
    copyrightNodes: schemaContentToFooterNodes(copyrightComponent.content ?? []),
    legalNotePadding: formatEmailSpacingBox(
      model.blockSettings?.legalNotePadding ?? DEFAULT_FOOTER_SECTION_PADDING,
    ),
    copyrightPadding: formatEmailSpacingBox(
      model.blockSettings?.copyrightPadding ?? DEFAULT_FOOTER_SECTION_PADDING,
    ),
  };
}

export function populateFooterBlockBodyTemplate(
  blockBody,
  {
    legalNoteNodes = [],
    copyrightNodes = [],
    legalNotePadding = "",
    copyrightPadding = "",
  } = {},
) {
  const template = String(blockBody ?? "").trim();
  if (!template) return "";

  const legalSection = renderFooterLegalSectionHtml(
    legalNoteNodes,
    legalNotePadding,
  );
  const copyrightSection = renderFooterCopyrightSectionHtml(
    copyrightNodes,
    copyrightPadding,
  );

  return populateTemplatePlaceholders(template, {
    "{{FOOTER_LEGAL_SECTION}}": legalSection,
    "{{FOOTER_COPYRIGHT_SECTION}}": copyrightSection,
  });
}

export function populateFooterBlockFromEditorBlock(block, blockBody) {
  if (!block || block.type !== "Footer" || !Array.isArray(block.content)) {
    return "";
  }

  const contentRoot = block.content[0] ?? {};
  const blockSettings = block.content[1]?.blockSettings ?? {};

  return populateFooterBlockBodyTemplate(blockBody, {
    legalNoteNodes: contentRoot.legalNoteNodes ?? [],
    copyrightNodes: contentRoot.copyrightNodes ?? [],
    legalNotePadding: blockSettings.legalNotePadding,
    copyrightPadding: blockSettings.copyrightPadding,
  });
}

export function populateFooterBlockFromConfig(configJson, blockBody) {
  const fields = footerFieldsFromConfig(configJson);
  if (!fields) return "";
  return populateFooterBlockBodyTemplate(blockBody, fields);
}

/** Default legal + copyright + logo markup for the master template FOOTER slot. */
export function renderDefaultMasterFooterHtml() {
  return (
    renderFooterLegalSectionHtml(
      [{ paragraph: DEFAULT_FOOTER_LEGAL_NOTE_TEXT }],
      DEFAULT_FOOTER_SECTION_PADDING,
    ) +
    renderFooterCopyrightSectionHtml(
      [{ paragraph: DEFAULT_FOOTER_COPYRIGHT_TEXT }],
      DEFAULT_FOOTER_SECTION_PADDING,
    )
  );
}

/** Preview helper: both sections without full template wrapper duplication. */
export function renderFooterPreviewDocument(sections) {
  const legal = renderFooterLegalSectionHtml(
    sections.legalNoteNodes,
    sections.blockSettings?.legalNotePadding,
  );
  const copyright = renderFooterCopyrightSectionHtml(
    sections.copyrightNodes,
    sections.blockSettings?.copyrightPadding,
  );
  return `${legal}${copyright}`;
}
