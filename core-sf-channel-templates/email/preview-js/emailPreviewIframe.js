/**
 * Prepares full email HTML documents for sandboxed iframe preview (srcdoc).
 * Scripts are stripped from markup. CSP is injected inside <head> only.
 */

const EMAIL_PREVIEW_CSP_META =
  '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'; object-src \'none\';">';

/** Empty preview placeholders inside the iframe. */
const EMAIL_PREVIEW_EMPTY_STATE_STYLE = `<style data-email-preview-empty-state>
.email-preview-empty {
  box-sizing: border-box;
  max-width: 600px;
  margin: 0 auto;
  padding: 1rem 1.25rem 1.25rem;
  text-align: center;
  font-family: Arial, Helvetica, sans-serif;
  background: #fff;
  border: 1px dashed #c9c7c5;
  border-radius: 0.25rem;
}
.email-preview-empty__primary {
  margin: 0 0 0.35rem;
  color: #747474;
  font-size: 14px;
  line-height: 1.5;
}
.email-preview-empty__hint {
  margin: 0;
  color: #706e6b;
  font-size: 12px;
  line-height: 1.5;
}
</style>`;

/** Allow long tokens to wrap in preview while keeping overflow-wrap normal. */
const EMAIL_PREVIEW_WORD_WRAP_STYLE = `<style data-email-preview-word-wrap>
body,h1,h2,h3,h4,h5,h6,p,li,span,strong,em,a,div,td,th {
  word-break: break-word !important;
  overflow-wrap: normal !important;
}
</style>`;

/** Keeps iframe height tied to visible content, not template min-heights or hidden responsive layers. */
const EMAIL_PREVIEW_LAYOUT_STYLE = `<style data-email-preview-layout>
html, body {
  height: auto !important;
  min-height: 0 !important;
  overflow-x: hidden !important;
  overflow-y: visible !important;
  margin: 0;
  padding: 0;
}
img {
  max-width: 100% !important;
}
</style>`;

const EMAIL_PREVIEW_LIGHT_MODE_STYLE = `<meta data-email-preview-color-mode name="color-scheme" content="light only">
<style data-email-preview-color-mode>
:root,
html {
  color-scheme: light only !important;
}
html,
body {
  background-color: #ffffff !important;
}
.email-preview-empty {
  background-color: #fff !important;
  border-color: #c9c7c5;
}
.email-preview-empty__primary {
  color: #747474 !important;
}
.email-preview-empty__hint {
  color: #706e6b !important;
}
</style>`;

const EMAIL_PREVIEW_DARK_MODE_STYLE = `<meta data-email-preview-color-mode name="color-scheme" content="dark only">
<style data-email-preview-color-mode>
:root,
html {
  color-scheme: dark only !important;
}
html,
body {
  background-color: #262626 !important;
}
.email-preview-empty {
  background-color: #262626 !important;
  border-color: #595959;
}
.email-preview-empty__primary {
  color: #ffffff !important;
}
.email-preview-empty__hint {
  color: #b0adab !important;
}
</style>`;

const PREFERS_DARK_MEDIA_PATTERN =
  /@media\s*(?:only\s+)?\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/gi;

const EMAIL_PREVIEW_PREFOOTER_COLOR_LOCK_STYLE = `<style data-email-preview-prefooter-color>
.footer-product-text,
.footer-product-text p,
.footer-product-text li,
.footer-product-text ol,
.footer-product-text ul,
.footer-product-text a,
.footer-product-text strong,
.footer-product-text em,
.footer-product-text span,
.footer-legal-text,
.footer-legal-text p,
.footer-legal-text li,
.footer-legal-text ol,
.footer-legal-text ul,
.footer-legal-text a,
.footer-legal-text strong,
.footer-legal-text em,
.footer-legal-text span {
  color: #333333 !important;
}
</style>`;

const EMAIL_PREVIEW_INTERACTIVE_BLOCKS_STYLE = `<style data-email-preview-interactive>
.email-preview-block {
  position: relative;
  display: flow-root;
  cursor: pointer;
  border-radius: 2px;
}
.email-preview-block::after {
  content: "";
  position: absolute;
  inset: 0;
  border: 2px solid transparent;
  border-radius: inherit;
  box-sizing: border-box;
  pointer-events: none;
  z-index: 2147483647;
  transition: border-color 0.15s ease;
}
.email-preview-block:hover::after {
  border-color: #0176d3;
  border-style: dashed;
  border-width: 1px;
}
.email-preview-block[data-preview-selected]::after,
.email-preview-block[data-preview-selected]:hover::after {
  border: 2px solid #0176d3;
}
.email-preview-block[data-preview-selected] {
  scroll-margin: 16px 8px;
}
</style>`;

/**
 * SFMC masters may place slots before <head>. Browsers hoist that markup into <body>,
 * which breaks <meta> CSP injection unless we relocate stray nodes first.
 */
function extractBalancedBlock(text, openBraceIndex) {
  let depth = 1;
  let index = openBraceIndex + 1;
  while (index < text.length && depth > 0) {
    const char = text[index];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    index += 1;
  }
  return {
    start: openBraceIndex,
    end: index,
    inner: text.slice(openBraceIndex + 1, index - 1),
  };
}

