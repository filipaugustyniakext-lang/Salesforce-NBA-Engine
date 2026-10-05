import {
  DEFAULT_EMAIL_BLOCK_PADDING_BOX,
  formatEmailSpacingBox,
  normalizeEmailSpacingBox,
} from "../emailBlockSchema.js";

const DEFAULT_DESKTOP_MAX_WIDTH = "520";

const DESKTOP_IMG_STYLE =
  "display: block; width: 100%; max-width: {{MAX_WIDTH}}px; height: auto; border: 0;";

function buildResponsiveImageStyle(widthPx, heightValue, { important = false } = {}) {
  const width = parsePixelWidth(widthPx, "");
  const height = String(heightValue ?? "").trim().toLowerCase();
  const imp = important ? " !important" : "";
  if (width) {
    const style = `display:block;width:${width}px;max-width:100%${imp};border:0${imp};`;
    if (height && height !== "auto") {
      const heightPx = parsePixelWidth(height, "");
      return `${style}height:${heightPx}px${imp};`;
    }
    return `${style}height:auto${imp};`;
  }
  return "display:block;max-width:100%;width:auto;height:auto;border:0;";
}

/** Inline styles for the in-app block preview (canvas / preview panel). */
export function buildEditorImageInlineStyle(
  { width = "", height = "auto" } = {},
  options = {},
) {
  return buildResponsiveImageStyle(width, height, options);
}

/** Resolves width/height for desktop or mobile preview and email output. */
export function resolveImageBlockDimensions(
  content = {},
  viewport = "desktop",
) {
  const desktopWidth = String(content.imageWidth ?? "").trim();
  const desktopHeight = String(content.imageHeight ?? "auto").trim() || "auto";
  const mobileWidth = String(content.imageWidthMobile ?? "").trim();
  const mobileHeight = String(content.imageHeightMobile ?? "").trim();

  if (viewport === "mobile") {
    return {
      width: mobileWidth || desktopWidth,
      height: mobileHeight || desktopHeight,
    };
  }
  return {
    width: desktopWidth,
    height: desktopHeight,
  };
}

function escapeHtmlForPreview(value) {
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

function escapeAttr(value) {
  return escapeHtmlForPreview(value).replace(/'/g, "&#39;");
}

function normalizeAlign(value) {
  const align = String(value ?? "center").toLowerCase();
  if (align === "left" || align === "right" || align === "center") {
    return align;
  }
  return "center";
}

function formatCellPaddingStyle(paddingValue) {
  const box = normalizeEmailSpacingBox(paddingValue ?? "");
  const top = String(box.top ?? "").trim() || DEFAULT_EMAIL_BLOCK_PADDING_BOX.top;
  const right = String(box.right ?? "").trim() || DEFAULT_EMAIL_BLOCK_PADDING_BOX.right;
  const bottom = String(box.bottom ?? "").trim() || DEFAULT_EMAIL_BLOCK_PADDING_BOX.bottom;
  const left = String(box.left ?? "").trim() || DEFAULT_EMAIL_BLOCK_PADDING_BOX.left;

  if (top === bottom && left === right && top === left) {
    return `padding: ${top};`;
  }
  if (top === bottom && left === right) {
    return `padding: ${top} ${right};`;
  }
  return `padding: ${top} ${right} ${bottom} ${left};`;
}

function parsePixelWidth(value, fallback = DEFAULT_DESKTOP_MAX_WIDTH) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const match = raw.match(/^(\d+(?:\.\d+)?)/);
  if (!match) return fallback;
  return String(Math.max(0, Math.round(Number.parseFloat(match[1]))));
}

function buildDesktopImageTag({ src, alt, maxWidth }) {
  const url = String(src ?? "").trim();
  if (!url) {
    return `<span style="color:#747474;font-size:14px;line-height:20px;">No image</span>`;
  }

  const width = parsePixelWidth(maxWidth, DEFAULT_DESKTOP_MAX_WIDTH);
  const style = DESKTOP_IMG_STYLE.replace("{{MAX_WIDTH}}", width);

  return `<img src="${escapeAttr(url)}" width="${escapeAttr(width)}" alt="${escapeAttr(alt)}" style="${style}">`;
}

function buildMobileImageTag({ src, alt, maxWidth, height, fixedWidth = false }) {
  const url = String(src ?? "").trim();
  if (!url) {
    return `<span style="color:#747474;font-size:14px;line-height:20px;">No image</span>`;
  }

  const width = parsePixelWidth(maxWidth, "");
  if (fixedWidth && width) {
    const style = buildResponsiveImageStyle(maxWidth, height, { important: true });
    return `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" class="mobile-image-fixed" width="${escapeAttr(width)}" style="${style}">`;
  }

  const style = buildResponsiveImageStyle(maxWidth, height);
  const widthAttr = width ? ` width="${escapeAttr(width)}"` : "";
  return `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" class="mobile-image-show"${widthAttr} style="${style}">`;
}

function wrapWithLink(innerHtml, href, target) {
  const link = String(href ?? "").trim();
  if (!link || !innerHtml) return innerHtml;
  const safeTarget = String(target ?? "_blank").trim() || "_blank";
  return `<a href="${escapeAttr(link)}" target="${escapeAttr(safeTarget)}" style="text-decoration:none;border:0;display:inline-block;">${innerHtml}</a>`;
}

export function extractImageComponentFromConfig(configJson) {
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
      (item) => String(item?.type ?? "").toLowerCase() === "image",
    ) ?? null
  );
}

