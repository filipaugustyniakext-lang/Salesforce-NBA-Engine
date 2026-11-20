@IsTest
private class CcMessageContentServiceTest {
    private static final String BLOCK_DEFINITION = '{"schemaVersion":"1.0","kind":"block","templateMode":"single","regions":[],'
        + '"sections":[{"sectionId":"block","level":"container","binds":["padding"],"presets":{"colors":[],"gradients":[]}}],'
        + '"contentSlots":[{"bindingKey":"cta","type":"button","sectionId":"block"}]}';

    @TestSetup
    static void setupData() {
        Map<String, Schema.RecordTypeInfo> types = Schema.SObjectType.Marketing_Dictionary__c.getRecordTypeInfosByDeveloperName();
        Marketing_Dictionary__c channel = new Marketing_Dictionary__c(Name = 'Email Main', RecordTypeId = types.get('Channel').getRecordTypeId(), Is_Active__c = true);
        insert channel;
        Channel_Template__c template = new Channel_Template__c(
            Name = 'TEMP_pl_PL_Master_Commercial',
            Channel__c = channel.Id,
            Status__c = 'Draft',
            Definition_JSON__c = '{"schemaVersion":"1.0","kind":"shell","templateMode":"multi","regions":[{"regionId":"b","kind":"blocks"}],"sections":[],"contentSlots":[]}'
        );
        insert template;
        insert new Channel_Template_Block__c(
            Name = 'Button block',
            Channel_Template__c = template.Id,
            Status__c = 'Draft',
            Definition_JSON__c = BLOCK_DEFINITION,
            Content_Types__c = 'button',
            MCE_Asset_Id__c = '777'
        );
        insert new CC_Message_Metadata__c(
            Name = 'EM-pl-PL-Spring-1',
            MessageName__c = 'EM-pl-PL-Spring',
            MessageVariantId__c = 'variant-1',
            Message_Variant_Id__c = 'variant-1',
            MessageVariant__c = 1,
            Channel_Type__c = 'Email',
            Status__c = 'Draft',
            Source_Template__c = template.Id
        );
    }

    private static CC_Message_Metadata__c message() {
        return [SELECT Id, Status__c FROM CC_Message_Metadata__c LIMIT 1];
    }

    private static String blocksJson(String label, String messageBlockId) {
        Id definitionId = [SELECT Id FROM Channel_Template_Block__c LIMIT 1].Id;
        Map<String, Object> block = new Map<String, Object>{
            'messageBlockId' => messageBlockId,
            'blockTemplateDefinitionId' => definitionId,
            'blockConfig' => new Map<String, Object>{
                'sectionId' => 'block',
                'rows' => new List<Object>{ new Map<String, Object>{
                    'sectionId' => 'row-1',
                    'columns' => new List<Object>{ new Map<String, Object>{
                        'sectionId' => 'row-1',
                        'content' => new List<Object>{ new Map<String, Object>{
                            'type' => 'button', 'bindingKey' => 'cta', 'visible' => true,
                            'label' => label, 'url' => 'https://example.com', 'targetType' => 'WebURL'
                        } }
                    } }
                } }
            }
        };
        return JSON.serialize(new List<Object>{ block });
    }

