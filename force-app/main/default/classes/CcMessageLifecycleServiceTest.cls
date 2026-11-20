@IsTest
private class CcMessageLifecycleServiceTest {
    private static final String BLOCK_DEFINITION = '{"schemaVersion":"1.0","kind":"block","templateMode":"single","regions":[],'
        + '"sections":[],"contentSlots":[{"bindingKey":"cta","type":"button","sectionId":"implicit-column"}]}';

    @TestSetup
    static void setupData() {
        Map<String, Schema.RecordTypeInfo> types = Schema.SObjectType.Marketing_Dictionary__c.getRecordTypeInfosByDeveloperName();
        Marketing_Dictionary__c channel = new Marketing_Dictionary__c(Name = 'Email Main', RecordTypeId = types.get('Channel').getRecordTypeId(), Is_Active__c = true);
        Marketing_Dictionary__c locale = new Marketing_Dictionary__c(Name = 'pl_PL', RecordTypeId = types.get('Campaign').getRecordTypeId(), Dictionary_Sub_Type__c = 'Locale', Is_Active__c = true);
        insert new List<Marketing_Dictionary__c>{ channel, locale };
        String shell = '{"schemaVersion":"1.0","kind":"shell","templateMode":"multi","regions":[{"regionId":"b","kind":"blocks"}],"sections":[],"contentSlots":[]}';
        List<Channel_Template__c> templates = new List<Channel_Template__c>{
            new Channel_Template__c(Name = 'TEMP_A', Channel__c = channel.Id, Status__c = 'Draft', Definition_JSON__c = shell, Template_Slug__c = 'A',
                Locale__c = locale.Id, Template_Classification__c = 'Commercial', Shell_HTML__c = '<div data-cc-region="blocks"></div>'),
            new Channel_Template__c(Name = 'TEMP_B', Channel__c = channel.Id, Status__c = 'Draft', Definition_JSON__c = shell, Template_Slug__c = 'B',
                Locale__c = locale.Id, Template_Classification__c = 'Commercial', Shell_HTML__c = '<div data-cc-region="blocks"></div>')
        };
        insert templates;
        String blockHtml = '<a data-cc-content="button" data-cc-key="cta" href="#">Go</a>';
        insert new List<Channel_Template_Block__c>{
            new Channel_Template_Block__c(Name = 'Button block', Channel_Template__c = templates[0].Id, Status__c = 'Active', Definition_JSON__c = BLOCK_DEFINITION, Source_HTML__c = blockHtml, Content_Types__c = 'button'),
            new Channel_Template_Block__c(Name = 'Button block', Channel_Template__c = templates[1].Id, Status__c = 'Active', Definition_JSON__c = BLOCK_DEFINITION, Source_HTML__c = blockHtml, Content_Types__c = 'button;richText')
        };
        insert new CC_Message_Metadata__c(
            Name = 'EM-pl-PL-Spring-1', MessageName__c = 'EM-pl-PL-Spring', MessageVariantId__c = 'variant-1',
            Message_Variant_Id__c = 'variant-1', MessageVariant__c = 1, Version__c = 1, Channel_Type__c = 'Email',
            Status__c = 'Draft', Source_Template__c = templates[0].Id
        );
    }

    private static Id messageId() {
        return [SELECT Id FROM CC_Message_Metadata__c WHERE MessageVariantId__c = 'variant-1'].Id;
    }

    private static Id templateId(String name) {
        return [SELECT Id FROM Channel_Template__c WHERE Name = :name].Id;
    }

    private static Id blockDefinitionId(String templateName) {
        return [SELECT Id FROM Channel_Template_Block__c WHERE Channel_Template__r.Name = :templateName].Id;
    }

    private static String blocks(String label) {
        return JSON.serialize(new List<Object>{ new Map<String, Object>{
            'blockTemplateDefinitionId' => blockDefinitionId('TEMP_A'),
            'blockConfig' => new Map<String, Object>{
                'sectionId' => 'block',
                'rows' => new List<Object>{ new Map<String, Object>{
                    'sectionId' => 'row-1',
                    'columns' => new List<Object>{ new Map<String, Object>{
                        'sectionId' => 'row-1',
                        'content' => new List<Object>{ new Map<String, Object>{
                            'type' => 'button', 'bindingKey' => 'cta', 'visible' => true, 'label' => label,
                            'url' => 'https://example.com', 'targetType' => 'WebURL'
                        } }
                    } }
                } }
            }
        } });
    }

