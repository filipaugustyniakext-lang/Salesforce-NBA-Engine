import { formatEmailSpacingBox, DEFAULT_EMAIL_BLOCK_PADDING_BOX, normalizeEmailSpacingBox } from "../emailBlockSchema.js";
import {
  isRichTextParagraphBreakOnly,
  normalizeRichTextParagraphContentForSchema,
  RICH_TEXT_BLOCK_TOP_PADDING_INLINE_STYLE,
  sanitizeRichTextHtmlFragment,
} from "../richTextContent.js";
import {
  DEFAULT_BULLET_ICON,
  DEFAULT_BULLET_ICON_COLOR,
  RICH_TEXT_SEGMENT_TYPE_BULLET_LIST,
  normalizeBulletListSegment,
  normalizeRichTextSegment,
  normalizeRichTextSegments,
  schemaContentToSegments,
} from "../richTextSegments.js";

const DEFAULT_RICH_TEXT_PADDING = DEFAULT_EMAIL_BLOCK_PADDING_BOX;

export const RICH_TEXT_H1_INLINE_STYLE =
  "font-family:Arial, Helvetica, Sans-serif;font-size:35px;line-height:42px;text-align:left;color:#000000;font-weight:700";

export const RICH_TEXT_H2_INLINE_STYLE =
  "font-family:Arial, Helvetica, Sans-serif;font-size:20px;line-height:26px;text-align:left;color:#000000;font-weight:700";

export const RICH_TEXT_H3_INLINE_STYLE =
  "font-family:Arial, Helvetica, Sans-serif;font-size:18px;line-height:26px;text-align:left;color:#000000;font-weight:700";

const HEADING_INLINE_STYLE =
  "font-family:Arial, Helvetica, Sans-serif;font-size:20px;line-height:26px;text-align:left;color:#000000;font-weight:700";

function getHeadingInlineStyle(tag) {
  if (tag === "h1") return RICH_TEXT_H1_INLINE_STYLE;
  if (tag === "h2") return RICH_TEXT_H2_INLINE_STYLE;
  if (tag === "h3") return RICH_TEXT_H3_INLINE_STYLE;
  return HEADING_INLINE_STYLE;
}

function getBannerHeadingStyle(tag) {
  if (tag === "h1") {
    return ' style="font-size:35px;line-height:42px;font-weight:700;"';
  }
  if (tag === "h2") {
    return ' style="font-size:20px;line-height:26px;font-weight:700;"';
  }
  if (tag === "h3") {
    return ' style="font-size:18px;line-height:26px;font-weight:700;"';
  }
  return "";
}
export const RICH_TEXT_BODY_TEXT_STYLE =
  "font-family:Arial, Helvetica, Sans-serif;font-weight:400;font-size:16px;line-height:1.4;";

const PARAGRAPH_STYLE = `${RICH_TEXT_BODY_TEXT_STYLE}margin:0;${RICH_TEXT_BLOCK_TOP_PADDING_INLINE_STYLE}`;
const LIST_STYLE = `${RICH_TEXT_BODY_TEXT_STYLE}margin:0;${RICH_TEXT_BLOCK_TOP_PADDING_INLINE_STYLE}`;

const WRAPPER_DARK = "#000000";
const WRAPPER_BODY = "#262626";

export const RICH_TEXT_RENDER_THEME_BANNER = "banner";

function isBannerRenderTheme(theme) {
  return theme === RICH_TEXT_RENDER_THEME_BANNER;
}

