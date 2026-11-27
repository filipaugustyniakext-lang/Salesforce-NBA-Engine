@IsTest
private class ScoringLifecycleTest {
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
                Name = 'Topic Test', RecordTypeId = campaignRt, Dictionary_Sub_Type__c = 'Topic', Is_Active__c = true
            )
        };
    }

    private static Marketing_Dictionary__c model(Date expiration) {
        Id campaignRt = Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Campaign').getRecordTypeId();
        Marketing_Dictionary__c definition = new Marketing_Dictionary__c(
            Name = 'Model A',
            RecordTypeId = campaignRt,
            Dictionary_Sub_Type__c = 'Scoring Model',
            Is_Active__c = true,
            Model_Id__c = '7',
            Offering_Type__c = 'Product Family',
            Assigned_Topic_Dict__c = [SELECT Id FROM Marketing_Dictionary__c WHERE Dictionary_Sub_Type__c = 'Topic' LIMIT 1].Id,
            Product_Family__c = String.valueOf([SELECT Id FROM Marketing_Dictionary__c WHERE Dictionary_Sub_Type__c = 'Product Family' LIMIT 1].Id),
            Model_Expiration_Date__c = expiration
        );
        insert definition;
        return definition;
    }

    private static Scoring_Model_Setting__c setting(Id modelId, String status, String dmo, Date fromDate, Date toDate) {
        Scoring_Model_Setting__c row = new Scoring_Model_Setting__c(
            Name = 'Model A',
            Scoring_Model__c = modelId,
            Model_Definition_Key__c = String.valueOf(modelId),
            Status__c = status,
            Data360_DMO__c = dmo,
            Source_Model_Id_Column__c = 'source_model_id__c',
            Model_Source__c = 'GCP',
            Base_Score_Column__c = 'base__c',
            Base_Score_Formula_Mode__c = 'AsIs',
            Base_Score_Formula__c = 'base__c',
            Calibrated_Base_Score_Column__c = 'calibrated__c',
            Calibrated_Score_Formula_Mode__c = 'AsIs',
            Calibrated_Score_Formula__c = 'calibrated__c',
            Model_From_Date__c = fromDate,
            Model_To_Date__c = toDate
        );
        insert row;
        return row;
    }

    private static Scoring_Model_Setting__c reload(Id id) {
        return [SELECT Status__c, Activated_On__c, Historized_On__c FROM Scoring_Model_Setting__c WHERE Id = :id];
    }

    private static Campaign_Scoring_State__c state() {
        return [
            SELECT ML_Status__c, ML_Status_Description__c, ML_Score_Definition_Setting__c, Data_Source_Object_API_Name__c
            FROM Campaign_Scoring_State__c
            LIMIT 1
        ];
    }

    @IsTest
    static void manualActivationHistorizesThePreviousLiveSetting() {
        Marketing_Dictionary__c definition = model(null);
        Scoring_Model_Setting__c first = setting(definition.Id, 'Active', 'First__dlm', Date.today(), Date.today().addDays(30));
        System.assertEquals('Active', reload(first.Id).Status__c);
        System.assertNotEquals(null, reload(first.Id).Activated_On__c);

        Scoring_Model_Setting__c second = setting(definition.Id, 'Draft', 'Second__dlm', Date.today(), Date.today().addDays(30));
        System.assertEquals('Draft', reload(second.Id).Status__c);
        System.assertEquals(first.Id, state().ML_Score_Definition_Setting__c, 'A draft does not replace the live setting');

        ScoringModelSettingService.activateSetting(second.Id);

        System.assertEquals('Historized', reload(first.Id).Status__c);
        System.assertNotEquals(null, reload(first.Id).Historized_On__c);
        System.assertEquals('Active', reload(second.Id).Status__c);
        Campaign_Scoring_State__c current = state();
        System.assertEquals(second.Id, current.ML_Score_Definition_Setting__c);
        System.assertEquals('Second__dlm', current.Data_Source_Object_API_Name__c);

        List<Campaign_Scoring_History__c> history = [
            SELECT Version_Number__c, End_Date_Time__c, Data_Source_Object_API_Name__c, ML_Score_Definition_Setting__c
            FROM Campaign_Scoring_History__c
            ORDER BY Version_Number__c
        ];
        System.assertEquals(2, history.size(), 'The replaced setting stays in History');
        System.assertEquals('First__dlm', history[0].Data_Source_Object_API_Name__c);
        System.assertEquals(first.Id, history[0].ML_Score_Definition_Setting__c);
        System.assertNotEquals(null, history[0].End_Date_Time__c);
        System.assertEquals('Second__dlm', history[1].Data_Source_Object_API_Name__c);
        System.assertEquals(null, history[1].End_Date_Time__c);
    }

    @IsTest
    static void aFutureFromDateSchedulesTheSettingAndTheJobActivatesItWhenDue() {
        Marketing_Dictionary__c definition = model(null);
        Scoring_Model_Setting__c live = setting(definition.Id, 'Active', 'Live__dlm', Date.today(), Date.today().addDays(60));
        Scoring_Model_Setting__c later = setting(definition.Id, 'Active', 'Later__dlm', Date.today().addDays(10), Date.today().addDays(60));

        System.assertEquals('Scheduled', reload(later.Id).Status__c, 'Active with a future From Date is scheduled');
        System.assertEquals('Active', reload(live.Id).Status__c, 'The live setting stays live until the schedule is due');
        System.assertEquals(live.Id, state().ML_Score_Definition_Setting__c);

        ScoringLifecycleJob.Summary early = ScoringLifecycleJob.runLifecycle(Date.today().addDays(9));
        System.assertEquals(0, early.settingsActivated);

        ScoringLifecycleJob.Summary due = ScoringLifecycleJob.runLifecycle(Date.today().addDays(10));
        System.assertEquals(1, due.settingsActivated);
        System.assertEquals('Active', reload(later.Id).Status__c);
        System.assertEquals('Historized', reload(live.Id).Status__c);
        System.assertEquals(later.Id, state().ML_Score_Definition_Setting__c);
        System.assertEquals(2, [SELECT COUNT() FROM Campaign_Scoring_History__c]);
    }

    @IsTest
    static void aSettingPastItsToDateIsHistorizedAndThePairGoesInactive() {
        Marketing_Dictionary__c definition = model(null);
        Scoring_Model_Setting__c live = setting(definition.Id, 'Active', 'Live__dlm', Date.today(), Date.today().addDays(5));

        ScoringLifecycleJob.runLifecycle(Date.today().addDays(5));
        System.assertEquals('Active', reload(live.Id).Status__c, 'The To Date itself is still inside the window');

        ScoringLifecycleJob.Summary summary = ScoringLifecycleJob.runLifecycle(Date.today().addDays(6));
        System.assertEquals(1, summary.settingsHistorized);
        System.assertEquals('Historized', reload(live.Id).Status__c);

        Campaign_Scoring_State__c current = state();
        System.assertEquals('Inactive', current.ML_Status__c);
        System.assertEquals(CampaignScoringService.NO_LIVE_SETTING_DESCRIPTION, current.ML_Status_Description__c);
        System.assertEquals(null, current.ML_Score_Definition_Setting__c);
        System.assertEquals('Live__dlm', current.Data_Source_Object_API_Name__c, 'Last values stay for reference');

        Campaign_Scoring_History__c latest = [
            SELECT ML_Status__c, End_Date_Time__c FROM Campaign_Scoring_History__c ORDER BY Version_Number__c DESC LIMIT 1
        ];
        System.assertEquals('Inactive', latest.ML_Status__c);
        System.assertEquals(null, latest.End_Date_Time__c);
    }

    @IsTest
    static void aDefinitionPastItsExpirationDateIsDeactivatedWithItsLiveSetting() {
        Marketing_Dictionary__c definition = model(Date.today().addDays(3));
        Scoring_Model_Setting__c live = setting(definition.Id, 'Active', 'Live__dlm', Date.today(), Date.today().addDays(60));

        System.assertEquals(0, ScoringLifecycleJob.runLifecycle(Date.today().addDays(2)).definitionsExpired);

        ScoringLifecycleJob.Summary summary = ScoringLifecycleJob.runLifecycle(Date.today().addDays(3));
        System.assertEquals(1, summary.definitionsExpired);
        System.assertEquals(false, [SELECT Is_Active__c FROM Marketing_Dictionary__c WHERE Id = :definition.Id].Is_Active__c);
        System.assertEquals('Historized', reload(live.Id).Status__c);
        Campaign_Scoring_State__c current = state();
        System.assertEquals('Inactive', current.ML_Status__c);
        System.assertEquals('Model definition is not active.', current.ML_Status_Description__c);
    }

    @IsTest
    static void deactivatingTheLiveSettingMakesThePairInactiveAndASchedulePreviousDraft() {
        Marketing_Dictionary__c definition = model(null);
        Scoring_Model_Setting__c live = setting(definition.Id, 'Active', 'Live__dlm', Date.today(), Date.today().addDays(30));
        Scoring_Model_Setting__c scheduled = setting(definition.Id, 'Active', 'Later__dlm', Date.today().addDays(5), Date.today().addDays(30));

        ScoringModelSettingService.deactivateSetting(scheduled.Id);
        System.assertEquals('Draft', reload(scheduled.Id).Status__c, 'A schedule goes back to Draft');
        System.assertEquals('Active', reload(live.Id).Status__c);

        ScoringModelSettingService.deactivateSetting(live.Id);
        System.assertEquals('Historized', reload(live.Id).Status__c);
        System.assertEquals('Inactive', state().ML_Status__c);

        String message;
        try {
            ScoringModelSettingService.activateSetting(live.Id);
        } catch (AuraHandledException e) {
            message = e.getMessage();
        }
        System.assertNotEquals(null, message, 'A historized setting cannot be activated again');
    }

    @IsTest
    static void reactivatingTheDefinitionRepublishesItsStillLiveSetting() {
        Marketing_Dictionary__c definition = model(null);
        Scoring_Model_Setting__c live = setting(definition.Id, 'Active', 'Live__dlm', Date.today(), Date.today().addDays(30));

        definition.Is_Active__c = false;
        update definition;
        System.assertEquals('Inactive', state().ML_Status__c);

        definition.Is_Active__c = true;
        update definition;
        Campaign_Scoring_State__c current = state();
        System.assertEquals('Active', current.ML_Status__c);
        System.assertEquals(live.Id, current.ML_Score_Definition_Setting__c);
    }

    @IsTest
    static void fromDateAfterToDateIsRejected() {
        Marketing_Dictionary__c definition = model(null);
        String message;
        try {
            setting(definition.Id, 'Draft', 'Live__dlm', Date.today().addDays(5), Date.today());
        } catch (DmlException e) {
            message = e.getMessage();
        }
        System.assertNotEquals(null, message);
        System.assert(message.contains('From Date must be on or before'), message);
    }
}
