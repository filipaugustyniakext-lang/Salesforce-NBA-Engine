@IsTest
private class CcTemplateValidatorTest {
    @IsTest
    static void acceptsAValidBlockDefinition() {
        String json = '{"schemaVersion":"1.0","kind":"block","regions":[],'
            + '"sections":[{"sectionId":"block","level":"container","binds":["padding","background"],'
            + '"presets":{"colors":[{"id":"red","label":"Red","hex":"#e2001a"}],"gradients":[{"id":"g","label":"G","css":"linear-gradient(#fff,#000)","fallbackColor":"#ffffff"}]}},'
            + '{"sectionId":"row-1","level":"row","binds":["column-direction"],"presets":{}}],'
            + '"contentSlots":[{"bindingKey":"note","type":"richText","sectionId":"row-1","complexity":"basic"},'
            + '{"bindingKey":"list","type":"bulletList","sectionId":"row-1","iconPresets":[{"id":"i","url":"https://x/i.png"}]}]}';
        CcTemplateValidator.Result result = CcTemplateValidator.validateDefinition(json, 'block', null);
        System.assertEquals(true, result.valid, result.errors);
        System.assertEquals(new Set<String>{ 'richText', 'bulletList' }, CcTemplateValidator.contentTypesOf(json));
        System.assertEquals('Valid.', result.summary());
    }

    @IsTest
    static void reportsStructuralErrors() {
        String json = '{"schemaVersion":"0.9","kind":"block","regions":[{"kind":"blocks"},{"kind":"weird"}],'
            + '"sections":[{"sectionId":"a","level":"column","binds":["column-direction","glow"],'
            + '"presets":{"colors":[{"id":"x","hex":"red"}],"gradients":[{"id":"g","css":"red"}]}},'
            + '{"sectionId":"a","level":"cell","binds":[]}],'
            + '"contentSlots":[{"bindingKey":"1bad","type":"video","sectionId":"zzz"},'
            + '{"bindingKey":"t","type":"richText","complexity":"huge"},{"bindingKey":"t","type":"bulletList","iconPresets":[{"id":"i"}]},'
            + '{"bindingKey":"l","type":"bulletList","iconPresets":[],"allowNoIcon":false}]}';
        CcTemplateValidator.Result result = CcTemplateValidator.validateDefinition(json, 'shell', 'multi');
        System.assertEquals(false, result.valid);
        String all = String.join(result.errors, '\n');
        for (String expected : new List<String>{
            'Unsupported schema version', 'Expected a shell definition', 'Unknown binding "glow"',
            'Column direction can only be bound on rows', 'is not a hex color', 'has no CSS gradient',
            'needs a fallback hex color', 'Duplicate section id', 'Unknown section level', 'Unknown content type "video"',
            'Binding key must start with a letter', 'unknown section "zzz"', 'Unknown rich text complexity',
            'Duplicate binding key', 'has no image', 'Add at least one bullet icon', 'Unknown region kind',
            'cannot contain a blocks region'
        }) {
            System.assert(all.contains(expected), 'Missing error: ' + expected + '\n' + all);
        }
        System.assert(result.summary().contains('Unsupported schema version'));
    }

    @IsTest
    static void rejectsBrokenJsonAndUnsafeMarkup() {
        System.assertEquals(false, CcTemplateValidator.validateDefinition(null, null, null).valid);
        System.assertEquals(false, CcTemplateValidator.validateDefinition('{nope', null, null).valid);
        System.assertEquals(false, CcTemplateValidator.validateDefinition('[1]', null, null).valid);
        CcTemplateValidator.Result markup = new CcTemplateValidator.Result();
        CcTemplateValidator.checkMarkup('<script>x</script><link rel="stylesheet" href="a.css">', 'Shell', markup);
        System.assertEquals(2, markup.errors.size());
        CcTemplateValidator.Result empty = new CcTemplateValidator.Result();
        CcTemplateValidator.checkMarkup('', 'Shell', empty);
        System.assertEquals(false, empty.valid);
    }

    @IsTest
    static void multiShellNeedsOneBlocksRegionAndWarnsOnMissingPresets() {
        String shell = '{"schemaVersion":"1.0","kind":"shell","regions":[],'
            + '"sections":[{"sectionId":"c","level":"container","binds":["background"],"presets":{}}],"contentSlots":[]}';
        CcTemplateValidator.Result result = CcTemplateValidator.validateDefinition(shell, 'shell', 'multi');
        System.assert(String.join(result.errors, ' ').contains('exactly one blocks region'));
        System.assertEquals(1, result.warnings.size());
        CcTemplateValidator.Result single = CcTemplateValidator.validateDefinition(shell, 'shell', 'single');
        System.assert(String.join(single.errors, ' ').contains('Add at least one content binding'));
    }