    private static CC_Message_Metadata__c reload() {
        return [
            SELECT Id, Status__c, IsActive__c, Is_Active__c, Published_At__c, Deactivated_At__c, CurrentMessageVariantVersionId__c,
                   CurrentMessageVariantVersionNumber__c, Draft_Version_Id__c, Source_Template__c, MessageVariantId__c,
                   Scheduled_Action__c, Scheduled_Status__c
            FROM CC_Message_Metadata__c WHERE Id = :messageId()
        ];
    }

    @IsTest
    static void statusRulesValidationAndDerivedFields() {
        Test.setMock(HttpCalloutMock.class, new MCE_HttpMockFactory());
        Id id = messageId();
        CcMessageContentService.saveMessageContent(id, blocks(''), null);
        Boolean invalidBlocked = false;
        try {
            CcMessageLifecycleService.changeStatus(id, 'Ready');
        } catch (AuraHandledException e) {
            invalidBlocked = e.getMessage().contains('Button label is required');
        }
        System.assert(invalidBlocked, 'Invalid content cannot be set to Ready.');

        CcMessageContentService.saveMessageContent(id, blocks('Open'), null);
        Boolean draftToLive = false;
        try {
            CcMessageLifecycleService.changeStatus(id, 'Live');
        } catch (AuraHandledException e) {
            draftToLive = e.getMessage().contains('must be set to Ready');
        }
        System.assert(draftToLive);

        Test.startTest();
        CcMessageLifecycleService.changeStatus(id, 'Ready');
        CcMessageLifecycleService.changeStatus(id, 'Live');
        Test.stopTest();
        CC_Message_Metadata__c live = reload();
        System.assertEquals('Live', live.Status__c);
        System.assertEquals(true, live.IsActive__c);
        System.assertEquals(true, live.Is_Active__c);
        System.assertNotEquals(null, live.Published_At__c);
        System.assertEquals('variant-1', live.MessageVariantId__c);

        CcMessageLifecycleService.changeStatus(id, 'Inactive');
        CC_Message_Metadata__c inactive = reload();
        System.assertEquals(false, inactive.IsActive__c);
        System.assertNotEquals(null, inactive.Deactivated_At__c);
        CcMessageLifecycleService.changeStatus(id, 'Archived');
        Boolean archivedLocked = false;
        try {
            CcMessageLifecycleService.changeStatus(id, 'Live');
        } catch (AuraHandledException e) {
            archivedLocked = e.getMessage().contains('cannot be reactivated');
        }
        System.assert(archivedLocked);

        update new CC_Message_Metadata__c(Id = id, Status__c = 'Published', MessageVariantId__c = 'variant-1', Message_Variant_Id__c = 'variant-1');
        System.assertEquals('Live', reload().Status__c, 'Legacy Published is normalized to Live.');
        System.assertEquals(true, CcMessageLifecycleService.isLive('Published'));
        System.assertEquals('Draft', CcMessageLifecycleService.normalizeStatus(null));
        System.assert(CcMessageLifecycleService.allowedTargets('Inactive').contains('Ready'));
    }

