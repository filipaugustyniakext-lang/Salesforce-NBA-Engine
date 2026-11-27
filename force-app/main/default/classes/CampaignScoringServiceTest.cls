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
            Data360_DMO__c = 'Sample_ScoringModels__dlm',
            Source_Model_Id_Column__c = 'source_model_id__c',
            Model_Source__c = 'GCP',
            Base_Score_Column__c = 'base__c',
            Base_Score_Formula_Mode__c = 'Multiply',
            Base_Score_Factor__c = factor,
            Base_Score_Formula__c = 'base__c * ' + factor,
            Calibrated_Base_Score_Column__c = 'calibrated__c',
            Calibrated_Score_Formula_Mode__c = 'AsIs',
            Calibrated_Score_Formula__c = 'calibrated__c',
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
            SELECT Name, Score_Id__c, Apriori_Score__c, Apriori_Status__c, Apriori_Live_Since__c,
                   Apriori_Last_Modified_By__c, Last_Modified_By_Campaign__c, Last_Modified_By_Campaign_Name__c,
                   Scoring_Key__c, ML_Status__c, Scoring_Sources__c, Combined_Status__c
            FROM Campaign_Scoring_State__c
            ORDER BY Name
        ];
        System.assertEquals(2, states.size());
        System.assertEquals('PF Other_Topic Test', states[0].Name);
        System.assertEquals(250, states[0].Apriori_Score__c);
        System.assertEquals('Active', states[0].Apriori_Status__c);
        System.assertNotEquals(null, states[0].Apriori_Live_Since__c);
        System.assertEquals(UserInfo.getUserId(), states[0].Apriori_Last_Modified_By__c);
        System.assertEquals(camp.Id, states[0].Last_Modified_By_Campaign__c);
        System.assertEquals('Apriori Source', states[0].Last_Modified_By_Campaign_Name__c);
        System.assertEquals(null, states[0].ML_Status__c);
        System.assertEquals('APR', states[0].Scoring_Sources__c);
        System.assertEquals('Active', states[0].Combined_Status__c);
        System.assertNotEquals(states[0].Score_Id__c, states[1].Score_Id__c, 'Different pairs get different Score IDs');

        List<Campaign_Scoring_History__c> history = [
            SELECT Name, Version_Number__c, End_Date_Time__c, Scoring_State__c, Changed_Source__c, Apriori_Status__c
            FROM Campaign_Scoring_History__c
        ];
        System.assertEquals(2, history.size());
        for (Campaign_Scoring_History__c hist : history) {
            System.assertEquals(1, hist.Version_Number__c);
            System.assertEquals(null, hist.End_Date_Time__c);
            System.assertNotEquals(null, hist.Scoring_State__c);
            System.assertEquals('Apriori', hist.Changed_Source__c);
            System.assertEquals('Active', hist.Apriori_Status__c);
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
        System.assertEquals('PF Test_Topic Test_1', pfHistory[0].Name);
        System.assertEquals('PF Test_Topic Test_2', pfHistory[1].Name);
        System.assertEquals(250, pfHistory[0].Apriori_Score__c);
        System.assertNotEquals(null, pfHistory[0].End_Date_Time__c);
        System.assertEquals(400, pfHistory[1].Apriori_Score__c);
        System.assertEquals(null, pfHistory[1].End_Date_Time__c);
        System.assertEquals(2, [SELECT COUNT() FROM Campaign_Scoring_State__c], 'One state per pair');

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
    static void mlSourceJoinsTheSameRecordAsApriori() {
        aprioriCampaign(250, true);
        Marketing_Dictionary__c model = modelDefinition(true);
        Scoring_Model_Setting__c setting = modelSetting(model.Id, 2);

        List<Campaign_Scoring_State__c> states = [
            SELECT Name, Score_Id__c, Apriori_Score__c, Apriori_Status__c, ML_Status__c, ML_Status_Description__c,
                   ML_Live_Since__c, ML_Last_Modified_By__c, Model_Definition__c, Model_Definition_Id__c,
                   Data_Source_Object_API_Name__c, Source_Model_Id__c, Model_Source__c,
                   ML_Score_Definition_Setting__c, Scoring_Sources__c
            FROM Campaign_Scoring_State__c
            WHERE Product_Family_Dict__c = :pf('PF Test').Id
        ];
        System.assertEquals(1, states.size(), 'APR and ML share one record per pair');
        Campaign_Scoring_State__c state = states[0];
        System.assertEquals('PF Test_Topic Test', state.Name);
        System.assertEquals('APR + ML', state.Scoring_Sources__c);
        System.assertEquals(250, state.Apriori_Score__c, 'Apriori side is untouched by the ML publish');
        System.assertEquals('Active', state.Apriori_Status__c);
        System.assertEquals('Active', state.ML_Status__c);
        System.assertEquals(null, state.ML_Status_Description__c);
        System.assertNotEquals(null, state.ML_Live_Since__c);
        System.assertEquals(UserInfo.getUserId(), state.ML_Last_Modified_By__c);
        System.assertEquals(model.Id, state.Model_Definition__c);
        System.assertEquals('7', state.Model_Definition_Id__c);
        System.assertEquals('Sample_ScoringModels__dlm', state.Data_Source_Object_API_Name__c);
        System.assertEquals('source_model_id__c', state.Source_Model_Id__c);
        System.assertEquals('GCP', state.Model_Source__c);
        System.assertEquals(setting.Id, state.ML_Score_Definition_Setting__c);

        List<Campaign_Scoring_History__c> history = [
            SELECT Name, Version_Number__c, End_Date_Time__c, Changed_Source__c, Apriori_Score__c, ML_Status__c,
                   Base_Score_Column__c
            FROM Campaign_Scoring_History__c
            WHERE Product_Family_Dict__c = :pf('PF Test').Id
            ORDER BY Version_Number__c
        ];
        System.assertEquals(2, history.size());
        System.assertEquals('Apriori', history[0].Changed_Source__c);
        System.assertNotEquals(null, history[0].End_Date_Time__c);
        System.assertEquals('ML', history[1].Changed_Source__c);
        System.assertEquals('PF Test_Topic Test_2', history[1].Name);
        System.assertEquals(null, history[1].End_Date_Time__c);
        System.assertEquals(250, history[1].Apriori_Score__c, 'Snapshot holds both sources');
        System.assertEquals('Active', history[1].ML_Status__c);
        System.assertEquals('base__c', history[1].Base_Score_Column__c);
    }

    @IsTest
    static void aprioriChangeKeepsTheMlPictureInTheSnapshot() {
        aprioriCampaign(250, true);
        Marketing_Dictionary__c model = modelDefinition(true);
        modelSetting(model.Id, 2);
        aprioriCampaign(400, true);

        List<Campaign_Scoring_History__c> history = [
            SELECT Version_Number__c, End_Date_Time__c, Changed_Source__c, Apriori_Score__c, ML_Status__c,
                   Base_Score_Column__c, Base_Score_Factor__c
            FROM Campaign_Scoring_History__c
            WHERE Product_Family_Dict__c = :pf('PF Test').Id
            ORDER BY Version_Number__c
        ];
        System.assertEquals(3, history.size());
        Campaign_Scoring_History__c latest = history[2];
        System.assertEquals('Apriori', latest.Changed_Source__c);
        System.assertEquals(400, latest.Apriori_Score__c);
        System.assertEquals('Active', latest.ML_Status__c, 'ML side is carried into the new snapshot');
        System.assertEquals('base__c', latest.Base_Score_Column__c);
        System.assertEquals(2, latest.Base_Score_Factor__c);
        System.assertEquals(null, latest.End_Date_Time__c);
        System.assertEquals(1, [SELECT COUNT() FROM Campaign_Scoring_History__c
                                WHERE Product_Family_Dict__c = :pf('PF Test').Id AND End_Date_Time__c = NULL]);
    }

    @IsTest
    static void unchangedModelSettingKeepsVersionAndChangedSettingAddsOne() {
        Marketing_Dictionary__c model = modelDefinition(true);
        Scoring_Model_Setting__c setting = modelSetting(model.Id, 2);
        update setting;
        System.assertEquals(1, [SELECT COUNT() FROM Campaign_Scoring_History__c WHERE ML_Status__c = 'Active']);

        setting.Base_Score_Factor__c = 3;
        update setting;
        List<Campaign_Scoring_History__c> history = [
            SELECT Version_Number__c, End_Date_Time__c, Base_Score_Factor__c, Changed_Source__c
            FROM Campaign_Scoring_History__c
            ORDER BY Version_Number__c
        ];
        System.assertEquals(2, history.size());
        System.assertEquals(2, history[0].Base_Score_Factor__c);
        System.assertNotEquals(null, history[0].End_Date_Time__c);
        System.assertEquals(3, history[1].Base_Score_Factor__c);
        System.assertEquals(null, history[1].End_Date_Time__c);
        System.assertEquals('ML', history[1].Changed_Source__c);
        System.assertEquals(1, [SELECT COUNT() FROM Campaign_Scoring_State__c WHERE ML_Status__c = 'Active']);
    }

    @IsTest
    static void inactiveModelPublishesOnlyOnceActivated() {
        Marketing_Dictionary__c model = modelDefinition(false);
        modelSetting(model.Id, 2);
        System.assertEquals(0, [SELECT COUNT() FROM Campaign_Scoring_State__c]);

        model.Is_Active__c = true;
        update model;
        System.assertEquals(1, [SELECT COUNT() FROM Campaign_Scoring_State__c WHERE ML_Status__c = 'Active']);
        System.assertEquals(1, [SELECT COUNT() FROM Campaign_Scoring_History__c WHERE ML_Status__c = 'Active']);
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
        Campaign_Scoring_State__c state = [SELECT Name FROM Campaign_Scoring_State__c WHERE Product_Family_Dict__c = :longPf.Id LIMIT 1];
        System.assertEquals(80, state.Name.length());
    }
}