    @IsTest
    static void warnsOnlyForPresetsOfTheBoundBackgroundKinds() {
        String block = '{"schemaVersion":"1.0","kind":"block","regions":[],'
            + '"sections":[{"sectionId":"c","level":"container","binds":["background"],'
            + '"targets":{"bgColor":{"fallback":"#ffffff"},"bgGradient":{"fallback":""},"bgImage":{"fallback":""}},"presets":{"colors":[],"gradients":[]}}],'
            + '"contentSlots":[{"bindingKey":"t","type":"richText","sectionId":"c"}]}';
        CcTemplateValidator.Result result = CcTemplateValidator.validateDefinition(block, 'block', 'single');
        String warnings = String.join(result.warnings, ' ');
        System.assert(warnings.contains('Background color is bound but no color presets'));
        System.assert(warnings.contains('Background gradient is bound but no gradient presets'));
        System.assert(!warnings.contains('Background is bound but no color or gradient presets'));

        String imageOnly = '{"schemaVersion":"1.0","kind":"block","regions":[],'
            + '"sections":[{"sectionId":"c","level":"container","binds":["background"],'
            + '"targets":{"bgImage":{"fallback":""}},"presets":{}}],'
            + '"contentSlots":[{"bindingKey":"t","type":"richText","sectionId":"c"}]}';
        System.assertEquals(0, CcTemplateValidator.validateDefinition(imageOnly, 'block', 'single').warnings.size());
    }

    @IsTest
    static void validatesMessageBlockContent() {
        String definition = '{"schemaVersion":"1.0","kind":"block","regions":[],"sections":[],'
            + '"contentSlots":[{"bindingKey":"cta","type":"button"},{"bindingKey":"hero","type":"image"},{"bindingKey":"list","type":"bulletList"}]}';
        String content = '{"blockConfig":{"rows":[{"columns":[{"content":['
            + '{"type":"button","visible":true,"label":"","url":"example.com","targetType":"WebURL"},'
            + '{"type":"image","desktop":{"light":{"url":null}}},'
            + '{"type":"bulletList","items":[{"html":""}]},'
            + '{"type":"richText","html":"x"},{"type":"video"}]}]}]}}';
        CcTemplateValidator.Result result = CcTemplateValidator.validateMessageBlock(content, definition, 'Block 1');
        String all = String.join(result.errors, '\n');
        for (String expected : new List<String>{
            'Button label is required', 'Web URLs must start with', 'Desktop image is required',
            'Add at least one list item', 'richText is not supported', 'Unknown content type "video"'
        }) {
            System.assert(all.contains(expected), 'Missing error: ' + expected + '\n' + all);
        }
        System.assertEquals(true, CcTemplateValidator.validateMessageBlock('{"legacy":{"type":"SMSBody"}}', null, 'Legacy').valid);
        System.assertEquals(false, CcTemplateValidator.validateMessageBlock('{"x":1}', null, 'Empty').valid);
        String good = '{"blockConfig":{"rows":[{"columns":[{"content":[{"type":"button","visible":true,"label":"Go","url":"https://x","targetType":"WebURL"}]}]}]}}';
        System.assertEquals(true, CcTemplateValidator.validateMessageBlock(good, definition, 'Good').valid);
    }

    @IsTest
    static void validatesTemplateRecords() {
        Channel_Template__c template = new Channel_Template__c(Template_Mode__c = 'Single Block');
        CcTemplateValidator.Result result = CcTemplateValidator.validateTemplate(template, null, true);
        String all = String.join(result.errors, '\n');
        System.assert(all.contains('Select a template locale'));
        System.assert(all.contains('Select a send classification'));
        System.assert(all.contains('HTML is empty'));
        System.assertEquals('single', CcTemplateValidator.templateModeKey(template));
        System.assertEquals(false, CcTemplateValidator.isV1(template));
        System.assertEquals(true, CcTemplateValidator.isHexColor('#fff'));
        System.assertEquals(false, CcTemplateValidator.isHexColor(null));

        Channel_Template_Block__c draftBlock = new Channel_Template_Block__c(Name = 'Draft', Status__c = 'Draft');
        Channel_Template__c multi = new Channel_Template__c(Template_Mode__c = 'Multi Block');
        CcTemplateValidator.Result multiResult = CcTemplateValidator.validateTemplate(multi, new List<Channel_Template_Block__c>{ draftBlock }, true);
        System.assert(String.join(multiResult.errors, ' ').contains('Activate at least one valid content block'));
        System.assert(!multiResult.warnings.isEmpty(), 'Draft block issues are warnings.');
    }
}
