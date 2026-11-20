# Copy Center binding syntax (schema v1)

This is the contract between three things:

- The HTML a template admin uploads in Marketing Dictionary > Channels > Templates.
- The template definition JSON stored on `Channel_Template__c.Definition_JSON__c` and `Channel_Template_Block__c.Definition_JSON__c`.
- The content JSON a marketer produces in the Copy Center editor, stored on `CC_Message_Blocks__c.ContentJson__c`. See `CopyCenterJsonBoilerplate.v1.json`.

The parser (`c/ccTemplateParser`), renderer (`c/ccTemplateRenderer`) and schema helpers (`c/ccTemplateSchema`) are the only code that reads or writes these formats. Apex (`CcTemplateValidator`) validates JSON only and never parses HTML.

## 1. Structure: sections

Every template, whatever the channel, is a tree of sections: **container > row > column > content**.

| Attribute | Values | Meaning |
| --- | --- | --- |
| `data-cc-section` | `container`, `row`, `column` | Marks a section element. A row with no columns is treated as a single column. |
| `data-cc-id` | unique slug, e.g. `hero` | Stable id used as `sectionId` in JSON. Generated (`row-1-col-2`) when missing. |
| `data-cc-bind` | space-separated list: `padding margin background hide column-direction` | Section settings the marketer may change. `column-direction` is valid on rows only. |
| `data-cc-region` | `fixed-read`, `fixed-edit`, `blocks` | Shell regions. `fixed-read` renders as-is. `fixed-edit` keeps settings fixed but its content stays editable. `blocks` is the drop zone for content blocks (multi-block templates only, exactly one). |

The renderer writes settings directly onto the bound element:

- Padding and margin become inline `padding` / `margin` styles.
- Background becomes `background-color`, `background-image` and the `bgcolor` attribute, plus a VML fallback for gradients.
- Hide adds the classes `cc-hide-dsk` / `cc-hide-mob`. The shell CSS must define them.
- Column direction sets the `dir` attribute (`ltr` / `rtl`) and the class `cc-stack-mob` when mobile is `stack`.

The shell CSS must contain the matching rules (`.cc-hide-dsk`, `.cc-hide-mob` in media queries, `.cc-stack-mob`). The validator reports a warning when they are missing.

## 2. Content

Content elements live inside a column (or a row with no columns).

| Attribute | Values |
| --- | --- |
| `data-cc-content` | `richText`, `image`, `bulletList`, `divider`, `button` |
| `data-cc-key` | binding key, unique inside the block, e.g. `legalNote` |
| `data-cc-label` | optional label shown in the editor |
| `data-cc-complexity` | `basic`, `standard`, `full` (rich text and bullet list) |

How each type renders:

- **richText**: the element's inner HTML is replaced with the editor output. A block may contain several rich text elements with different keys.
- **image**: an `<img>` element. `src`, `alt`, `width` and `height` are set. The mobile image falls back to the desktop image, and dark falls back to light.
- **bulletList**: a container element holding one child with `data-cc-loop="item"`. Inside the item, `data-cc-slot="icon"` (an `<img>`) and `data-cc-slot="text"` mark the bullet parts. The item is cloned for each list item, and the icon is removed when `useIcons` is false. Wrap the icon in `data-cc-slot="icon-cell"` (for example its `<td>`) to remove the whole cell.
- **divider**: an element whose top and bottom padding are set. A child with `data-cc-slot="line"` is removed when `showLine` is false.
- **button**: an `<a>` element. Label, `href`, `target` and `data-alias` are set, and the element is removed when `visible` is false. App URLs are written as given (deep link).

## 3. Template definition JSON

Stored in `Definition_JSON__c`. It is produced by `ccTemplateParser.parseTemplate(html, kind)` and enriched in the wizard with defaults and presets.

```json
{
  "schemaVersion": "1.0",
  "kind": "shell | block",
  "templateMode": "single | multi",
  "regions": [{ "regionId": "header", "kind": "fixed-read" }],
  "sections": [
    {
      "sectionId": "row-1",
      "level": "container | row | column",
      "parentId": "block",
      "regionKind": null,
      "binds": ["padding", "margin", "background", "hide", "column-direction"],
      "defaults": { "padding": {}, "margin": {}, "background": {}, "visibility": {}, "columnDirection": {} },
      "presets": {
        "colors": [{ "id": "brand-red", "label": "Brand red", "hex": "#e2001a" }],
        "gradients": [{ "id": "sunrise", "label": "Sunrise", "css": "linear-gradient(...)", "fallbackColor": "#e2001a" }]
      }
    }
  ],
  "contentSlots": [
    {
      "bindingKey": "legalNote",
      "type": "richText",
      "sectionId": "row-1-col-1",
      "label": "Legal note",
      "complexity": "basic",
      "iconPresets": [],
      "allowNoIcon": true,
      "defaults": {}
    }
  ]
}
```

## 4. Legacy markers (read-only support)

Templates uploaded before schema v1 use these markers. `ccTemplateSchema.migrateLegacy()` maps them on read, so existing templates keep working:

- `binding-container` maps to `data-cc-section="container"`, `binding-column` to `column`, and `binding-content` to a content wrapper.
- `{{blo-pad-dsk}}` / `{{container-pad-dsk}}` / `{{col-pad-*}}` map to the `padding` bind; `*-bg*` tokens to `background`; `*-hide-*` to `hide`; `{{column-dir}}` to `column-direction`.
- `cc-preview` with `region=fixed-read|fixed-edit|blocks` maps to `data-cc-region`.
- `data-editor="text|richtext"` maps to `richText`, `image` to `image`, and `action` to `button`.

New uploads must use the v1 attributes. The wizard reports legacy markers as warnings.

## 5. Status rules

- `Channel_Template__c` and `Channel_Template_Block__c` statuses are Draft, Ready, Active, Archived. Only a definition with `Validation_Status__c = 'Valid'` can be activated, and only Active blocks appear in the Copy Center editor.
- A template or block cannot be deleted while any `CC_Message_Metadata__c.Source_Template__c` (template) or `CC_Message_Blocks__c` (block) references it.
- `CC_Message_Metadata__c.Status__c` values are Draft, Ready, Live, Inactive, Archived. `IsActive__c` is derived (`Status__c = 'Live'`) by the metadata trigger.