/** Removes dark-scheme @media blocks so OS dark mode cannot override the preview toggle. */
function stripPrefersColorSchemeDarkRules(html) {
  let result = String(html ?? "");
  let match = PREFERS_DARK_MEDIA_PATTERN.exec(result);
  while (match) {
    const braceIndex = match.index + match[0].length - 1;
    const block = extractBalancedBlock(result, braceIndex);
    result = result.slice(0, match.index) + result.slice(block.end);
    PREFERS_DARK_MEDIA_PATTERN.lastIndex = match.index;
    match = PREFERS_DARK_MEDIA_PATTERN.exec(result);
  }
  PREFERS_DARK_MEDIA_PATTERN.lastIndex = 0;
  return result;
}

/** Promotes dark-scheme @media rules to unconditional CSS for forced dark preview. */
function flattenPrefersColorSchemeDarkRules(html) {
  let result = String(html ?? "");
  let match = PREFERS_DARK_MEDIA_PATTERN.exec(result);
  while (match) {
    const braceIndex = match.index + match[0].length - 1;
    const block = extractBalancedBlock(result, braceIndex);
    const flattened = `\n/* email-preview: forced dark */\n${block.inner.trim()}\n`;
    result =
      result.slice(0, match.index) + flattened + result.slice(block.end);
    PREFERS_DARK_MEDIA_PATTERN.lastIndex = match.index + flattened.length;
    match = PREFERS_DARK_MEDIA_PATTERN.exec(result);
  }
  PREFERS_DARK_MEDIA_PATTERN.lastIndex = 0;
  return result;
}

function applyPreviewColorModeRules(html, darkMode = false) {
  return darkMode
    ? flattenPrefersColorSchemeDarkRules(html)
    : stripPrefersColorSchemeDarkRules(html);
}

function relocateMarkupBeforeHead(html) {
  const match = html.match(/(<html[^>]*>\s*)([\s\S]*?)(\s*<head\b)/i);
  if (!match) return html;

  const stray = match[2].trim();
  if (!stray) return html;

  let doc = html.replace(match[0], `${match[1]}${match[3]}`);

  if (/<body(\b[^>]*)>/i.test(doc)) {
    return doc.replace(/<body(\b[^>]*)>/i, `<body$1>\n${stray}\n`);
  }

  return doc.replace(
    /<\/head>/i,
    `</head>\n<body>\n${stray}\n`,
  );
}

function injectPreviewHeadAssets(
  html,
  { interactiveBlocks = false, darkMode = false } = {},
) {
  if (!html.trim()) return html;

  const headInjection = [
    /Content-Security-Policy/i.test(html) ? "" : EMAIL_PREVIEW_CSP_META,
    /data-email-preview-layout/i.test(html) ? "" : EMAIL_PREVIEW_LAYOUT_STYLE,
    /data-email-preview-word-wrap/i.test(html) ? "" : EMAIL_PREVIEW_WORD_WRAP_STYLE,
    /data-email-preview-empty-state/i.test(html)
      ? ""
      : EMAIL_PREVIEW_EMPTY_STATE_STYLE,
    /data-email-preview-color-mode/i.test(html)
      ? ""
      : darkMode
        ? EMAIL_PREVIEW_DARK_MODE_STYLE
        : EMAIL_PREVIEW_LIGHT_MODE_STYLE,
    interactiveBlocks && !/data-email-preview-interactive/i.test(html)
      ? EMAIL_PREVIEW_INTERACTIVE_BLOCKS_STYLE
      : "",
    /data-email-preview-prefooter-color/i.test(html)
      ? ""
      : EMAIL_PREVIEW_PREFOOTER_COLOR_LOCK_STYLE,
  ]
    .filter(Boolean)
    .join("\n");

  if (!headInjection) return html;

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${headInjection}\n</head>`);
  }

  if (/<head(\b[^>]*)>/i.test(html)) {
    return html.replace(
      /<head(\b[^>]*)>/i,
      `<head$1>\n${headInjection}`,
    );
  }

  if (/<html(\b[^>]*)>/i.test(html)) {
    return html.replace(
      /<html(\b[^>]*)>/i,
      `<html$1>\n<head>\n${headInjection}\n</head>`,
    );
  }

  return `<!DOCTYPE html><html><head>${headInjection}</head><body>${html}</body></html>`;
}

export function prepareEmailPreviewIframeHtml(
  html,
  { interactiveBlocks = false, darkMode = false } = {},
) {
  let doc = String(html ?? "");
  if (!doc.trim()) return doc;

  doc = doc.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  doc = doc.replace(/<script\b[^>]*\/?>/gi, "");
  doc = doc.replace(/<custom\b[^>]*\/?>/gi, "");

  doc = relocateMarkupBeforeHead(doc);
  doc = applyPreviewColorModeRules(doc, darkMode);
  doc = injectPreviewHeadAssets(doc, { interactiveBlocks, darkMode });

  return doc;
}
