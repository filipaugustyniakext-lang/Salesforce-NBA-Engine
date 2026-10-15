@IsTest
private class CampaignScoringAprioriControllerTest {
    @TestSetup
    static void setupDictionary() {
        Id productRt = Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Product').getRecordTypeId();
        Id campaignRt = Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Campaign').getRecordTypeId();

        insert new Marketing_Dictionary__c(
            Name = 'PF Test',
            RecordTypeId = productRt,
            Dictionary_Sub_Type__c = 'Product Family',
            Is_Active__c = true
        );
        insert new Marketing_Dictionary__c(
            Name = 'Topic Test',
            RecordTypeId = campaignRt,
            Dictionary_Sub_Type__c = 'Topic',
            Is_Active__c = true
        );
    }

    @IsTest
    static void getAprioriContext_returnsEmptyWhenNoState() {
        Marketing_Dictionary__c pf = [
            SELECT Id FROM Marketing_Dictionary__c WHERE Dictionary_Sub_Type__c = 'Product Family' LIMIT 1
        ];
        Marketing_Dictionary__c topic = [
            SELECT Id FROM Marketing_Dictionary__c WHERE Dictionary_Sub_Type__c = 'Topic' LIMIT 1
        ];

        CampaignScoringAprioriController.AprioriContextResult ctx =
            CampaignScoringAprioriController.getAprioriContext(
                topic.Id,
                new List<Id>{ pf.Id }
            );

        System.assertEquals(false, ctx.hasExistingState);
        System.assertEquals(null, ctx.suggestedScore);
    }

    @IsTest
    static void publishAprioriScores_createsStateAndHistory() {
        Marketing_Dictionary__c pf = [
            SELECT Id FROM Marketing_Dictionary__c WHERE Dictionary_Sub_Type__c = 'Product Family' LIMIT 1
        ];
        Marketing_Dictionary__c topic = [
            SELECT Id FROM Marketing_Dictionary__c WHERE Dictionary_Sub_Type__c = 'Topic' LIMIT 1
        ];
        Campaign camp = new Campaign(Name = 'Apriori Source', Status = 'Planned', IsActive = false);
        insert camp;

        Test.startTest();
        CampaignScoringAprioriController.publishAprioriScores(
            topic.Id,
            new List<Id>{ pf.Id },
            250,
            camp.Id,
            camp.Name
        );
        CampaignScoringAprioriController.publishAprioriScores(
            topic.Id,
            new List<Id>{ pf.Id },
            400,
            camp.Id,
            camp.Name
        );
        Test.stopTest();

        Campaign_Scoring_Apriori_State__c state = [
            SELECT Apriori_Score__c, Last_Modified_Source_Campaign__c
            FROM Campaign_Scoring_Apriori_State__c
            LIMIT 1
        ];
        System.assertEquals(400, state.Apriori_Score__c);
        System.assertEquals(camp.Id, state.Last_Modified_Source_Campaign__c);

        List<Campaign_Scoring_Apriori_History__c> history = [
            SELECT Score_Value__c, End_Date_Time__c
            FROM Campaign_Scoring_Apriori_History__c
            ORDER BY Start_Date_Time__c ASC
        ];
        System.assert(history.size() >= 2, 'Expected history for initial and updated score');
        System.assertEquals(null, history[history.size() - 1].End_Date_Time__c);
    }
}
