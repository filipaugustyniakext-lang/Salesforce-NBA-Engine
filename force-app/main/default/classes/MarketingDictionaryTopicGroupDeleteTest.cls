@IsTest
private class MarketingDictionaryTopicGroupDeleteTest {

    private static Id campaignRt() {
        return Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Campaign').getRecordTypeId();
    }

    private static Marketing_Dictionary__c dict(String name, String subType) {
        return new Marketing_Dictionary__c(
            Name = name,
            RecordTypeId = campaignRt(),
            Dictionary_Sub_Type__c = subType
        );
    }

    @IsTest
    static void topicGroupWithTopicsCannotBeDeleted() {
        Marketing_Dictionary__c groupRecord = dict('Lending', 'Topic Group');
        insert groupRecord;
        insert new Marketing_Dictionary__c(
            Name = 'Cash Loan',
            RecordTypeId = campaignRt(),
            Dictionary_Sub_Type__c = 'Topic',
            Topic_Group_Dict__c = groupRecord.Id
        );

        Boolean blocked = false;
        String message;
        Test.startTest();
        try {
            MarketingDictionaryManagerController.deleteDictionaryRecord(groupRecord.Id);
        } catch (AuraHandledException e) {
            blocked = true;
            message = e.getMessage();
        }
        Test.stopTest();

        System.assertEquals(true, blocked, 'Delete should be rejected while a topic uses the group.');
        System.assert(message.contains('Please remove dependencies first'), message);
        System.assert(message.contains('Cash Loan'), message);
        System.assertEquals(1, [SELECT COUNT() FROM Marketing_Dictionary__c WHERE Id = :groupRecord.Id]);
        System.assertEquals(
            groupRecord.Id,
            [SELECT Topic_Group_Dict__c FROM Marketing_Dictionary__c WHERE Name = 'Cash Loan'].Topic_Group_Dict__c,
            'The topic should keep its topic group.'
        );
    }

    @IsTest
    static void unusedTopicGroupCanBeDeleted() {
        Marketing_Dictionary__c groupRecord = dict('Unused Group', 'Topic Group');
        insert groupRecord;

        Test.startTest();
        MarketingDictionaryManagerController.deleteDictionaryRecord(groupRecord.Id);
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Marketing_Dictionary__c WHERE Id = :groupRecord.Id]);
    }
}
