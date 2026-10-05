import {
  formatSpacerHeight,
  getSpacerBlockSections,
  parseSpacerHeightNumber,
  resolveSpacerHeight,
} from "../spacerBlock.js";

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

export function renderSpacerCellHtml(heightValue) {
  const height = formatSpacerHeight(heightValue, "24px");
  const heightNum = parseSpacerHeightNumber(height, 24);
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr>
    <td height="${heightNum}" style="height:${escapeHtmlForPreview(height)};line-height:${escapeHtmlForPreview(height)};font-size:0;mso-line-height-rule:exactly;">&nbsp;</td>
  </tr>
</table>`;
}

export function renderSpacerPreviewHtml(sections = {}, viewport = "desktop") {
  const desktopHeight = resolveSpacerHeight(sections, "desktop");
  const mobileHeight = resolveSpacerHeight(sections, "mobile");
  const activeHeight = viewport === "mobile" ? mobileHeight : desktopHeight;
  return renderSpacerCellHtml(activeHeight);
}

export function spacerFieldsFromConfig(configJson) {
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

  const firstColumn = model.columns?.find(
    (column) => column && typeof column === "object",
  );
  const component =
    firstColumn?.components?.find(
      (item) => String(item?.type ?? "").toLowerCase() === "spacer",
    ) ??
    firstColumn?.components?.find(
      (item) => String(item?.type ?? "").toLowerCase() === "divider",
    ) ??
    firstColumn?.components?.[0] ??
    {};

  const legacyThickness = component.thickness ?? component.height ?? "";
  return {
    desktopHeight: formatSpacerHeight(
      component.desktop?.height ?? legacyThickness,
      "24px",
    ),
    mobileHeight: String(component.mobile?.height ?? "").trim()
      ? formatSpacerHeight(component.mobile.height, component.desktop?.height ?? legacyThickness)
      : "",
  };
}

export function populateSpacerBlockBodyTemplate(blockBody, sections = {}) {
  const body = String(blockBody ?? "").trim();
  if (!body) return "";

  const desktopHeight = resolveSpacerHeight(sections, "desktop");
  const mobileHeight = resolveSpacerHeight(sections, "mobile");

  return populateTemplatePlaceholders(body, {
    "{{DESKTOP_SPACER_HTML}}": renderSpacerCellHtml(desktopHeight),
    "{{MOBILE_SPACER_HTML}}": renderSpacerCellHtml(mobileHeight),
  });
}

export function populateSpacerBlockFromEditorBlock(block, blockBody) {
  if (!block || block.type !== "Spacer" || !Array.isArray(block.content)) {
    return "";
  }
  return populateSpacerBlockBodyTemplate(blockBody, getSpacerBlockSections(block));
}

export function populateSpacerBlockFromConfig(configJson, blockBody) {
  const fields = spacerFieldsFromConfig(configJson);
  if (!fields) return "";
  return populateSpacerBlockBodyTemplate(blockBody, fields);
}
