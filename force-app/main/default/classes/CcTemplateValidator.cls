/**
 * Server-side validation of Copy Center schema v1 template definitions and message block content.
 * Mirrors the rules of the c/ccTemplateSchema LWC module. HTML is never parsed here; only the
 * definition JSON produced by c/ccTemplateParser is checked, plus a few unsafe-markup guards.
 * Contract: docs/copy-center/binding-syntax.md
 */
public with sharing class CcTemplateValidator {
    public static final String SCHEMA_VERSION = '1.0';
    public static final Set<String> CONTENT_TYPES = new Set<String>{ 'richText', 'image', 'bulletList', 'divider', 'button' };
    public static final Set<String> SECTION_LEVELS = new Set<String>{ 'container', 'row', 'column' };
    public static final Set<String> SECTION_BINDS = new Set<String>{ 'padding', 'margin', 'background', 'hide', 'column-direction' };
    public static final Set<String> REGION_KINDS = new Set<String>{ 'fixed-read', 'fixed-edit', 'blocks' };
    public static final Set<String> COMPLEXITY_LEVELS = new Set<String>{ 'basic', 'standard', 'full' };
    private static final Pattern HEX_PATTERN = Pattern.compile('^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$');
    private static final Pattern KEY_PATTERN = Pattern.compile('^[A-Za-z][A-Za-z0-9_-]{0,79}$');

    public class Result {
        @AuraEnabled public Boolean valid = true;
        @AuraEnabled public List<String> errors = new List<String>();
        @AuraEnabled public List<String> warnings = new List<String>();

        public void error(String path, String message) {
            errors.add(String.isBlank(path) ? message : path + ': ' + message);
            valid = false;
        }

        public void warn(String path, String message) {
            warnings.add(String.isBlank(path) ? message : path + ': ' + message);
        }

        public void mergeFrom(String prefix, Result other) {
            if (other == null) return;
            for (String message : other.errors) error(prefix, message);
            for (String message : other.warnings) warn(prefix, message);
        }

        public String summary() {
            if (valid && warnings.isEmpty()) return 'Valid.';
            List<String> lines = new List<String>();
            lines.addAll(errors);
            for (String warning : warnings) lines.add('Warning: ' + warning);
            return String.join(lines, '\n');
        }
    }

    public static Boolean isV1(Channel_Template__c template) {
        return template != null && String.isNotBlank(template.Definition_JSON__c);
    }

    public static Boolean isHexColor(Object value) {
        return value != null && HEX_PATTERN.matcher(String.valueOf(value).trim()).matches();
    }

    // ─── Markup guards ───────────────────────────────────────────────────────

    public static void checkMarkup(String html, String label, Result result) {
        if (String.isBlank(html)) {
            result.error(label, 'HTML is empty.');
            return;
        }
        String lower = html.toLowerCase();
        if (lower.contains('<script')) result.error(label, 'Scripts are not allowed in templates.');
        if (Pattern.compile('<link[^>]+rel\\s*=\\s*["\']?stylesheet').matcher(lower).find()) {
            result.error(label, 'External stylesheets are not supported. Inline the CSS into the HTML file.');
        }
    }

    // ─── Definition JSON ─────────────────────────────────────────────────────

    public static Result validateDefinition(String definitionJson, String expectedKind, String templateMode) {
        Result result = new Result();
        Map<String, Object> definition = parseObject(definitionJson, result, 'Definition');
        if (definition == null) return result;

        if (String.valueOf(definition.get('schemaVersion')) != SCHEMA_VERSION) {
            result.error('', 'Unsupported schema version ' + definition.get('schemaVersion') + '.');
        }
        String kind = (String) definition.get('kind');
        if (String.isNotBlank(expectedKind) && kind != expectedKind) {
            result.error('', 'Expected a ' + expectedKind + ' definition but found ' + kind + '.');
        }
        String mode = String.isNotBlank(templateMode) ? templateMode : (String) definition.get('templateMode');

        Set<String> sectionIds = new Set<String>();
        for (Object raw : asList(definition.get('sections'))) {
            Map<String, Object> section = asMap(raw);
            String sectionId = (String) section.get('sectionId');
            String level = (String) section.get('level');
            if (String.isBlank(sectionId)) result.error('', 'A section has no sectionId.');
            if (!SECTION_LEVELS.contains(level)) result.error(sectionId, 'Unknown section level "' + level + '".');
            if (sectionIds.contains(sectionId)) result.error(sectionId, 'Duplicate section id.');
            sectionIds.add(sectionId);
            Set<String> binds = new Set<String>();
            for (Object bind : asList(section.get('binds'))) {
                String name = String.valueOf(bind);
                binds.add(name);
                if (!SECTION_BINDS.contains(name)) result.error(sectionId, 'Unknown binding "' + name + '".');
                if (name == 'column-direction' && level != 'row') {
                    result.error(sectionId, 'Column direction can only be bound on rows.');
                }
            }
            Map<String, Object> presets = asMap(section.get('presets'));
            List<Object> colors = asList(presets.get('colors'));
            List<Object> gradients = asList(presets.get('gradients'));
            for (Object color : colors) {
                Map<String, Object> preset = asMap(color);
                if (!isHexColor(preset.get('hex'))) {
                    result.error(sectionId, 'Color preset "' + labelOf(preset) + '" is not a hex color.');
                }
            }
            for (Object gradient : gradients) {
                Map<String, Object> preset = asMap(gradient);
                String css = (String) preset.get('css');
                if (String.isBlank(css) || !css.toLowerCase().contains('gradient(')) {
                    result.error(sectionId, 'Gradient preset "' + labelOf(preset) + '" has no CSS gradient.');
                }
                if (!isHexColor(preset.get('fallbackColor'))) {
                    result.error(sectionId, 'Gradient preset "' + labelOf(preset) + '" needs a fallback hex color.');
                }
            }
            if (binds.contains('background') && colors.isEmpty() && gradients.isEmpty()) {
                result.warn(sectionId, 'Background is bound but no color or gradient presets are configured.');
            }
        }

        Set<String> keys = new Set<String>();
        List<Object> slots = asList(definition.get('contentSlots'));
        for (Object raw : slots) {
            Map<String, Object> slot = asMap(raw);
            String key = (String) slot.get('bindingKey');
            String type = (String) slot.get('type');
            if (!CONTENT_TYPES.contains(type)) result.error(key, 'Unknown content type "' + type + '".');
            if (key == null || !KEY_PATTERN.matcher(key).matches()) {
                result.error(key, 'Binding key must start with a letter and use letters, digits, "_" or "-".');
            }
            if (keys.contains(key)) result.error(key, 'Duplicate binding key.');
            keys.add(key);
            String sectionId = (String) slot.get('sectionId');
            if (String.isNotBlank(sectionId) && !sectionIds.contains(sectionId) && !sectionId.startsWith('implicit')) {
                result.error(key, 'Content refers to unknown section "' + sectionId + '".');
            }
            String complexity = (String) slot.get('complexity');
            if ((type == 'richText' || type == 'bulletList') && String.isNotBlank(complexity) && !COMPLEXITY_LEVELS.contains(complexity)) {
                result.error(key, 'Unknown rich text complexity "' + complexity + '".');
            }
            if (type == 'bulletList') {
                List<Object> icons = asList(slot.get('iconPresets'));
                for (Object icon : icons) {
                    Map<String, Object> preset = asMap(icon);
                    if (String.isBlank((String) preset.get('url')) && String.isBlank((String) preset.get('contentId'))) {
                        result.error(key, 'Bullet icon "' + labelOf(preset) + '" has no image.');
                    }
                }
                if (icons.isEmpty() && slot.get('allowNoIcon') == false) {
                    result.error(key, 'Add at least one bullet icon or allow lists without icons.');
                }
            }
        }

        Integer blockRegions = 0;
        for (Object raw : asList(definition.get('regions'))) {
            String regionKind = (String) asMap(raw).get('kind');
            if (!REGION_KINDS.contains(regionKind)) result.error('', 'Unknown region kind "' + regionKind + '".');
            if (regionKind == 'blocks') blockRegions++;
        }
        Boolean singleBlock = kind == 'block' || mode == 'single';
        if (kind == 'shell' && mode == 'multi' && blockRegions != 1) {
            result.error('', 'A multi-block shell needs exactly one blocks region (data-cc-region="blocks").');
        }
        if (singleBlock && blockRegions > 0) {
            result.error('', 'Single-block templates and content blocks cannot contain a blocks region.');
        }
        if (singleBlock && slots.isEmpty()) {
            result.error('', 'Add at least one content binding (data-cc-content).');
        }
        return result;
    }

    public static Set<String> contentTypesOf(String definitionJson) {
        Set<String> types = new Set<String>();
        Map<String, Object> definition = parseObject(definitionJson, new Result(), 'Definition');
        if (definition == null) return types;
        for (Object raw : asList(definition.get('contentSlots'))) {
            String type = (String) asMap(raw).get('type');
            if (CONTENT_TYPES.contains(type)) types.add(type);
        }
        return types;
    }

    // ─── Records ─────────────────────────────────────────────────────────────

    public static String templateModeKey(Channel_Template__c template) {
        return template != null && template.Template_Mode__c == 'Single Block' ? 'single' : 'multi';
    }

    public static Result validateBlock(Channel_Template_Block__c block) {
        Result result = new Result();
        checkMarkup(block.Source_HTML__c, null, result);
        result.mergeFrom(null, validateDefinition(block.Definition_JSON__c, 'block', 'single'));
        return result;
    }

    /** Validates a template and, for multi-block templates, its blocks. Used on save and activation. */
    public static Result validateTemplate(Channel_Template__c template, List<Channel_Template_Block__c> blocks, Boolean forActivation) {
        Result result = new Result();
        if (template.Locale__c == null) result.error('', 'Select a template locale.');
        if (String.isBlank(template.Template_Classification__c)) result.error('', 'Select a send classification.');
        String shell = (template.Shell_HTML__c == null ? '' : template.Shell_HTML__c)
            + (template.Shell_HTML_Part2__c == null ? '' : template.Shell_HTML_Part2__c);
        checkMarkup(shell, 'Shell', result);
        String mode = templateModeKey(template);
        result.mergeFrom('Shell', validateDefinition(template.Definition_JSON__c, 'shell', mode));
        if (mode == 'multi') {
            Integer usable = 0;
            for (Channel_Template_Block__c block : blocks == null ? new List<Channel_Template_Block__c>() : blocks) {
                if (block.Status__c == 'Archived') continue;
                Result blockResult = validateBlock(block);
                if (block.Status__c == 'Active' || block.Status__c == 'Ready') {
                    result.mergeFrom('Block ' + block.Name, blockResult);
                } else {
                    for (String message : blockResult.errors) result.warn('Block ' + block.Name, message);
                }
                if (block.Status__c == 'Active' && blockResult.valid) usable++;
            }
            if (forActivation && usable == 0) {
                result.error('', 'Activate at least one valid content block before activating a multi-block template.');
            }
        }
        return result;
    }

    // ─── Message block content ───────────────────────────────────────────────

    /** Validates one CC_Message_Blocks__c ContentJson against its block definition before Ready/Live. */
    public static Result validateMessageBlock(String contentJson, String definitionJson, String label) {
        Result result = new Result();
        Map<String, Object> block = parseObject(contentJson, result, label);
        if (block == null) return result;
        Map<String, Object> config = asMap(block.get('blockConfig'));
        if (config.isEmpty()) {
            if (block.containsKey('legacy')) return result;
            result.error(label, 'Block configuration is missing.');
            return result;
        }
        Set<String> allowed = String.isBlank(definitionJson) ? new Set<String>() : contentTypesOf(definitionJson);
        Integer rowIndex = 0;
        for (Object rawRow : asList(config.get('rows'))) {
            rowIndex++;
            Integer columnIndex = 0;
            for (Object rawColumn : asList(asMap(rawRow).get('columns'))) {
                columnIndex++;
                Integer itemIndex = 0;
                for (Object rawItem : asList(asMap(rawColumn).get('content'))) {
                    itemIndex++;
                    Map<String, Object> item = asMap(rawItem);
                    String type = (String) item.get('type');
                    String path = label + ' / Row ' + rowIndex + ' / Column ' + columnIndex + ' / Item ' + itemIndex;
                    if (!CONTENT_TYPES.contains(type)) {
                        result.error(path, 'Unknown content type "' + type + '".');
                        continue;
                    }
                    if (!allowed.isEmpty() && !allowed.contains(type)) {
                        result.error(path, type + ' is not supported by this block.');
                        continue;
                    }
                    validateItem(item, type, path, result);
                }
            }
        }
        return result;
    }

    private static void validateItem(Map<String, Object> item, String type, String path, Result result) {
        if (type == 'button' && item.get('visible') != false) {
            String url = (String) item.get('url');
            if (String.isBlank((String) item.get('label'))) result.error(path, 'Button label is required.');
            if (String.isBlank(url)) result.error(path, 'Button target URL is required.');
            if (item.get('targetType') == 'WebURL' && String.isNotBlank(url)
                && !url.toLowerCase().startsWith('http://') && !url.toLowerCase().startsWith('https://') && !url.startsWith('%%')) {
                result.error(path, 'Web URLs must start with http:// or https://.');
            }
        }
        if (type == 'image') {
            Map<String, Object> light = asMap(asMap(item.get('desktop')).get('light'));
            if (String.isBlank((String) light.get('url')) && String.isBlank((String) light.get('contentId'))) {
                result.error(path, 'Desktop image is required.');
            }
        }
        if (type == 'bulletList') {
            Boolean hasItem = false;
            for (Object entry : asList(item.get('items'))) {
                if (String.isNotBlank((String) asMap(entry).get('html'))) hasItem = true;
            }
            if (!hasItem) result.error(path, 'Add at least one list item.');
        }
    }

    // ─── JSON helpers ────────────────────────────────────────────────────────

    public static Map<String, Object> parseObject(String jsonText, Result result, String label) {
        if (String.isBlank(jsonText)) {
            result.error(label, 'JSON is empty.');
            return null;
        }
        try {
            Object parsed = JSON.deserializeUntyped(jsonText);
            if (parsed instanceof Map<String, Object>) return (Map<String, Object>) parsed;
        } catch (Exception e) {
            result.error(label, 'JSON is not valid: ' + e.getMessage());
            return null;
        }
        result.error(label, 'JSON must be an object.');
        return null;
    }

    public static Map<String, Object> asMap(Object value) {
        return value instanceof Map<String, Object> ? (Map<String, Object>) value : new Map<String, Object>();
    }

    public static List<Object> asList(Object value) {
        return value instanceof List<Object> ? (List<Object>) value : new List<Object>();
    }

    private static String labelOf(Map<String, Object> preset) {
        Object label = preset.get('label');
        return label != null ? String.valueOf(label) : String.valueOf(preset.get('id'));
    }
}
