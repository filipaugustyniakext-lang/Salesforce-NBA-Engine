import { DEFAULT_EMAIL_BLOCK_PADDING_BOX, formatEmailSpacingBox, normalizeEmailSpacingBox } from "../emailBlockSchema.js";
import {
  RICH_TEXT_BODY_TEXT_STYLE,
  renderSfmcRichTextRowsFromSegments,
} from "./richTextBlockHtml.js";
import {
  parseTextImageFromSchema,
  TEXT_IMAGE_POSITION_LEFT,
} from "../textImageBlock.js";

const DEFAULT_TEXT_IMAGE_PADDING = DEFAULT_EMAIL_BLOCK_PADDING_BOX;

const DEFAULT_IMAGE_COLUMN_WIDTH = "208";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function populateTemplatePlaceholders(templateBody, replacements = {}) {
  let html = String(templateBody ?? "");
  for (const [placeholder, value] of Object.entries(replacements)) {
    if (!placeholder) continue;
    html = html.split(placeholder).join(String(value ?? ""));
  }
  return html;
}

function formatCellPaddingStyle(
  paddingValue,
  defaults = DEFAULT_TEXT_IMAGE_PADDING,
) {
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

function parsePixelWidth(value, fallback = DEFAULT_IMAGE_COLUMN_WIDTH) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const match = raw.match(/^(\d+(?:\.\d+)?)/);
  if (!match) return fallback;
  return String(Math.max(0, Math.round(Number.parseFloat(match[1]))));
}

function wrapWithLink(innerHtml, href, target) {
  const link = String(href ?? "").trim();
  if (!link || !innerHtml) return innerHtml;
  const safeTarget = String(target ?? "_blank").trim() || "_blank";
  return `<a href="${escapeAttr(link)}" target="${escapeAttr(safeTarget)}" style="text-decoration:none;border:0;display:inline-block;">${innerHtml}</a>`;
}

function buildTextImageTextColumnHtml(segments = [], { imageOnRight = true } = {}) {
  const rows = renderSfmcRichTextRowsFromSegments(segments);
  const innerRows =
    rows.trim() ||
    `<tr>
  <td align="left" style="font-size:0px;padding:0;word-break:break-word;">
    <div style="font-family:Arial, Helvetica, Sans-serif;font-size:13px;line-height:1;text-align:left;color:#262626;">
      <p style="${RICH_TEXT_BODY_TEXT_STYLE}margin:0;">&nbsp;</p>
    </div>
  </td>
</tr>`;

  const cellPadding = imageOnRight ? "0px 10px 0px 0" : "0px 0px 0px 10";

  return `<div class="mj-column-per-60 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:middle;width:100%;">
        <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
          <tr>
            <td style="vertical-align:middle;padding:${cellPadding};">
              <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="" width="100%">
                ${innerRows}
              </table>
            </td>
          </tr>
        </table>
      </div>`;
}

function buildTextImageImageColumnHtml(imageContent = {}) {
  const desktopSrc = String(imageContent.imageURLDesktop ?? "").trim();
  const mobileSrc = String(imageContent.imageURLMobile ?? "").trim() || desktopSrc;
  const src = desktopSrc || mobileSrc;
  const alt = String(imageContent.altText ?? "").trim() || "Image";
  const width = parsePixelWidth(imageContent.imageWidth, DEFAULT_IMAGE_COLUMN_WIDTH);

  const imgTag = src
    ? `<img alt="${escapeAttr(alt)}" src="${escapeAttr(src)}" style="border:0;display:block;outline:none;text-decoration:none;height:auto;width:100%;font-size:13px;padding-top:0px" width="${escapeAttr(width)}" height="auto">`
    : `<span style="color:#747474;font-size:14px;">No image</span>`;

  const imageHtml = wrapWithLink(
    imgTag,
    imageContent.imageLink,
    imageContent.imageLinkTarget,
  );

  return `<div class="mj-column-per-40 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:middle;width:100%;">
        <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
          <tr>
            <td style="vertical-align:middle;padding:0;">
              <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="" width="100%">
                <tr>
                  <td align="center" style="font-size:0px;padding:0;word-break:break-word;">
                    <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;">
                      <tr>
                        <td style="width:${width}px;">
                          ${imageHtml}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>`;
}

function buildTextImageColumnsHtml({
  segments = [],
  imageContent = {},
  imagePosition = "right",
} = {}) {
  const imageOnRight = imagePosition !== TEXT_IMAGE_POSITION_LEFT;
  const textColumn = buildTextImageTextColumnHtml(segments, { imageOnRight });
  const imageColumn = buildTextImageImageColumnHtml(imageContent);

  if (imageOnRight) {
    return `${textColumn}
      <!--[if mso | IE]></td><td class="" style="vertical-align:middle;width:208px;" ><![endif]-->
      ${imageColumn}`;
  }

  return `${imageColumn}
      <!--[if mso | IE]></td><td class="" style="vertical-align:middle;width:312px;" ><![endif]-->
      ${textColumn}`;
}

export function textImageSectionsFromConfig(configJson) {
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
  if (!Array.isArray(model.columns) || model.columns.length < 2) return null;

  const sections = parseTextImageFromSchema(model);
  const padding = formatEmailSpacingBox(
    model.blockSettings?.padding ?? sections.blockSettings?.padding ?? "",
  );

  return {
    segments: sections.segments,
    imageContent: sections.imageContent,
    imagePosition: sections.blockSettings?.imagePosition ?? "right",
    padding,
  };
}

export function populateTextImageBlockBodyTemplate(
  blockBody,
  { segments = [], imageContent = {}, imagePosition = "right", padding = "" } = {},
) {
  const template = String(blockBody ?? "").trim();
  if (!template) return "";

  const columnsHtml = buildTextImageColumnsHtml({
    segments,
    imageContent,
    imagePosition,
  });

  return populateTemplatePlaceholders(template, {
    "{{CELL_PADDING_STYLE}}": formatCellPaddingStyle(padding),
    "{{COLUMNS_HTML}}": columnsHtml,
  });
}

export function renderTextImageBlockHtmlFromConfig(configJson, blockBody) {
  const sections = textImageSectionsFromConfig(configJson);
  if (!sections) return "";
  return populateTextImageBlockBodyTemplate(blockBody, sections);
}

export function populateTextImageBlockFromEditorBlock(block, blockBody) {
  if (!block || block.type !== "TextImage" || !Array.isArray(block.content)) {
    return "";
  }

  const segments = block.content[0]?.segments ?? [];
  const imageContent = block.content[1]?.content ?? {};
  const blockSettings = block.content[2]?.blockSettings ?? {};

  return populateTextImageBlockBodyTemplate(blockBody, {
    segments,
    imageContent,
    imagePosition: blockSettings.imagePosition ?? "right",
    padding: formatEmailSpacingBox(blockSettings.padding ?? ""),
  });
}

export function populateTextImageBlockFromConfig(configJson, blockBody) {
  return renderTextImageBlockHtmlFromConfig(configJson, blockBody);
}