/**
 * Maps email-block-v1 image component + blockSettings onto the SFMC Image block HTML shell.
 *
 * Config fields:
 * - components[].type === "image"
 * - desktop.src, desktop.width, desktop.height
 * - mobile.src (falls back to desktop.src)
 * - alt, align, imageLink, imageLinkTarget
 * - blockSettings.padding
 */
export function imageBlockFieldsFromConfig(configJson) {
  const component = extractImageComponentFromConfig(configJson);
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

  const desktopSrc = String(component.desktop?.src ?? component.src ?? "").trim();
  const mobileSrc = String(component.mobile?.src ?? "").trim() || desktopSrc;

  return {
    imageURLDesktop: desktopSrc,
    imageURLMobile: mobileSrc,
    altText: String(component.alt ?? ""),
    imageWidth: String(component.desktop?.width ?? ""),
    imageHeight: String(component.desktop?.height ?? "") || "auto",
    imageWidthMobile: String(component.mobile?.width ?? ""),
    imageHeightMobile: String(component.mobile?.height ?? ""),
    imageAlign: String(component.align ?? "center"),
    imageLink: String(component.imageLink ?? ""),
    imageLinkTarget: String(component.imageLinkTarget ?? "_blank"),
    padding: formatEmailSpacingBox(model?.blockSettings?.padding ?? ""),
  };
}

/**
 * Populates SFMC_CB_Email_Image.html from editor fields or normalized field map.
 */
export function populateImageBlockBodyTemplate(
  blockBody,
  {
    imageURLDesktop = "",
    imageURLMobile = "",
    altText = "",
    imageWidth = "",
    imageHeight = "auto",
    imageWidthMobile = "",
    imageHeightMobile = "",
    imageAlign = "center",
    imageLink = "",
    imageLinkTarget = "_blank",
    padding = "",
  } = {},
) {
  const template = String(blockBody ?? "").trim();
  if (!template) return "";

  const desktopSrc = String(imageURLDesktop ?? "").trim();
  const mobileSrc = String(imageURLMobile ?? "").trim() || desktopSrc;
  const alt = String(altText ?? "").trim() || "Image";
  const desktopMaxWidth = parsePixelWidth(imageWidth, DEFAULT_DESKTOP_MAX_WIDTH);
  const mobileDims = resolveImageBlockDimensions(
    {
      imageWidth,
      imageHeight,
      imageWidthMobile,
      imageHeightMobile,
    },
    "mobile",
  );
  const mobileWidthPx = parsePixelWidth(mobileDims.width, "");
  const useFixedMobileWidth = Boolean(mobileWidthPx);

  const desktopImg = buildDesktopImageTag({
    src: desktopSrc,
    alt,
    maxWidth: desktopMaxWidth,
  });
  const mobileImg = buildMobileImageTag({
    src: mobileSrc,
    alt,
    maxWidth: mobileWidthPx || desktopMaxWidth,
    height: mobileDims.height,
    fixedWidth: useFixedMobileWidth,
  });

  return populateTemplatePlaceholders(template, {
    "{{CELL_ALIGN}}": normalizeAlign(imageAlign),
    "{{CELL_PADDING_STYLE}}": formatCellPaddingStyle(padding),
    "{{DESKTOP_IMAGE_HTML}}": wrapWithLink(desktopImg, imageLink, imageLinkTarget),
    "{{MOBILE_IMAGE_HTML}}": wrapWithLink(mobileImg, imageLink, imageLinkTarget),
  });
}

/** Renders Image block HTML from email-block-v1 config JSON + block shell. */
export function renderImageBlockHtmlFromConfig(configJson, blockBody) {
  const fields = imageBlockFieldsFromConfig(configJson);
  if (!fields) return "";
  return populateImageBlockBodyTemplate(blockBody, fields);
}

export function populateImageBlockFromEditorBlock(block, blockBody) {
  if (!block || block.type !== "Image" || !Array.isArray(block.content)) {
    return "";
  }

  const content = block.content[0]?.content ?? {};
  const blockSettings = block.content[1]?.blockSettings ?? {};

  return populateImageBlockBodyTemplate(blockBody, {
    imageURLDesktop: content.imageURLDesktop,
    imageURLMobile: content.imageURLMobile,
    altText: content.altText,
    imageWidth: content.imageWidth,
    imageHeight: content.imageHeight,
    imageWidthMobile: content.imageWidthMobile,
    imageHeightMobile: content.imageHeightMobile,
    imageAlign: content.imageAlign,
    imageLink: content.imageLink,
    imageLinkTarget: content.imageLinkTarget,
    padding: formatEmailSpacingBox(blockSettings.padding ?? ""),
  });
}

export function populateImageBlockFromConfig(configJson, blockBody) {
  return renderImageBlockHtmlFromConfig(configJson, blockBody);
}