    @IsTest
    static void savesBlocksForTheCurrentVersionAndReplacesStaleRows() {
        Test.setMock(HttpCalloutMock.class, new MCE_HttpMockFactory());
        Id messageId = message().Id;
        Test.startTest();
        CcMessageContentService.MessageContent first = CcMessageContentService.saveMessageContent(messageId, blocksJson('Open', null), '{"bannerType":"main"}');
        String firstBlockId = first.blocks[0].messageBlockId;
        CcMessageContentService.MessageContent second = CcMessageContentService.saveMessageContent(messageId, blocksJson('Open now', firstBlockId), null);
        Test.stopTest();

        System.assertNotEquals(null, first.versionId);
        System.assertEquals(1, first.versionNumber);
        System.assertEquals(first.versionId, second.versionId);
        System.assertEquals(firstBlockId, second.blocks[0].messageBlockId, 'Saving the same block keeps its id.');
        CC_Message_Blocks__c row = [
            SELECT BlockTemplateDefinitionName__c, ContentBuilderAssetId__c, ContentBlockOrder__c, MessageVariantId__c,
                   MessageVariantVersionId__c, BlockTemplateDefinitionContentTypes__c, ContentJson__c
            FROM CC_Message_Blocks__c
        ];
        System.assertEquals('Button block', row.BlockTemplateDefinitionName__c);
        System.assertEquals('777', row.ContentBuilderAssetId__c);
        System.assertEquals('variant-1', row.MessageVariantId__c);
        System.assertEquals(1, row.ContentBlockOrder__c);
        System.assert(row.ContentJson__c.contains('Open now'));
        CC_Message_Metadata__c saved = [
            SELECT CurrentMessageVariantVersionId__c, Block_Count__c, Message_Settings_JSON__c, MessageVariantId__c
            FROM CC_Message_Metadata__c WHERE Id = :messageId
        ];
        System.assertEquals(first.versionId, saved.CurrentMessageVariantVersionId__c);
        System.assertEquals(1, saved.Block_Count__c);
        System.assertEquals('{"bannerType":"main"}', saved.Message_Settings_JSON__c);
        System.assertEquals('variant-1', saved.MessageVariantId__c, 'Partial updates must keep the MCE variant id.');
        System.assertEquals(true, CcMessageContentService.validateVersion(messageId, first.versionId).valid);

        CcMessageContentService.MessageContent loaded = CcMessageContentService.getMessageContent(messageId);
        System.assertEquals(true, loaded.templateIsV1);
        System.assertEquals(1, loaded.blocks.size());
    }

    @IsTest
    static void rejectsEditsOfLiveMessagesAndForeignBlockIds() {
        Test.setMock(HttpCalloutMock.class, new MCE_HttpMockFactory());
        Id messageId = message().Id;
        CcMessageContentService.saveMessageContent(messageId, blocksJson('Open', null), null);
        String existingId = [SELECT MessageBlockId__c FROM CC_Message_Blocks__c LIMIT 1].MessageBlockId__c;

        CC_Message_Metadata__c other = new CC_Message_Metadata__c(
            Name = 'EM-pl-PL-Spring-2', MessageName__c = 'EM-pl-PL-Spring', MessageVariantId__c = 'variant-2',
            Message_Variant_Id__c = 'variant-2', MessageVariant__c = 2, Status__c = 'Draft'
        );
        insert other;
        Test.startTest();
        CcMessageContentService.MessageContent copied = CcMessageContentService.saveMessageContent(other.Id, blocksJson('Copy', existingId), null);
        Test.stopTest();
        System.assertNotEquals(existingId, copied.blocks[0].messageBlockId, 'A block id from another message is replaced.');
        System.assertEquals(2, [SELECT COUNT() FROM CC_Message_Blocks__c]);

        update new CC_Message_Metadata__c(Id = messageId, Status__c = 'Live', MessageVariantId__c = 'variant-1', Message_Variant_Id__c = 'variant-1');
        Boolean blocked = false;
        try {
            CcMessageContentService.saveMessageContent(messageId, blocksJson('Live edit', null), null);
        } catch (AuraHandledException e) {
            blocked = e.getMessage().contains('Create New Variant Version');
        }
        System.assert(blocked, 'Live messages are edited through a draft version.');
    }

    @IsTest
    static void validatesInputAndContent() {
        Id messageId = message().Id;
        Integer failures = 0;
        try { CcMessageContentService.getMessageContent(null); } catch (AuraHandledException e) { failures++; }
        try { CcMessageContentService.saveMessageContent(messageId, '{"not":"a list"}', null); } catch (AuraHandledException e) { failures++; }
        try { CcMessageContentService.saveMessageContent(messageId, '[1]', null); } catch (AuraHandledException e) { failures++; }
        try { CcMessageContentService.saveMessageContent(messageId, '[{"blockTemplateDefinitionId":"a0Y000000000001AAA"}]', null); } catch (Exception e) { failures++; }
        System.assertEquals(4, failures);

        Test.setMock(HttpCalloutMock.class, new MCE_HttpMockFactory());
        CcMessageContentService.MessageContent saved = CcMessageContentService.saveMessageContent(messageId, blocksJson('', null), null);
        CcTemplateValidator.Result result = CcMessageContentService.validateVersion(messageId, saved.versionId);
        System.assertEquals(false, result.valid);
        System.assert(String.join(result.errors, ' ').contains('Button label is required'));
        System.assertEquals(36, CcMessageContentService.newGuid().length());
    }
}