    @IsTest
    static void draftVersionsActivateIntoHistoryAndCanBeRestored() {
        Test.setMock(HttpCalloutMock.class, new MCE_HttpMockFactory());
        Id id = messageId();
        CcMessageContentService.MessageContent v1 = CcMessageContentService.saveMessageContent(id, blocks('First'), null);
        CcMessageLifecycleService.changeStatus(id, 'Ready');
        CcMessageLifecycleService.changeStatus(id, 'Live');

        Test.startTest();
        CcMessageContentService.MessageContent draft = CcMessageLifecycleService.createVariantVersion(id);
        System.assertEquals(true, draft.isDraftVersion);
        System.assertEquals(2, draft.versionNumber);
        System.assertEquals(1, draft.blocks.size());
        System.assertNotEquals(v1.blocks[0].messageBlockId, draft.blocks[0].messageBlockId);
        System.assertEquals(draft.versionId, CcMessageLifecycleService.createVariantVersion(id).versionId, 'An existing draft is reused.');
        CcMessageContentService.saveMessageContent(id, blocks('Second'), null);
        CcMessageLifecycleService.activateVariantVersion(id);
        Test.stopTest();

        CC_Message_Metadata__c message = reload();
        System.assertEquals(draft.versionId, message.CurrentMessageVariantVersionId__c);
        System.assertEquals(2, message.CurrentMessageVariantVersionNumber__c);
        System.assertEquals(null, message.Draft_Version_Id__c);
        System.assertEquals('Live', message.Status__c);
        System.assertEquals(1, [SELECT COUNT() FROM CC_Message_Blocks__c WHERE Message_Metadata__c = :id], 'The previous version rows are removed.');
        CC_Message_Blocks_All__c mirror = [SELECT ContentJson__c, CC_External_Key__c FROM CC_Message_Blocks_All__c WHERE MessageVariantId__c = 'variant-1'];
        System.assert(mirror.ContentJson__c.contains('Second'));
        System.assertEquals('variant-1#1', mirror.CC_External_Key__c);

        List<CcMessageLifecycleService.VersionSummary> history = CcMessageLifecycleService.getVersionHistory(id);
        System.assertEquals(1, history.size());
        System.assertEquals(true, history[0].isCurrent);

        CcMessageContentService.MessageContent restored = CcMessageLifecycleService.restoreVersion(id, draft.versionId);
        System.assertEquals(true, restored.isDraftVersion);
        System.assert(restored.blocks[0].contentJson.contains('Second'));
        CcMessageLifecycleService.discardVariantVersion(id);
        System.assertEquals(null, reload().Draft_Version_Id__c);
        Boolean noDraft = false;
        try {
            CcMessageLifecycleService.activateVariantVersion(id);
        } catch (AuraHandledException e) {
            noDraft = e.getMessage().contains('no draft version');
        }
        System.assert(noDraft);
    }

    @IsTest
    static void sourceTemplateChangeChecksCompatibility() {
        Test.setMock(HttpCalloutMock.class, new MCE_HttpMockFactory());
        Id id = messageId();
        CcMessageContentService.saveMessageContent(id, blocks('Open'), null);
        Boolean inactiveTemplate = !CcMessageLifecycleService.checkTemplateChange(id, templateId('TEMP_B')).compatible;
        System.assert(inactiveTemplate, 'Draft templates cannot be assigned.');
        Channel_Template__c target = new Channel_Template__c(Id = templateId('TEMP_B'), Status__c = 'Active');
        Test.startTest();
        update target;
        Test.stopTest();
        System.assertEquals('Draft', [SELECT Status__c FROM Channel_Template__c WHERE Name = 'TEMP_A'].Status__c);

        CcMessageLifecycleService.TemplateCompatibility result = CcMessageLifecycleService.changeSourceTemplate(id, target.Id);
        System.assertEquals(true, result.compatible);
        System.assertEquals(target.Id, reload().Source_Template__c);
        System.assertEquals(blockDefinitionId('TEMP_B'), [SELECT BlockTemplateDefinitionId__c FROM CC_Message_Blocks__c WHERE Message_Metadata__c = :id].BlockTemplateDefinitionId__c);
    }

    @IsTest
    static void incompatibleTemplateIsRejected() {
        Test.setMock(HttpCalloutMock.class, new MCE_HttpMockFactory());
        Id id = messageId();
        CcMessageContentService.saveMessageContent(id, blocks('Open'), null);
        update new CC_Message_Blocks__c(
            Id = [SELECT Id FROM CC_Message_Blocks__c WHERE Message_Metadata__c = :id].Id,
            BlockTemplateDefinitionName__c = 'Hero block'
        );
        Map<Id, CcMessageLifecycleService.TemplateCompatibility> results =
            CcMessageLifecycleService.checkTemplateChanges(new Set<Id>{ id }, templateId('TEMP_B'));
        System.assertEquals(false, results.get(id).compatible);
        Boolean blocked = false;
        try {
            CcMessageLifecycleService.changeSourceTemplate(id, templateId('TEMP_B'));
        } catch (AuraHandledException e) {
            blocked = e.getMessage().contains('not compatible');
        }
        System.assert(blocked);
    }

