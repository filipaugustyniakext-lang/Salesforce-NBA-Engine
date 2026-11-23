@IsTest
private class CcMessageBlocksMigrationBatchTest {
    @TestSetup
    static void setupData() {
        insert new List<CC_Message_Metadata__c>{
            new CC_Message_Metadata__c(Name = 'SMS-pl-PL-Hello-1', MessageName__c = 'SMS-pl-PL-Hello', MessageVariantId__c = 'v-sms', Message_Variant_Id__c = 'v-sms', MessageVariant__c = 1, Channel_Type__c = 'SMS'),
            new CC_Message_Metadata__c(Name = 'EM-pl-PL-Canvas-1', MessageName__c = 'EM-pl-PL-Canvas', MessageVariantId__c = 'v-canvas', Message_Variant_Id__c = 'v-canvas', MessageVariant__c = 1, Channel_Type__c = 'Email',
                Canvas_Blocks_JSON__c = '[{"blockType":"RichText","copy":"Hi"},{"blockType":"Image","imageUrl":"https://x/a.png"}]',
                CurrentMessageVariantVersionId__c = 'mce-version-1'),
            new CC_Message_Metadata__c(Name = 'NoVariant', MessageName__c = 'NoVariant')
        };
        insert new List<CC_Message_Blocks_All__c>{
            new CC_Message_Blocks_All__c(MessageVariantId__c = 'v-sms', ContentBlockOrder__c = 1, BlockType__c = 'SMSBody', ContentJson__c = '{"type":"SMSBody","text":"Hello"}', ContentBuilderAssetId__c = '55')
        };
        insert new CC_Message_Blocks__c(MessageVariantId__c = 'v-sms', ContentBlockOrder__c = 1, BlockType__c = 'SMSBody');
    }

    @IsTest
    static void migratesMirrorAndCanvasContentIdempotently() {
        Test.startTest();
        Database.executeBatch(new CcMessageBlocksMigrationBatch(true), 50);
        Test.stopTest();

        List<CC_Message_Blocks__c> smsRows = [
            SELECT MessageVariantVersionId__c, ContentJson__c, ContentBuilderAssetId__c, BlockType__c, Message_Metadata__c
            FROM CC_Message_Blocks__c WHERE MessageVariantId__c = 'v-sms'
        ];
        System.assertEquals(1, smsRows.size(), 'The unversioned pre-v1 row is replaced.');
        Map<String, Object> wrapped = (Map<String, Object>) JSON.deserializeUntyped(smsRows[0].ContentJson__c);
        System.assertEquals('1.0', wrapped.get('schemaVersion'));
        System.assertEquals('Hello', ((Map<String, Object>) wrapped.get('legacy')).get('text'));
        System.assertEquals('55', smsRows[0].ContentBuilderAssetId__c);

        CC_Message_Metadata__c sms = [SELECT CurrentMessageVariantVersionId__c, CurrentMessageVariantVersionNumber__c, Block_Count__c, MessageVariantId__c FROM CC_Message_Metadata__c WHERE MessageVariantId__c = 'v-sms'];
        System.assertEquals(smsRows[0].MessageVariantVersionId__c, sms.CurrentMessageVariantVersionId__c);
        System.assertEquals(1, sms.CurrentMessageVariantVersionNumber__c);
        System.assertEquals(1, sms.Block_Count__c);

        List<CC_Message_Blocks__c> canvasRows = [SELECT MessageVariantVersionId__c, BlockType__c FROM CC_Message_Blocks__c WHERE MessageVariantId__c = 'v-canvas' ORDER BY ContentBlockOrder__c];
        System.assertEquals(2, canvasRows.size());
        System.assertEquals('mce-version-1', canvasRows[0].MessageVariantVersionId__c, 'The MCE version id is reused.');
        System.assertEquals('Image', canvasRows[1].BlockType__c);
        System.assertEquals(3, [SELECT COUNT() FROM CC_Message_History__c WHERE Action__c = 'Migrated']);

        CcMessageBlocksMigrationBatch again = new CcMessageBlocksMigrationBatch(false);
        again.migrate([
            SELECT Id, Name, MessageName__c, MessageVariantId__c, Message_Variant_Id__c, MessageVariant__c, Version__c,
                   Channel_Type__c, Message_Type__c, Canvas_Blocks_JSON__c, CurrentMessageVariantVersionId__c,
                   Current_Message_Variant_Version_Id__c, CurrentMessageVariantVersionNumber__c, Block_Count__c
            FROM CC_Message_Metadata__c
        ]);
        System.assertEquals(0, again.migratedMessages);
        System.assertEquals(3, again.skippedMessages);
        System.assertEquals(3, [SELECT COUNT() FROM CC_Message_Blocks__c]);
    }
}
