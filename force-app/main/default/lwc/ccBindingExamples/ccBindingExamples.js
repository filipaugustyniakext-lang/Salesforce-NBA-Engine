/** Starter HTML files for the template wizard. Both parse without errors in c/ccTemplateParser. */

const CSS = `<style>
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
  .cc-hide-dsk { display: none !important; }
  @media (max-width: 480px) {
    .cc-hide-mob { display: none !important; }
    .cc-stack-mob td { display: block !important; width: 100% !important; }
  }
</style>`;

export const SHELL_EXAMPLE = `<!DOCTYPE html>
<html>
<head>
${CSS}
</head>
<body>
  <!-- Read-only header: rendered exactly as written, marketers cannot change it -->
  <div data-cc-region="fixed-read" data-cc-id="header">
    <table width="100%"><tr><td style="padding:16px;"><img src="https://example.com/logo.png" alt="Logo" width="120" /></td></tr></table>
  </div>

  <!-- Drop zone for content blocks (exactly one in a multi-block template) -->
  <div data-cc-region="blocks" data-cc-id="content"></div>

  <!-- Footer: always shown, section settings fixed, text stays editable -->
  <div data-cc-region="fixed-edit" data-cc-id="footer">
    <table width="100%"><tr><td style="padding:16px; font-size:12px; color:#666666;">
      <div data-cc-content="richText" data-cc-key="footerNote" data-cc-label="Footer note" data-cc-complexity="basic">Legal footer text.</div>
    </td></tr></table>
  </div>
</body>
</html>`;

export const BLOCK_EXAMPLE = `<!DOCTYPE html>
<html>
<head>
${CSS}
</head>
<body>
  <!-- container: padding, margin, background and hide toggles -->
  <table width="100%" data-cc-section="container" data-cc-bind="padding margin background hide">
    <tr>
      <!-- row: column order on desktop and mobile -->
      <td data-cc-section="row" data-cc-id="main" data-cc-bind="column-direction">
        <table width="100%" class="cc-stack-mob"><tr>
          <!-- column 1: text content -->
          <td data-cc-section="column" data-cc-bind="padding hide" valign="top">
            <div data-cc-content="richText" data-cc-key="headline" data-cc-label="Headline" data-cc-complexity="standard">Headline</div>
            <table data-cc-content="bulletList" data-cc-key="benefits" data-cc-label="Benefits">
              <tr data-cc-loop="item">
                <td data-cc-slot="icon-cell"><img data-cc-slot="icon" src="https://example.com/check.png" width="16" alt="" /></td>
                <td data-cc-slot="text">Benefit</td>
              </tr>
            </table>
            <div data-cc-content="divider" data-cc-key="divider"><hr data-cc-slot="line" /></div>
            <a data-cc-content="button" data-cc-key="cta" data-cc-label="Call to action" href="https://example.com" style="display:inline-block;padding:10px 20px;background:#e2001a;color:#ffffff;text-decoration:none;">Open</a>
          </td>
          <!-- column 2: image -->
          <td data-cc-section="column" data-cc-bind="padding hide" valign="top">
            <img data-cc-content="image" data-cc-key="hero" data-cc-label="Hero image" src="https://example.com/hero.png" width="280" alt="" />
          </td>
        </tr></table>
      </td>
    </tr>
  </table>
</body>
</html>`;

export function exampleFor(kind, templateMode) {
    return kind === 'shell' && templateMode !== 'single' ? SHELL_EXAMPLE : BLOCK_EXAMPLE;
}
