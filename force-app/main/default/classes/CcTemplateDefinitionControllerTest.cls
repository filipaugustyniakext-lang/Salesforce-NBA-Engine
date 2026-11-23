@IsTest
private class CcTemplateDefinitionControllerTest {
    private static final String SHELL_HTML = '<html><body><div data-cc-region="fixed-read">Logo</div><div data-cc-region="blocks"></div></body></html>';
    private static final String SHELL_DEFINITION = '{"schemaVersion":"1.0","kind":"shell","templateMode":"multi",'
        + '"regions":[{"regionId":"header","kind":"fixed-read"},{"regionId":"blocks-2","kind":"blocks"}],'
        + '"sections":[],"contentSlots":[]}';
    private static final String BLOCK_HTML = '<table data-cc-section="container" data-cc-bind="padding"><tr><td>'
        + '<div data-cc-content="richText" data-cc-key="note">Hi</div></td></tr></table>';
    private static final String BLOCK_DEFINITION = '{"schemaVersion":"1.0","kind":"block","templateMode":"single","regions":[],'
        + '"sections":[{"sectionId":"block","level":"container","binds":["padding"],"presets":{"colors":[],"gradients":[]}}],'
        + '"contentSlots":[{"bindingKey":"note","type":"richText","sectionId":"block","complexity":"standard"}]}';