function gmailBlendWrap(html) {
  return `<div class="gmail-blend-screen"><div class="gmail-blend-difference">${html}</div></div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function populateTemplatePlaceholders(templateBody, replacements = {}) {
  let html = String(templateBody ?? "");
  for (const [placeholder, value] of Object.entries(replacements)) {
    if (!placeholder) continue;
    html = html.split(placeholder).join(String(value ?? ""));
  }
  return html;
}

function formatCellPaddingStyle(paddingValue, defaults = DEFAULT_RICH_TEXT_PADDING) {
  const box = normalizeEmailSpacingBox(paddingValue ?? "");
  const top = String(box.top ?? "").trim() || defaults.top;
  const right = String(box.right ?? "").trim() || defaults.right;
  const bottom = String(box.bottom ?? "").trim() || defaults.bottom;
  const left = String(box.left ?? "").trim() || defaults.left;

  if (top === bottom && left === right && top === left) {
    return `padding: ${top};`;
  }
  if (top === bottom && left === right) {
    return `padding: ${top} ${right};`;
  }
  return `padding: ${top} ${right} ${bottom} ${left};`;
}

function formatBulletIconForHtml(icon) {
  const raw = String(icon ?? "").trim() || DEFAULT_BULLET_ICON;
  if (/^&#(\d+|x[0-9a-f]+);$/i.test(raw) || /^&[a-z]+;$/i.test(raw)) {
    return raw;
  }
  return escapeHtml(raw);
}

function formatInlineBody(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    return sanitizeRichTextHtmlFragment(raw);
  }
  return escapeHtml(raw);
}

function wrapContentRow(innerHtml, textColor = WRAPPER_BODY, theme) {
  if (isBannerRenderTheme(theme)) {
    return `<tr>
  <td align="left" style="font-size:0px;padding:0;word-break:break-word;">
    <div style="font-family:Arial, Helvetica, Sans-serif;font-size:13px;line-height:1;text-align:left;color:#ffffff;mso-color-alt:auto;">
      ${innerHtml}
    </div>
  </td>
</tr>`;
  }
  return `<tr>
  <td align="left" style="font-size:0px;padding:0;word-break:break-word;">
    <div style="font-family:Arial, Helvetica, Sans-serif;font-size:13px;line-height:1;text-align:left;color:${textColor};">
      ${innerHtml}
    </div>
  </td>
</tr>`;
}

function wrapBannerHeadingRow(innerHtml) {
  return `<tr>
  <td align="left" style="font-size:0px;padding:0;word-break:break-word;">
    <div style="font-family:Arial, Helvetica, Sans-serif;font-size:13px;line-height:13px;text-align:left;color:#ffffff;mso-color-alt:auto; line-height:150%;">
      ${innerHtml}
    </div>
  </td>
</tr>`;
}

function normalizeHeadingBody(tag, content) {
  const html = sanitizeRichTextHtmlFragment(content);
  if (!html) return "";
  const tagPattern = new RegExp(`^<${tag}[^>]*>([\\s\\S]*)</${tag}>$`, "i");
  const match = html.match(tagPattern);
  if (match) return match[1];
  return html;
}

function renderHeadingRow(tag, content, theme) {
  const body = normalizeHeadingBody(tag, content);
  if (!body) return "";
  if (isBannerRenderTheme(theme)) {
    return wrapBannerHeadingRow(
      `<${tag}${getBannerHeadingStyle(tag)}>${gmailBlendWrap(body)}</${tag}>`,
    );
  }
  return wrapContentRow(
    `<${tag} style="${getHeadingInlineStyle(tag)}">${body}</${tag}>`,
    WRAPPER_DARK,
    theme,
  );
}

function normalizeParagraphInner(content) {
  const normalized = normalizeRichTextParagraphContentForSchema(content);
  if (isRichTextParagraphBreakOnly(normalized)) {
    return "<br/>";
  }
  const html = sanitizeRichTextHtmlFragment(normalized);
  if (!html || isRichTextParagraphBreakOnly(html)) return "<br/>";
  if (/^<p[\s>]/i.test(html)) {
    return html.replace(
      /<p(\s[^>]*)?>/i,
      `<p style="${PARAGRAPH_STYLE}">`,
    );
  }
  return `<p style="${PARAGRAPH_STYLE}">${html}</p>`;
}

function renderParagraphRow(content, theme) {
  const inner = normalizeParagraphInner(content);
  if (!inner) return "";
  const wrapped = isBannerRenderTheme(theme) ? gmailBlendWrap(inner) : inner;
  return wrapContentRow(wrapped, WRAPPER_BODY, theme);
}

function renderListRow(tag, items = [], theme) {
  const lis = (Array.isArray(items) ? items : [])
    .map((item) => formatInlineBody(item))
    .filter(Boolean)
    .map((item) => {
      const cell = isBannerRenderTheme(theme) ? gmailBlendWrap(item) : item;
      return `<li>${cell}</li>`;
    })
    .join("");
  if (!lis) return "";
  return wrapContentRow(
    `<${tag} style="${LIST_STYLE}">${lis}</${tag}>`,
    WRAPPER_BODY,
    theme,
  );
}

function renderHrRow(theme) {
  return wrapContentRow("<hr/>", WRAPPER_BODY, theme);
}

function renderSfmcBulletItemTable(item, icon, iconColor, theme) {
  const body = formatInlineBody(item.text);
  if (!body) return "";
  if (isBannerRenderTheme(theme)) {
    return `<table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:6px;color:#ffffff;mso-color-alt:auto;">
  <tr>
    <td style="font-size:20px;font-weight:700;line-height:1;vertical-align:top;padding-right:16px;padding-top:0;">${gmailBlendWrap(icon)}</td>
    <!--[if mso]>
    <td style="font-size:16.5px;font-weight:300;line-height:1.7;vertical-align:middle;padding-top:16px;padding-bottom:6px;font-family:Arial, Helvetica, Sans-serif;margin-top:5px">
    <![endif]-->
    <!--[if !mso]><!-->
    <td style="font-size:16px;font-weight:400;line-height:1.4;vertical-align:top;font-family:Arial, Helvetica, Sans-serif">
    <!--<![endif]-->
      ${gmailBlendWrap(body)}
    </td>
  </tr>
</table>`;
  }
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:6px;" role="presentation">
  <tr>
    <td style="font-size:20px;font-weight:700;line-height:1;vertical-align:top;padding-right:16px;padding-top:0;color: ${iconColor}">${icon}</td>
    <!--[if mso]>
<td style="font-size:16.5px;font-weight:300;line-height:1.6;vertical-align:middle;padding-top:16px;padding-bottom:6px;font-family:Arial, Helvetica, Sans-serif;margin-top:5px">
<![endif]-->
    <!--[if !mso]><!-->
    <td style="font-size:16px;font-weight:400;line-height:1.4;vertical-align:top;font-family:Arial, Helvetica, Sans-serif">
    <!--<![endif]-->
      ${body}
    </td>
  </tr>
</table>`;
}