    @IsTest
    static void schedulesRunAndUpdateTheMessage() {
        Test.setMock(HttpCalloutMock.class, new MCE_HttpMockFactory());
        Id id = messageId();
        CcMessageContentService.saveMessageContent(id, blocks('Open'), null);
        Boolean draftBlocked = false;
        try {
            CcMessageLifecycleService.schedulePublication(id, 'Publish', Datetime.now().addDays(1), null);
        } catch (AuraHandledException e) {
            draftBlocked = e.getMessage().contains('Draft messages cannot be scheduled');
        }
        System.assert(draftBlocked);
        CcMessageLifecycleService.changeStatus(id, 'Ready');
        Boolean pastBlocked = false;
        try {
            CcMessageLifecycleService.schedulePublication(id, 'Publish', Datetime.now().addMinutes(-5), null);
        } catch (AuraHandledException e) {
            pastBlocked = e.getMessage().contains('in the future');
        }
        System.assert(pastBlocked);

        Id scheduleId = CcMessageLifecycleService.schedulePublication(id, 'Publish', Datetime.now().addDays(1), 'Launch');
        System.assertEquals('Scheduled for Activation', reload().Scheduled_Status__c);
        Boolean duplicate = false;
        try {
            CcMessageLifecycleService.schedulePublication(id, 'Publish', Datetime.now().addDays(2), null);
        } catch (AuraHandledException e) {
            duplicate = e.getMessage().contains('already has a pending');
        }
        System.assert(duplicate);

        update new CC_Message_Scheduled__c(Id = scheduleId, Run_At__c = Datetime.now().addMinutes(-1));
        Test.startTest();
        CcScheduledPublicationExecutor.Request request = new CcScheduledPublicationExecutor.Request();
        request.scheduleId = scheduleId;
        CcScheduledPublicationExecutor.run(new List<CcScheduledPublicationExecutor.Request>{ request });
        Test.stopTest();
        System.assertEquals('Done', [SELECT Status__c FROM CC_Message_Scheduled__c WHERE Id = :scheduleId].Status__c);
        CC_Message_Metadata__c live = reload();
        System.assertEquals('Live', live.Status__c);
        System.assertEquals('executed', live.Scheduled_Status__c);
        System.assertEquals(null, live.Scheduled_Action__c);

        Id unpublish = CcMessageLifecycleService.schedulePublication(id, 'Unpublish', Datetime.now().addDays(1), null);
        CcMessageLifecycleService.cancelSchedule(id);
        System.assertEquals('Cancelled', [SELECT Status__c FROM CC_Message_Scheduled__c WHERE Id = :unpublish].Status__c);

        Id failing = CcMessageLifecycleService.schedulePublication(id, 'Unpublish', Datetime.now().addDays(1), null);
        update new CC_Message_Scheduled__c(Id = failing, Run_At__c = Datetime.now().addMinutes(-1), Scheduled_Action__c = 'Publish Changes');
        CcMessageLifecycleService.executeSchedules(new List<Id>{ failing });
        System.assertEquals('Failed', [SELECT Status__c FROM CC_Message_Scheduled__c WHERE Id = :failing].Status__c);
    }

    @IsTest
    static void deleteGuardBlocksLiveScheduledAndCampaignMessages() {
        Test.setMock(HttpCalloutMock.class, new MCE_HttpMockFactory());
        Id id = messageId();
        CcMessageContentService.saveMessageContent(id, blocks('Open'), null);
        CcMessageLifecycleService.changeStatus(id, 'Ready');
        CcMessageLifecycleService.schedulePublication(id, 'Publish', Datetime.now().addDays(1), null);
        List<String> blockers = CcMessageLifecycleService.deleteBlockers(new Set<Id>{ id });
        System.assertEquals(1, blockers.size(), blockers);
        Boolean blocked = false;
        try {
            CopyCockpitController.deleteMessageVariants(new List<Id>{ id });
        } catch (AuraHandledException e) {
            blocked = e.getMessage().contains('cannot be deleted');
        }
        System.assert(blocked);

        CcMessageLifecycleService.cancelSchedule(id);
        Campaign campaign = new Campaign(Name = 'Spring', IsActive = true);
        insert campaign;
        insert new Campaign_Copy_Variant__c(Campaign__c = campaign.Id, Message_Variant__c = id);
        System.assert(String.join(CcMessageLifecycleService.deleteBlockers(new Set<Id>{ id }), ' ').contains('active campaign Spring'));

        delete [SELECT Id FROM Campaign_Copy_Variant__c];
        Test.startTest();
        CopyCockpitController.deleteMessageVariants(new List<Id>{ id });
        Test.stopTest();
        System.assertEquals(0, [SELECT COUNT() FROM CC_Message_Metadata__c WHERE Id = :id]);
        System.assertEquals(0, [SELECT COUNT() FROM CC_Message_Blocks__c]);
        System.assertEquals(0, [SELECT COUNT() FROM CC_Message_Scheduled__c]);
    }

