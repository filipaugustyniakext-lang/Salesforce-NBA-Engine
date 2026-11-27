@IsTest
private class CampaignScoringServiceTest {
    @TestSetup
    static void setupDictionary() {
        Id productRt = Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Product').getRecordTypeId();
        Id campaignRt = Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Campaign').getRecordTypeId();

        insert new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(
                Name = 'PF Test', RecordTypeId = productRt, Dictionary_Sub_Type__c = 'Product Family', Is_Active__c = true
            ),
            new Marketing_Dictionary__c(
                Name = 'PF Other', RecordTypeId = productRt, Dictionary_Sub_Type__c = 'Product Family', Is_Active__c = true
            ),
            new Marketing_Dictionary__c(
                Name = 'Topic Test', RecordTypeId = campaignRt, Dictionary_Sub_Type__c = 'Topic', Is_Active__c = true
            )
        };
    }

    private static Marketing_Dictionary__c pf(String name) {
        return [SELECT Id FROM Marketing_Dictionary__c WHERE Name = :name AND Dictionary_Sub_Type__c = 'Product Family' LIMIT 1];
    }

    private static Marketing_Dictionary__c topic() {
        return [SELECT Id FROM Marketing_Dictionary__c WHERE Dictionary_Sub_Type__c = 'Topic' LIMIT 1];
    }

    private static Campaign aprioriCampaign(Decimal score, Boolean active) {
        Campaign camp = new Campaign(
            Name = 'Apriori Source',
            Status = active ? 'Active' : 'Planned',
            IsActive = active,
            Scoring_Method__c = 'A-priori',
            Overall_Score__c = score,
            Topic_Dict__c = topic().Id,
            Product_Family_Ids__c = pf('PF Test').Id + '; ' + pf('PF Other').Id
        );
        insert camp;
        return camp;
    }

    private static Marketing_Dictionary__c modelDefinition(Boolean active) {
        Id campaignRt = Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Campaign').getRecordTypeId();
        Marketing_Dictionary__c model = new Marketing_Dictionary__c(
            Name = 'Model A',
            RecordTypeId = campaignRt,
            Dictionary_Sub_Type__c = 'Scoring Model',
            Is_Active__c = active,
            Model_Id__c = '7',
            Offering_Type__c = 'Product Family',
            Assigned_Topic_Dict__c = topic().Id,
            Product_Family__c = String.valueOf(pf('PF Test').Id)
        );
        insert model;
        return model;
    }

    private static Scoring_Model_Setting__c modelSetting(Id modelId, Decimal factor) {
        Scoring_Model_Setting__c setting = new Scoring_Model_Setting__c(
            Name = 'Model A',
            Scoring_Model__c = modelId,
            Model_Definition_Key__c = String.valueOf(modelId),
            Base_Score_Formula__c = 'base__c * ' + factor,
            Calibrated_Score_Formula__c = 'calibrated__c',
            Data360_DMO__c = 'Sample_ScoringModels__dlm',
            Source_Model_Id_Column__c = 'source_model_id__c',
            Model_Source__c = 'GCP',
            Base_Score_Column__c = 'base__c',
            Base_Score_Formula_Mode__c = 'Multiply',
            Base_Score_Factor__c = factor,
            Calibrated_Base_Score_Column__c = 'calibrated__c',
            Calibrated_Score_Formula_Mode__c = 'AsIs',
            Model_From_Date__c = Date.today(),
            Model_To_Date__c = Date.today().addDays(30)
        );
        insert setting;
        return setting;
    }

    @IsTest
    static void getAprioriContextIsEmptyWithoutState() {
        CampaignScoringService.AprioriContextResult ctx =
            CampaignScoringService.getAprioriContext(topic().Id, new List<Id>{ pf('PF Test').Id });
        System.assertEquals(false, ctx.hasExistingState);
        System.assertEquals(null, ctx.suggestedScore);
    }

    @IsTest
    static void draftCampaignDoesNotPublishButActivationDoes() {
        Campaign camp = aprioriCampaign(250, false);
        System.assertEquals(0, [SELECT COUNT() FROM Campaign_Scoring_State__c], 'Draft must not go live');

        camp.IsActive = true;
        camp.Status = 'Active';
        update camp;

        List<Campaign_Scoring_State__c> states = [
            SELECT Name, Scoring_Type__c, Score_Id__c, Apriori_Score__c, Activated_By__c,
                   Last_Modified_By_Campaign__c, Last_Modified_By_Campaign_Name__c, Scoring_Key__c, Status__c
            FROM Campaign_Scoring_State__c
            ORDER BY Name
        ];
        System.assertEquals(2, states.size());
        System.assertEquals('APR_PF Other_Topic Test', states[0].Name);
        System.assertEquals('APR', states[0].Scoring_Type__c);
        System.assertEquals(250, states[0].Apriori_Score__c);
        System.assertEquals(UserInfo.getUserId(), states[0].Activated_By__c);
        System.assertEquals(camp.Id, states[0].Last_Modified_By_Campaign__c);
        System.assertEquals('Apriori Source', states[0].Last_Modified_By_Campaign_Name__c);
        System.assertNotEquals(states[0].Score_Id__c, states[1].Score_Id__c, 'Different pairs get different Score IDs');

        for (Campaign_Scoring_State__c state : states) {
            System.assertEquals('Active', state.Status__c);
        }

        List<Campaign_Scoring_History__c> history = [
            SELECT Name, Version_Number__c, End_Date_Time__c, Scoring_State__c, Status__c
            FROM Campaign_Scoring_History__c
        ];
        System.assertEquals(2, history.size());
        for (Campaign_Scoring_History__c hist : history) {
            System.assertEquals(1, hist.Version_Number__c);
            System.assertEquals(null, hist.End_Date_Time__c);
            System.assertNotEquals(null, hist.Scoring_State__c);
            System.assertEquals('Active', hist.Status__c);
            System.assert(hist.Name.endsWith('_1'), hist.Name);
        }
    }

    @IsTest
    static void aprioriVersionsOnlyWhenScoreChanges() {
        aprioriCampaign(250, true);
        aprioriCampaign(250, true);
        System.assertEquals(2, [SELECT COUNT() FROM Campaign_Scoring_History__c], 'Same score must not create a version');

        aprioriCampaign(400, true);
        List<Campaign_Scoring_History__c> pfHistory = [
            SELECT Name, Version_Number__c, End_Date_Time__c, Apriori_Score__c
            FROM Campaign_Scoring_History__c
            WHERE Product_Family_Dict__c = :pf('PF Test').Id
            ORDER BY Version_Number__c
        ];
        System.assertEquals(2, pfHistory.size());
        System.assertEquals('APR_PF Test_Topic Test_1', pfHistory[0].Name);
        System.assertEquals('APR_PF Test_Topic Test_2', pfHistory[1].Name);
        System.assertEquals(250, pfHistory[0].Apriori_Score__c);
        System.assertNotEquals(null, pfHistory[0].End_Date_Time__c);
        System.assertEquals(400, pfHistory[1].Apriori_Score__c);
        System.assertEquals(null, pfHistory[1].End_Date_Time__c);
        System.assertEquals(2, pfHistory[1].Version_Number__c);
        System.assertEquals(2, [SELECT COUNT() FROM Campaign_Scoring_State__c], 'One state per pair and type');

        CampaignScoringService.AprioriContextResult ctx = CampaignScoringService.getAprioriContext(
            topic().Id, new List<Id>{ pf('PF Test').Id, pf('PF Other').Id }
        );
        System.assertEquals(400, ctx.suggestedScore);
        System.assertEquals(false, ctx.hasMixedScores);
    }

    @IsTest
    static void outOfRangeScoreIsIgnored() {
        aprioriCampaign(5000, true);
        System.assertEquals(0, [SELECT COUNT() FROM Campaign_Scoring_State__c]);
    }

    @IsTest
    static void modelSettingOfActiveModelPublishesMlStateSharingScoreId() {
        aprioriCampaign(250, true);
        Marketing_Dictionary__c model = modelDefinition(true);
        Scoring_Model_Setting__c setting = modelSetting(model.Id, 2);

        List<Campaign_Scoring_State__c> states = [
            SELECT Scoring_Type__c, Score_Id__c, Model_Definition__c, Model_Definition_Id__c,
                   Data_Source_Object_API_Name__c, Source_Model_Id__c, Model_Source__c, Apriori_Score__c, Name,
                   ML_Score_Definition_Setting__c, Status__c
            FROM Campaign_Scoring_State__c
            WHERE Product_Family_Dict__c = :pf('PF Test').Id
            ORDER BY Scoring_Type__c
        ];
        System.assertEquals(2, states.size(), 'APR and ML coexist for the same pair');
        System.assertEquals('APR', states[0].Scoring_Type__c);
        System.assertEquals('ML', states[1].Scoring_Type__c);
        System.assertEquals(states[0].Score_Id__c, states[1].Score_Id__c);
        System.assertEquals(model.Id, states[1].Model_Definition__c);
        System.assertEquals('7', states[1].Model_Definition_Id__c);
        System.assertEquals('Sample_ScoringModels__dlm', states[1].Data_Source_Object_API_Name__c);
        System.assertEquals('source_model_id__c', states[1].Source_Model_Id__c);
        System.assertEquals('GCP', states[1].Model_Source__c);
        System.assertEquals(null, states[1].Apriori_Score__c);
        System.assertEquals('ML_PF Test_Topic Test', states[1].Name);
        System.assertEquals(setting.Id, states[1].ML_Score_Definition_Setting__c);
        System.assertEquals('Active', states[1].Status__c);
        System.assertEquals(null, states[0].ML_Score_Definition_Setting__c);
    }

    @IsTest
    static void unchangedModelSettingKeepsVersionAndChangedSettingAddsOne() {
        Marketing_Dictionary__c model = modelDefinition(true);
        Scoring_Model_Setting__c setting = modelSetting(model.Id, 2);
        update setting;
        System.assertEquals(1, [SELECT COUNT() FROM Campaign_Scoring_History__c WHERE Scoring_Type__c = 'ML']);

        setting.Base_Score_Factor__c = 3;
        update setting;
        List<Campaign_Scoring_History__c> history = [
            SELECT Version_Number__c, End_Date_Time__c, Base_Score_Factor__c
            FROM Campaign_Scoring_History__c
            WHERE Scoring_Type__c = 'ML'
            ORDER BY Version_Number__c
        ];
        System.assertEquals(2, history.size());
        System.assertEquals(2, history[0].Base_Score_Factor__c);
        System.assertNotEquals(null, history[0].End_Date_Time__c);
        System.assertEquals(3, history[1].Base_Score_Factor__c);
        System.assertEquals(null, history[1].End_Date_Time__c);
        System.assertEquals(1, [SELECT COUNT() FROM Campaign_Scoring_State__c WHERE Scoring_Type__c = 'ML']);
    }

    @IsTest
    static void inactiveModelPublishesOnlyOnceActivated() {
        Marketing_Dictionary__c model = modelDefinition(false);
        modelSetting(model.Id, 2);
        System.assertEquals(0, [SELECT COUNT() FROM Campaign_Scoring_State__c]);

        model.Is_Active__c = true;
        update model;
        System.assertEquals(1, [SELECT COUNT() FROM Campaign_Scoring_State__c WHERE Scoring_Type__c = 'ML']);
        System.assertEquals(1, [SELECT COUNT() FROM Campaign_Scoring_History__c WHERE Scoring_Type__c = 'ML']);
    }

    @IsTest
    static void manualDeleteOfStateAndHistoryIsBlocked() {
        aprioriCampaign(250, true);
        Campaign_Scoring_State__c state = [SELECT Id FROM Campaign_Scoring_State__c LIMIT 1];
        Campaign_Scoring_History__c hist = [SELECT Id FROM Campaign_Scoring_History__c LIMIT 1];

        String stateMessage;
        try {
            delete state;
        } catch (DmlException e) {
            stateMessage = e.getMessage();
        }
        System.assertNotEquals(null, stateMessage, 'Manual delete of a State row must be blocked');
        System.assert(stateMessage.contains('Delete All Scoring Records'), stateMessage);

        String histMessage;
        try {
            delete hist;
        } catch (DmlException e) {
            histMessage = e.getMessage();
        }
        System.assertNotEquals(null, histMessage, 'Manual delete of a History row must be blocked');

        System.assertEquals(2, [SELECT COUNT() FROM Campaign_Scoring_State__c]);
        System.assertEquals(2, [SELECT COUNT() FROM Campaign_Scoring_History__c]);
    }

    @IsTest
    static void historyNameKeepsVersionWhenBaseNameIsLong() {
        Id productRt = Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Product').getRecordTypeId();
        Marketing_Dictionary__c longPf = new Marketing_Dictionary__c(
            Name = 'Long' + 'x'.repeat(76),
            RecordTypeId = productRt,
            Dictionary_Sub_Type__c = 'Product Family',
            Is_Active__c = true
        );
        insert longPf;
        Campaign camp = new Campaign(
            Name = 'Long Name Source',
            Status = 'Active',
            IsActive = true,
            Scoring_Method__c = 'A-priori',
            Overall_Score__c = 300,
            Topic_Dict__c = topic().Id,
            Product_Family_Ids__c = longPf.Id
        );
        insert camp;

        Campaign_Scoring_History__c hist = [SELECT Name FROM Campaign_Scoring_History__c WHERE Product_Family_Dict__c = :longPf.Id LIMIT 1];
        System.assertEquals(80, hist.Name.length());
        System.assert(hist.Name.endsWith('_1'), hist.Name);
    }
}