    @TestSetup
    static void setupData() {
        Map<String, Schema.RecordTypeInfo> types = Schema.SObjectType.Marketing_Dictionary__c.getRecordTypeInfosByDeveloperName();
        insert new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Name = 'Email Main', RecordTypeId = types.get('Channel').getRecordTypeId(), Is_Active__c = true),
            new Marketing_Dictionary__c(
                Name = 'pl_PL',
                RecordTypeId = types.get('Campaign').getRecordTypeId(),
                Dictionary_Sub_Type__c = 'Locale',
                Is_Active__c = true
            )
        };
    }

    private static Id channelId() {
        return [SELECT Id FROM Marketing_Dictionary__c WHERE Name = 'Email Main' LIMIT 1].Id;
    }

    private static Id localeId() {
        return [SELECT Id FROM Marketing_Dictionary__c WHERE Name = 'pl_PL' LIMIT 1].Id;
    }

    private static Id createTemplate(String definition) {
        Map<String, Object> payload = new Map<String, Object>{
            'channelId' => channelId(),
            'slug' => 'Spring Master',
            'localeId' => localeId(),
            'classification' => 'Commercial',
            'templateMode' => 'multi',
            'description' => 'Spring campaign shell',
            'shellHtml' => SHELL_HTML,
            'definitionJson' => definition
        };
        return CcTemplateDefinitionController.saveTemplate(JSON.serialize(payload)).id;
    }

    private static Id createBlock(Id templateId, String definition) {
        return CcTemplateDefinitionController.saveBlock(JSON.serialize(new Map<String, Object>{
            'templateId' => templateId,
            'name' => 'Text block',
            'order' => 1,
            'sourceHtml' => BLOCK_HTML,
            'definitionJson' => definition
        })).id;
    }

    @IsTest
    static void savesTemplateWithLocaleBasedNameAndValidation() {
        Test.startTest();
        Id templateId = createTemplate(SHELL_DEFINITION);
        Test.stopTest();

        Channel_Template__c saved = [
            SELECT Name, Country_Code__c, Template_Mode__c, Validation_Status__c, Status__c, Locale__c, Shell_HTML__c
            FROM Channel_Template__c WHERE Id = :templateId
        ];
        System.assertEquals('TEMP_pl_PL_Spring_Master_Commercial', saved.Name);
        System.assertEquals('PL', saved.Country_Code__c);
        System.assertEquals('Multi Block', saved.Template_Mode__c);
        System.assertEquals('Valid', saved.Validation_Status__c);
        System.assertEquals('Draft', saved.Status__c);
        System.assertEquals(SHELL_HTML, saved.Shell_HTML__c);

        CcTemplateDefinitionController.TemplateSummary detail = CcTemplateDefinitionController.getTemplateDetail(templateId);
        System.assertEquals(true, detail.isV1);
        System.assertEquals('pl_PL', detail.localeCode);
        System.assertEquals(SHELL_HTML, detail.shellHtml);
        System.assertEquals(1, CcTemplateDefinitionController.getTemplates(channelId()).size());
    }

    @IsTest
    static void multiBlockTemplateNeedsAnActiveBlockToActivate() {
        Id templateId = createTemplate(SHELL_DEFINITION);
        Boolean blocked = false;
        try {
            CcTemplateDefinitionController.activateTemplate(templateId);
        } catch (AuraHandledException e) {
            blocked = e.getMessage().contains('at least one valid content block');
        }
        System.assert(blocked, 'Activation without blocks must fail.');

        Id blockId = createBlock(templateId, BLOCK_DEFINITION);
        CcTemplateDefinitionController.setBlockStatus(blockId, 'Active');
        Test.startTest();
        CcTemplateDefinitionController.activateTemplate(templateId);
        Test.stopTest();

        System.assertEquals('Active', [SELECT Status__c FROM Channel_Template__c WHERE Id = :templateId].Status__c);
        CcTemplateDefinitionController.TemplateSummary bundle = CcTemplateDefinitionController.getActiveTemplateBundle(templateId);
        System.assertEquals(1, bundle.blocks.size());
        System.assertEquals(new List<String>{ 'richText' }, bundle.blocks[0].contentTypes);

        Boolean lastActiveGuard = false;
        try {
            CcTemplateDefinitionController.setBlockStatus(blockId, 'Draft');
        } catch (AuraHandledException e) {
            lastActiveGuard = e.getMessage().contains('at least one Active content block');
        }
        System.assert(lastActiveGuard, 'The last Active block of an Active template cannot be deactivated.');
    }

    @IsTest
    static void invalidBlocksCannotBeActivatedAndActiveTemplatesMustStayValid() {
        Id templateId = createTemplate(SHELL_DEFINITION);
        Id blockId = createBlock(templateId, '{"schemaVersion":"1.0","kind":"block","sections":[],"contentSlots":[],"regions":[]}');
        System.assertEquals('Invalid', [SELECT Validation_Status__c FROM Channel_Template_Block__c WHERE Id = :blockId].Validation_Status__c);
        Boolean blocked = false;
        try {
            CcTemplateDefinitionController.setBlockStatus(blockId, 'Active');
        } catch (AuraHandledException e) {
            blocked = e.getMessage().contains('Only valid blocks');
        }
        System.assert(blocked);

        Id goodBlock = createBlock(templateId, BLOCK_DEFINITION);
        CcTemplateDefinitionController.setBlockStatus(goodBlock, 'Active');
        CcTemplateDefinitionController.activateTemplate(templateId);
        Boolean keptValid = false;
        try {
            CcTemplateDefinitionController.saveTemplate(JSON.serialize(new Map<String, Object>{
                'id' => templateId,
                'slug' => 'Spring Master',
                'localeId' => localeId(),
                'classification' => 'Commercial',
                'templateMode' => 'multi',
                'shellHtml' => '<div>no blocks region</div>',
                'definitionJson' => '{"schemaVersion":"1.0","kind":"shell","templateMode":"multi","regions":[],"sections":[],"contentSlots":[]}'
            }));
        } catch (AuraHandledException e) {
            keptValid = e.getMessage().contains('changes must stay valid');
        }
        System.assert(keptValid, 'Invalid edits to an Active template must be rejected.');
    }

    @IsTest
    static void blocksUsedByMessagesCannotBeDeleted() {
        Id templateId = createTemplate(SHELL_DEFINITION);
        Id blockId = createBlock(templateId, BLOCK_DEFINITION);
        insert new CC_Message_Blocks__c(MessageVariantId__c = 'v-1', BlockTemplateDefinitionId__c = blockId, ContentBlockOrder__c = 1);
        Boolean blocked = false;
        try {
            CcTemplateDefinitionController.deleteBlock(blockId);
        } catch (AuraHandledException e) {
            blocked = e.getMessage().contains('cannot be deleted');
        }
        System.assert(blocked);
        Boolean templateBlocked = false;
        try {
            CcTemplateDefinitionController.deleteTemplate(templateId);
        } catch (AuraHandledException e) {
            templateBlocked = e.getMessage().contains('Remove them from the messages first');
        }
        System.assert(templateBlocked);
        System.assertEquals(1, CcTemplateDefinitionController.getTemplates(channelId())[0].blocks[0].usageCount);

        delete [SELECT Id FROM CC_Message_Blocks__c];
        CcTemplateDefinitionController.deleteBlock(blockId);
        CcTemplateDefinitionController.deleteTemplate(templateId);
        System.assertEquals(0, [SELECT COUNT() FROM Channel_Template__c]);
    }

    @IsTest
    static void templatesInUseExplainWhyAndUnusedActiveTemplatesCanBeDeleted() {
        Id templateId = createTemplate(SHELL_DEFINITION);
        CcTemplateDefinitionController.setBlockStatus(createBlock(templateId, BLOCK_DEFINITION), 'Active');
        CcTemplateDefinitionController.activateTemplate(templateId);
        insert new CC_Message_Metadata__c(Name = 'EM-pl-PL-Spring-1', MessageName__c = 'EM-pl-PL-Spring', Source_Template__c = templateId);

        CcTemplateDefinitionController.TemplateSummary summary = CcTemplateDefinitionController.getTemplates(channelId())[0];
        System.assertEquals(1, summary.messageCount);
        System.assert(summary.deleteBlockedReason.contains('EM-pl-PL-Spring-1'), summary.deleteBlockedReason);
        Boolean blocked = false;
        try {
            CcTemplateDefinitionController.deleteTemplate(templateId);
        } catch (AuraHandledException e) {
            blocked = e.getMessage().contains('cannot be deleted') && e.getMessage().contains('EM-pl-PL-Spring-1');
        }
        System.assert(blocked);

        delete [SELECT Id FROM CC_Message_Metadata__c];
        System.assertEquals(null, CcTemplateDefinitionController.getTemplates(channelId())[0].deleteBlockedReason);
        Test.startTest();
        CcTemplateDefinitionController.deleteTemplate(templateId);
        Test.stopTest();
        System.assertEquals(0, [SELECT COUNT() FROM Channel_Template__c], 'An unused Active template is deleted in one step.');
        System.assertEquals(0, [SELECT COUNT() FROM Channel_Template_Block__c]);
    }

    @IsTest
    static void activatingANewVersionOnlyArchivesTheSameTemplateFamily() {
        Id first = createTemplate(SHELL_DEFINITION);
        CcTemplateDefinitionController.setBlockStatus(createBlock(first, BLOCK_DEFINITION), 'Active');
        CcTemplateDefinitionController.activateTemplate(first);

        Id other = CcTemplateDefinitionController.saveTemplate(JSON.serialize(new Map<String, Object>{
            'channelId' => channelId(),
            'slug' => 'Transactional Shell',
            'localeId' => localeId(),
            'classification' => 'Transactional',
            'templateMode' => 'multi',
            'shellHtml' => SHELL_HTML,
            'definitionJson' => SHELL_DEFINITION
        })).id;
        CcTemplateDefinitionController.setBlockStatus(createBlock(other, BLOCK_DEFINITION), 'Active');
        Test.startTest();
        CcTemplateDefinitionController.activateTemplate(other);
        Test.stopTest();

        System.assertEquals('Active', [SELECT Status__c FROM Channel_Template__c WHERE Id = :first].Status__c,
            'A different template family on the same channel stays Active.');
        System.assertEquals('Active', [SELECT Status__c FROM Channel_Template__c WHERE Id = :other].Status__c);

        CcTemplateDefinitionController.archiveTemplate(other);
        System.assertEquals('Archived', [SELECT Status__c FROM Channel_Template__c WHERE Id = :other].Status__c);
    }

    @IsTest
    static void reordersBlocksAndRejectsMissingInput() {
        Id templateId = createTemplate(SHELL_DEFINITION);
        Id a = createBlock(templateId, BLOCK_DEFINITION);
        Id b = createBlock(templateId, BLOCK_DEFINITION);
        CcTemplateDefinitionController.reorderBlocks(new List<Id>{ b, a });
        System.assertEquals(1, [SELECT Block_Order__c FROM Channel_Template_Block__c WHERE Id = :b].Block_Order__c);

        Integer failures = 0;
        try { CcTemplateDefinitionController.saveTemplate(null); } catch (AuraHandledException e) { failures++; }
        try { CcTemplateDefinitionController.saveTemplate('{"slug":"x"}'); } catch (AuraHandledException e) { failures++; }
        try { CcTemplateDefinitionController.saveBlock('{"name":"x"}'); } catch (AuraHandledException e) { failures++; }
        try { CcTemplateDefinitionController.setBlockStatus(a, 'Bogus'); } catch (AuraHandledException e) { failures++; }
        try { CcTemplateDefinitionController.getTemplateDetail(null); } catch (AuraHandledException e) { failures++; }
        System.assertEquals(5, failures);
        System.assertEquals(0, CcTemplateDefinitionController.getTemplates(null).size());
    }
}