    @IsTest
    static void partialUpdatesKeepTheMceVariantKey() {
        Test.setMock(HttpCalloutMock.class, new MCE_HttpMockFactory());
        Id id = messageId();
        Test.startTest();
        CopyCockpitModificationService.updateMetadata(new CC_Message_Metadata__c(Id = id, Subject__c = 'Changed'));
        Test.stopTest();
        System.assertEquals('variant-1', reload().MessageVariantId__c);
    }

    @IsTest
    static void cloneCopiesContentAndLegacyRefreshFollowsTheMirror() {
        Test.setMock(HttpCalloutMock.class, new MCE_HttpMockFactory());
        Id id = messageId();
        CcMessageContentService.saveMessageContent(id, blocks('Open'), '{"bannerType":"main"}');
        Test.startTest();
        Id copyId = CopyCockpitController.cloneMessage(id, 2, null);
        Test.stopTest();
        CC_Message_Metadata__c copy = [SELECT Name, CurrentMessageVariantVersionId__c, Message_Settings_JSON__c, MessageVariantId__c FROM CC_Message_Metadata__c WHERE Id = :copyId];
        System.assertEquals('EM-pl-PL-Spring-2', copy.Name, 'Variant suffix uses the hyphen convention of the stem.');
        System.assertEquals('{"bannerType":"main"}', copy.Message_Settings_JSON__c);
        List<CC_Message_Blocks__c> copied = [SELECT MessageVariantVersionId__c, MessageVariantId__c, ContentJson__c FROM CC_Message_Blocks__c WHERE Message_Metadata__c = :copyId];
        System.assertEquals(1, copied.size());
        System.assertEquals(copy.CurrentMessageVariantVersionId__c, copied[0].MessageVariantVersionId__c);
        System.assertEquals(copy.MessageVariantId__c, copied[0].MessageVariantId__c);
        System.assertEquals(1, [SELECT COUNT() FROM CC_Message_History__c WHERE Message_Metadata__c = :copyId AND Action__c = 'Created']);

        CC_Message_Metadata__c legacy = new CC_Message_Metadata__c(Name = 'SMS-pl-PL-Hi-1', MessageName__c = 'SMS-pl-PL-Hi', MessageVariantId__c = 'legacy-1', Message_Variant_Id__c = 'legacy-1', MessageVariant__c = 1);
        insert legacy;
        insert new CC_Message_Blocks_All__c(MessageVariantId__c = 'legacy-1', ContentBlockOrder__c = 1, BlockType__c = 'SMSBody', ContentJson__c = '{"type":"SMSBody","text":"Hi"}');
        CcMessageLifecycleService.refreshLegacyAuthoring(new Set<String>{ 'legacy-1', 'variant-1' });
        CC_Message_Blocks__c migrated = [SELECT ContentJson__c FROM CC_Message_Blocks__c WHERE Message_Metadata__c = :legacy.Id];
        System.assert(migrated.ContentJson__c.contains('"legacy"'));
        System.assertEquals('{"type":"SMSBody","text":"Hi"}', CcMessageLifecycleService.mcePayload(migrated.ContentJson__c));
        System.assertEquals(1, [SELECT COUNT() FROM CC_Message_Blocks__c WHERE Message_Metadata__c = :id], 'Core-authored content is not replaced.');
    }
}