function renderSfmcBulletListRow(segment, theme) {
  const normalized = normalizeBulletListSegment(segment);
  const icon = formatBulletIconForHtml(normalized.icon);
  const iconColor = escapeHtml(normalized.iconColor || DEFAULT_BULLET_ICON_COLOR);
  const itemTables = normalized.items
    .map((item) => renderSfmcBulletItemTable(item, icon, iconColor, theme))
    .filter(Boolean)
    .join("");

  if (!itemTables && !String(normalized.header ?? "").trim()) return "";

  const headerHtml = String(normalized.header ?? "").trim();
  const headerRow = headerHtml
    ? isBannerRenderTheme(theme)
      ? wrapBannerHeadingRow(
          `<h2>${gmailBlendWrap(escapeHtml(headerHtml))}</h2>`,
        )
      : `<tr>
      <td align="left" style="font-size:0px;padding:0;word-break:break-word;">
        <div style="font-family:Arial, Helvetica, Sans-serif;font-size:13px;line-height:1;text-align:left;color:#000000;mso-color-alt:auto;">
          <h2 style="${RICH_TEXT_H2_INLINE_STYLE}">${escapeHtml(headerHtml)}</h2>
        </div>
      </td>
    </tr>`
    : "";

  const bulletContainerStyle = isBannerRenderTheme(theme)
    ? `font-family:Arial, Helvetica, Sans-serif;font-size:13px;font-weight:200;line-height:1;text-align:left;color:#ffffff;mso-color-alt:auto;${RICH_TEXT_BLOCK_TOP_PADDING_INLINE_STYLE}`
    : `font-family:Arial, Helvetica, Sans-serif;font-size:13px;font-weight:200;line-height:1;text-align:left;${RICH_TEXT_BLOCK_TOP_PADDING_INLINE_STYLE}`;

  if (isBannerRenderTheme(theme) && headerRow && !itemTables) {
    return headerRow;
  }

  if (isBannerRenderTheme(theme) && headerRow && itemTables) {
    return `${headerRow}
<tr>
  <td align="left" style="font-size:0px;padding:0;word-break:break-word;">
    <div style="${bulletContainerStyle}">
      ${itemTables}
    </div>
  </td>
</tr>`;
  }

  return `<tr>
  <td style="vertical-align:middle;padding:0;">
    <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="" width="100%">
      ${headerRow}
      <tr>
        <td align="left" style="font-size:0px;padding:0;word-break:break-word;">
          <div style="${bulletContainerStyle}">
            ${itemTables}
          </div>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function renderSfmcRowFromNode(node, theme) {
  if (!node || typeof node !== "object") return "";
  const type = Object.keys(node)[0];
  const value = node[type];

  if (/^h[1-6]$/i.test(type)) {
    return renderHeadingRow(type.toLowerCase(), value, theme);
  }
  if (type === "paragraph") {
    return renderParagraphRow(value, theme);
  }
  if (type === "list_ordered") {
    return renderListRow("ol", value, theme);
  }
  if (type === "list_unordered") {
    return renderListRow("ul", value, theme);
  }
  if (type === "hr") {
    return renderHrRow(theme);
  }
  if (type === "bulletList") {
    return renderSfmcBulletListRow(
      normalizeBulletListSegment({
        items: (Array.isArray(value) ? value : []).map((text) => ({ text })),
      }),
      theme,
    );
  }
  return "";
}

export function renderSfmcRichTextRowsFromSegments(segments = [], options = {}) {
  const theme = options.theme === RICH_TEXT_RENDER_THEME_BANNER
    ? RICH_TEXT_RENDER_THEME_BANNER
    : undefined;
  return normalizeRichTextSegments(segments, { omitEmpty: true })
    .map((segment) => {
      const normalized = normalizeRichTextSegment(segment);
      if (normalized.type === RICH_TEXT_SEGMENT_TYPE_BULLET_LIST) {
        return renderSfmcBulletListRow(normalized, theme);
      }
      return normalized.nodes
        .map((node) => renderSfmcRowFromNode(node, theme))
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

export function renderSfmcRichTextRowsFromSchemaContent(content = [], options = {}) {
  const theme = options.theme === RICH_TEXT_RENDER_THEME_BANNER
    ? RICH_TEXT_RENDER_THEME_BANNER
    : undefined;
  return schemaContentToSegments(content)
    .map((segment) => {
      if (segment.type === RICH_TEXT_SEGMENT_TYPE_BULLET_LIST) {
        return renderSfmcBulletListRow(segment, theme);
      }
      return segment.nodes
        .map((node) => renderSfmcRowFromNode(node, theme))
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

export function extractRichTextComponentFromConfig(configJson) {
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

  if (!model || typeof model !== "object") return null;

  return (
    model.columns?.flatMap((column) => column?.components ?? [])?.find(
      (item) => String(item?.type ?? "").toLowerCase() === "richtext",
    ) ?? null
  );
}

export function richTextFieldsFromConfig(configJson) {
  const component = extractRichTextComponentFromConfig(configJson);
  if (!component) return null;

  const model =
    typeof configJson === "string"
      ? (() => {
          try {
            return JSON.parse(configJson);
          } catch {
            return {};
          }
        })()
      : configJson;

  const rows = renderSfmcRichTextRowsFromSchemaContent(component.content ?? []);
  const padding = formatEmailSpacingBox(model?.blockSettings?.padding ?? "");

  return { rows, padding };
}

export function populateRichTextBlockBodyTemplate(
  blockBody,
  { rows = "", padding = "" } = {},
) {
  const template = String(blockBody ?? "").trim();
  if (!template) return "";

  const rowHtml = String(rows ?? "").trim();
  const paddingStyle = formatCellPaddingStyle(padding);

  return populateTemplatePlaceholders(template, {
    "{{RICH_TEXT_ROWS}}":
      rowHtml ||
      wrapContentRow(`<p style="${PARAGRAPH_STYLE}"><br></p>`, WRAPPER_BODY),
    "{{CELL_PADDING_STYLE}}": paddingStyle,
  });
}

export function renderRichTextBlockHtmlFromConfig(configJson, blockBody) {
  const fields = richTextFieldsFromConfig(configJson);
  if (!fields) return "";
  return populateRichTextBlockBodyTemplate(blockBody, fields);
}

export function populateRichTextBlockFromEditorBlock(block, blockBody) {
  if (!block || block.type !== "RichText" || !Array.isArray(block.content)) {
    return "";
  }

  const segments = block.content[0]?.segments ?? [];
  const blockSettings = block.content[1]?.blockSettings ?? {};
  const rows = renderSfmcRichTextRowsFromSegments(segments);

  return populateRichTextBlockBodyTemplate(blockBody, {
    rows,
    padding: formatEmailSpacingBox(blockSettings.padding ?? ""),
  });
}

export function populateRichTextBlockFromConfig(configJson, blockBody) {
  return renderRichTextBlockHtmlFromConfig(configJson, blockBody);
}
