@IsTest
private class CopyCockpitCloneTest {

    @IsTest
    static void cloneMessage_usesMasterStem_whenSourceNameIsExternalId() {
        CC_Message_Metadata__c source = new CC_Message_Metadata__c(
            Name = '03c4bf63-47c1-4533-8e16-0123456789ab',
            MessageName__c = 'BAN_PL_TEST',
            Channel_Type__c = 'Banner',
            Channel__c = 'Banner',
            Version__c = 1,
            Message_Variant__c = 'Variant 1',
            Status__c = 'Draft'
        );
        insert source;

        Test.startTest();
        Id cloneId = CopyCockpitController.cloneMessage(source.Id, 2, 'BAN_PL_TEST');
        Test.stopTest();

        CC_Message_Metadata__c clone = [
            SELECT Name, MessageName__c, Version__c, Message_Variant__c,
                   Message_Variant_Id__c, MessageVariantId__c
            FROM CC_Message_Metadata__c
            WHERE Id = :cloneId
        ];
        System.assertEquals('BAN_PL_TEST_2', clone.Name);
        System.assertEquals('BAN_PL_TEST', clone.MessageName__c);
        System.assertEquals(2, clone.Version__c.intValue());
        System.assertEquals('Variant 2', clone.Message_Variant__c);
        System.assertEquals(null, clone.Message_Variant_Id__c);
        System.assertEquals(null, clone.MessageVariantId__c);
    }
}
