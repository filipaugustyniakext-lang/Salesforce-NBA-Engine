@IsTest
private class MarketingDictionaryScoringModelListTest {

    private static Id campaignRt() {
        return Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Campaign').getRecordTypeId();
    }

    @IsTest
    static void listsEveryModelDefinition() {
        Marketing_Dictionary__c topic = new Marketing_Dictionary__c(
            Name = 'Cash Loan Topic',
            RecordTypeId = campaignRt(),
            Dictionary_Sub_Type__c = 'Topic'
        );
        insert topic;

        Marketing_Dictionary__c withTopic = new Marketing_Dictionary__c(
            Name = 'Topic Model',
            RecordTypeId = campaignRt(),
            Dictionary_Sub_Type__c = 'Scoring Model',
            Is_Active__c = true,
            Assigned_Topic_Dict__c = topic.Id
        );
        Marketing_Dictionary__c unscoped = new Marketing_Dictionary__c(
            Name = 'Unscoped Model',
            RecordTypeId = campaignRt(),
            Dictionary_Sub_Type__c = 'Scoring Model',
            Is_Active__c = false
        );
        insert new List<Marketing_Dictionary__c>{ withTopic, unscoped };

        Test.startTest();
        List<Marketing_Dictionary__c> models = MarketingDictionaryController.getScoringModels();
        Test.stopTest();

        Set<Id> ids = new Map<Id, Marketing_Dictionary__c>(models).keySet();
        System.assert(ids.contains(withTopic.Id), 'A topic-specific model should be listed.');
        System.assert(ids.contains(unscoped.Id), 'A model with no topic should be listed.');
    }
}
