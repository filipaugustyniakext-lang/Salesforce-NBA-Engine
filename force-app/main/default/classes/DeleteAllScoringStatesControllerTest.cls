@IsTest
private class DeleteAllScoringStatesControllerTest {
    private static void seedScoring() {
        Id productRt = Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Product').getRecordTypeId();
        Id campaignRt = Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Campaign').getRecordTypeId();
        Marketing_Dictionary__c pf = new Marketing_Dictionary__c(
            Name = 'PF Test', RecordTypeId = productRt, Dictionary_Sub_Type__c = 'Product Family', Is_Active__c = true
        );
        Marketing_Dictionary__c topic = new Marketing_Dictionary__c(
            Name = 'Topic Test', RecordTypeId = campaignRt, Dictionary_Sub_Type__c = 'Topic', Is_Active__c = true
        );
        insert new List<Marketing_Dictionary__c>{ pf, topic };

        Campaign_Scoring_State__c state = new Campaign_Scoring_State__c(
            Name = 'APR_PF Test_Topic Test',
            Scoring_Key__c = 'APR_' + pf.Id + '_' + topic.Id,
            Scoring_Type__c = 'APR',
            Score_Id__c = 1,
            Product_Family_Dict__c = pf.Id,
            Topic_Dict__c = topic.Id,
            Apriori_Score__c = 300
        );
        insert state;
        insert new Campaign_Scoring_History__c(
            Name = state.Name,
            Scoring_Key__c = state.Scoring_Key__c,
            Scoring_Type__c = 'APR',
            Score_Id__c = 1,
            Scoring_State__c = state.Id,
            Product_Family_Dict__c = pf.Id,
            Topic_Dict__c = topic.Id,
            Apriori_Score__c = 300,
            Version_Number__c = 1,
            Start_Date_Time__c = System.now()
        );
    }

    private static DeleteAllScoringStatesController controller() {
        return new DeleteAllScoringStatesController(
            new ApexPages.StandardSetController(Database.getQueryLocator([SELECT Id FROM Campaign_Scoring_State__c]))
        );
    }

    @IsTest
    static void deleteAllRemovesStatesAndHistory() {
        seedScoring();
        DeleteAllScoringStatesController ctrl = controller();
        System.assertEquals(1, ctrl.getStateCount());
        System.assertEquals(1, ctrl.getHistoryCount());
        System.assertEquals(true, ctrl.getCanDelete());

        ctrl.deleteAll();

        System.assertEquals(0, [SELECT COUNT() FROM Campaign_Scoring_State__c]);
        System.assertEquals(0, [SELECT COUNT() FROM Campaign_Scoring_History__c]);
    }

    @IsTest
    static void batchDeletesHistoryThenStates() {
        seedScoring();
        Test.startTest();
        Database.executeBatch(new ScoringDataDeleteBatch('Campaign_Scoring_History__c'), 200);
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Campaign_Scoring_History__c]);
        System.assertEquals(0, [SELECT COUNT() FROM Campaign_Scoring_State__c]);
    }

    @IsTest
    static void cancelReturnsToList() {
        System.assertNotEquals(null, controller().cancel());
    }
}
