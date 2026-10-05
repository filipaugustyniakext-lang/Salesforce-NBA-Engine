import { formatEmailSpacingBox, normalizeEmailSpacingBox } from "../emailBlockSchema.js";
import {
  BANNER_BACKGROUND_BLUE,
  BANNER_BACKGROUND_RED,
  getBannerSfmcBackgroundAssets,
  parseBannerFromSchema,
} from "../bannerBlock.js";
import { TEXT_IMAGE_POSITION_LEFT } from "../textImageBlock.js";
import {
  RICH_TEXT_BODY_TEXT_STYLE,
  RICH_TEXT_RENDER_THEME_BANNER,
  renderSfmcRichTextRowsFromSegments,
} from "./richTextBlockHtml.js";

const DEFAULT_BANNER_IMAGE_WIDTH = "224";
const MSO_TEXT_COLUMN_WIDTH = "336";
const MSO_IMAGE_COLUMN_WIDTH = "224";

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

function parsePixelWidth(value, fallback = DEFAULT_BANNER_IMAGE_WIDTH) {
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

function resolveInnerCellPadding(paddingValue, assets) {
  const box = normalizeEmailSpacingBox(paddingValue ?? "");
  const top = String(box.top ?? "").trim();
  const right = String(box.right ?? "").trim();
  const bottom = String(box.bottom ?? "").trim();
  const left = String(box.left ?? "").trim();
  const hasCustom = top || right || bottom || left;

  if (!hasCustom) {
    return `padding:${assets.innerCellPadding};`;
  }

  if (top && right && bottom && left) {
    if (top === bottom && left === right && top === left) {
      return `padding:${top};`;
    }
    if (top === bottom && left === right) {
      return `padding:${top} ${right};`;
    }
    return `padding:${top} ${right} ${bottom} ${left};`;
  }

  return `padding:${assets.innerCellPadding};`;
}

function buildBannerTextColumnHtml(segments = [], { imageOnRight = true } = {}) {
  const rows = renderSfmcRichTextRowsFromSegments(segments, {
    theme: RICH_TEXT_RENDER_THEME_BANNER,
  });
  const innerRows =
    rows.trim() ||
    `<tr>
  <td align="left" style="font-size:0px;padding:0;word-break:break-word;">
    <div style="font-family:Arial, Helvetica, Sans-serif;font-size:13px;font-weight:200;line-height:1;text-align:left;color:#ffffff;mso-color-alt:auto;">
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

function buildBannerImageColumnHtml(imageContent = {}) {
  const desktopSrc = String(imageContent.imageURLDesktop ?? "").trim();
  const mobileSrc = String(imageContent.imageURLMobile ?? "").trim() || desktopSrc;
  const src = desktopSrc || mobileSrc;
  const alt = String(imageContent.altText ?? "").trim() || "Image";
  const width = parsePixelWidth(imageContent.imageWidth, DEFAULT_BANNER_IMAGE_WIDTH);

  const imgTag = src
    ? `<img alt="${escapeAttr(alt)}" src="${escapeAttr(src)}" style="border:0;display:block;outline:none;text-decoration:none;height:auto;width:100%;font-size:13px;padding-top:10px" width="${escapeAttr(width)}" height="auto">`
    : `<span style="color:#ffffff;font-size:14px;">No image</span>`;

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

function buildBannerColumnsHtml({
  segments = [],
  imageContent = {},
  imagePosition = "right",
} = {}) {
  const imageOnRight = imagePosition !== TEXT_IMAGE_POSITION_LEFT;
  const textColumn = buildBannerTextColumnHtml(segments, { imageOnRight });
  const imageColumn = buildBannerImageColumnHtml(imageContent);

  if (imageOnRight) {
    return `${textColumn}
      <!--[if mso | IE]></td><td class="" style="vertical-align:middle;width:${MSO_IMAGE_COLUMN_WIDTH}px;" ><![endif]-->
      ${imageColumn}`;
  }

  return `${imageColumn}
      <!--[if mso | IE]></td><td class="" style="vertical-align:middle;width:${MSO_TEXT_COLUMN_WIDTH}px;" ><![endif]-->
      ${textColumn}`;
}

function buildMsoFirstColumnOpen(imagePosition = "right") {
  const imageOnRight = imagePosition !== TEXT_IMAGE_POSITION_LEFT;
  const width = imageOnRight ? MSO_TEXT_COLUMN_WIDTH : MSO_IMAGE_COLUMN_WIDTH;
  return `<td class="" style="vertical-align:middle;width:${width}px;" >`;
}

function resolveBannerBackgroundStyle(backgroundStyle) {
  return backgroundStyle === BANNER_BACKGROUND_BLUE
    ? BANNER_BACKGROUND_BLUE
    : BANNER_BACKGROUND_RED;
}

export function bannerSectionsFromConfig(configJson) {
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

  const sections = parseBannerFromSchema(model);
  const schemaSettings = model.blockSettings ?? {};

  return {
    segments: sections.segments,
    imageContent: sections.imageContent,
    imagePosition: sections.blockSettings?.imagePosition ?? "right",
    backgroundStyle: resolveBannerBackgroundStyle(
      schemaSettings.backgroundStyle ?? sections.blockSettings?.backgroundStyle,
    ),
    vmlHeight:
      Number.parseInt(
        String(schemaSettings.vmlHeight ?? sections.blockSettings?.vmlHeight ?? 350),
        10,
      ) || 350,
    padding: formatEmailSpacingBox(
      schemaSettings.padding ?? sections.blockSettings?.padding ?? "",
    ),
  };
}

export function populateBannerBlockBodyTemplate(
  blockBody,
  {
    segments = [],
    imageContent = {},
    imagePosition = "right",
    backgroundStyle = BANNER_BACKGROUND_RED,
    vmlHeight = 350,
    padding = "",
  } = {},
) {
  const template = String(blockBody ?? "").trim();
  if (!template) return "";

  const bgKey = resolveBannerBackgroundStyle(backgroundStyle);
  const assets = getBannerSfmcBackgroundAssets(bgKey);
  const columnsHtml = buildBannerColumnsHtml({
    segments,
    imageContent,
    imagePosition,
  });

  return populateTemplatePlaceholders(template, {
    "{{VML_HEIGHT}}": String(Math.max(0, Math.round(Number(vmlHeight) || 0))),
    "{{VML_FILL_SRC}}": escapeAttr(assets.vmlFillImageUrl),
    "{{VML_TEXTBOX_INSET}}": assets.vmlTextboxInset,
    "{{BG_IMAGE_URL}}": escapeAttr(assets.backgroundImageUrl),
    "{{MOBILE_BG_CLASS}}": assets.mobileClass,
    "{{INNER_CELL_PADDING}}": resolveInnerCellPadding(padding, assets),
    "{{MSO_FIRST_COLUMN_OPEN}}": buildMsoFirstColumnOpen(imagePosition),
    "{{COLUMNS_HTML}}": columnsHtml,
  });
}

export function renderBannerBlockHtmlFromConfig(configJson, blockBody) {
  const sections = bannerSectionsFromConfig(configJson);
  if (!sections) return "";
  return populateBannerBlockBodyTemplate(blockBody, sections);
}

export function populateBannerBlockFromEditorBlock(block, blockBody) {
  if (!block || block.type !== "Banner" || !Array.isArray(block.content)) {
    return "";
  }

  const segments = block.content[0]?.segments ?? [];
  const imageContent = block.content[1]?.content ?? {};
  const blockSettings = block.content[2]?.blockSettings ?? {};

  return populateBannerBlockBodyTemplate(blockBody, {
    segments,
    imageContent,
    imagePosition: blockSettings.imagePosition ?? "right",
    backgroundStyle: blockSettings.backgroundStyle ?? BANNER_BACKGROUND_RED,
    vmlHeight: blockSettings.vmlHeight ?? 350,
    padding: formatEmailSpacingBox(blockSettings.padding ?? ""),
  });
}

export function populateBannerBlockFromConfig(configJson, blockBody) {
  return renderBannerBlockHtmlFromConfig(configJson, blockBody);
}
