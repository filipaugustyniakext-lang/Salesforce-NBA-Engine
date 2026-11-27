/**
 * Maintains Campaign Scoring State (current snapshot) and Campaign Scoring History (versioned snapshots) per
 * Scoring Type (APR, ML), Product Family and Topic.
 *
 * APR rows are published when a campaign with an a-priori score is activated (CampaignScoringPublishTrigger).
 * ML rows are published when an active Scoring Model has a Model Setting (Scoring_Model_Setting__c and
 * Marketing_Dictionary__c triggers). An unchanged snapshot never creates a new version.
 */
public with sharing class CampaignScoringService {
    public static final String TYPE_APRIORI = 'APR';
    public static final String TYPE_ML = 'ML';

    private static final Decimal MIN_SCORE = 0;
    private static final Decimal MAX_SCORE = 1000;
    private static final Integer NAME_MAX_LENGTH = 80;

    public class AprioriContextResult {
        @AuraEnabled public Decimal suggestedScore;
        @AuraEnabled public Boolean hasExistingState;
        @AuraEnabled public Boolean hasMixedScores;
    }

    @TestVisible
    private class ScoreInput {
        String scoringType;
        Id productFamilyId;
        Id topicId;
        Decimal aprioriScore;
        Id campaignId;
        String campaignName;
        Id activatedBy;
        Marketing_Dictionary__c modelDefinition;
        Scoring_Model_Setting__c setting;

        String key() {
            return buildScoringKey(scoringType, productFamilyId, topicId);
        }
    }

    @AuraEnabled(cacheable=true)
    public static AprioriContextResult getAprioriContext(Id topicId, List<Id> productFamilyIds) {
        AprioriContextResult result = new AprioriContextResult();
        result.suggestedScore = null;
        result.hasExistingState = false;
        result.hasMixedScores = false;

        if (topicId == null || productFamilyIds == null || productFamilyIds.isEmpty()) {
            return result;
        }
        Set<Id> pfIds = new Set<Id>();
        for (Id pfId : productFamilyIds) {
            if (pfId != null) {
                pfIds.add(pfId);
            }
        }
        if (pfIds.isEmpty()) {
            return result;
        }

        List<Campaign_Scoring_State__c> states = [
            SELECT Apriori_Score__c
            FROM Campaign_Scoring_State__c
            WHERE Scoring_Type__c = :TYPE_APRIORI
            AND Topic_Dict__c = :topicId
            AND Product_Family_Dict__c IN :pfIds
        ];
        if (states.isEmpty()) {
            return result;
        }

        result.hasExistingState = true;
        Decimal firstScore = states[0].Apriori_Score__c;
        result.suggestedScore = firstScore;
        for (Campaign_Scoring_State__c state : states) {
            if (state.Apriori_Score__c != firstScore) {
                result.hasMixedScores = true;
                result.suggestedScore = null;
                break;
            }
        }
        return result;
    }

    /** Trigger entry point: campaigns that just became active publish their a-priori score. */
    public static void handleCampaignActivations(List<Campaign> newRows, Map<Id, Campaign> oldById) {
        List<Campaign> activated = new List<Campaign>();
        for (Campaign camp : newRows) {
            if (camp.IsActive != true) {
                continue;
            }
            Campaign previous = oldById == null ? null : oldById.get(camp.Id);
            if (previous == null || previous.IsActive != true) {
                activated.add(camp);
            }
        }
        if (!activated.isEmpty()) {
            publishAprioriForCampaigns(activated);
        }
    }

    /** Trigger entry point: saved Model Settings republish ML state for their (active) model definitions. */
    public static void handleModelSettings(List<Scoring_Model_Setting__c> settings) {
        Set<Id> modelIds = new Set<Id>();
        for (Scoring_Model_Setting__c setting : settings) {
            if (setting.Scoring_Model__c != null) {
                modelIds.add(setting.Scoring_Model__c);
            }
        }
        publishModels(modelIds);
    }

    /** Trigger entry point: a Scoring Model that is active (newly or after edits) republishes its ML state. */
    public static void handleModelDefinitions(List<Marketing_Dictionary__c> definitions) {
        Set<Id> modelIds = new Set<Id>();
        for (Marketing_Dictionary__c definition : definitions) {
            if (definition.Dictionary_Sub_Type__c == 'Scoring Model' && definition.Is_Active__c == true) {
                modelIds.add(definition.Id);
            }
        }
        publishModels(modelIds);
    }

    /**
     * Publishes the a-priori score of every given campaign that is a-priori scored and has a valid score,
     * a Topic, and at least one Product Family. Campaigns are expected to be activated by the caller.
     */
    public static void publishAprioriForCampaigns(List<Campaign> campaigns) {
        List<ScoreInput> inputs = new List<ScoreInput>();
        for (Campaign camp : campaigns) {
            if (camp.Scoring_Method__c != 'A-priori'
                || camp.Topic_Dict__c == null
                || camp.Overall_Score__c == null
                || camp.Overall_Score__c < MIN_SCORE
                || camp.Overall_Score__c > MAX_SCORE) {
                continue;
            }
            for (Id pfId : parseIds(camp.Product_Family_Ids__c)) {
                ScoreInput input = new ScoreInput();
                input.scoringType = TYPE_APRIORI;
                input.productFamilyId = pfId;
                input.topicId = camp.Topic_Dict__c;
                input.aprioriScore = camp.Overall_Score__c.setScale(0);
                input.campaignId = camp.Id;
                input.campaignName = camp.Name;
                input.activatedBy = UserInfo.getUserId();
                inputs.add(input);
            }
        }
        publish(inputs);
    }

    /**
     * Publishes ML scoring state for the given Scoring Model definitions. Only active Product Family models that
     * have a Model Setting and a Topic produce rows; one row per Product Family.
     */
    public static void publishModels(Set<Id> modelDefinitionIds) {
        if (modelDefinitionIds == null || modelDefinitionIds.isEmpty()) {
            return;
        }
        Map<Id, Marketing_Dictionary__c> models = new Map<Id, Marketing_Dictionary__c>([
            SELECT Id, Model_Id__c, Assigned_Topic_Dict__c, Product_Family__c
            FROM Marketing_Dictionary__c
            WHERE Id IN :modelDefinitionIds
            AND Dictionary_Sub_Type__c = 'Scoring Model'
            AND Is_Active__c = true
            AND Offering_Type__c = 'Product Family'
            AND Assigned_Topic_Dict__c != null
        ]);
        if (models.isEmpty()) {
            return;
        }

        List<ScoreInput> inputs = new List<ScoreInput>();
        for (Scoring_Model_Setting__c setting : [
            SELECT Id, Scoring_Model__c, Data360_DMO__c, Source_Model_Id_Column__c, Model_Source__c,
                   Base_Score_Column__c, Base_Score_Formula_Mode__c, Base_Score_Factor__c, Base_Score_Formula__c,
                   Calibrated_Base_Score_Column__c, Calibrated_Score_Formula_Mode__c,
                   Calibrated_Score_Factor__c, Calibrated_Score_Formula__c,
                   Model_From_Date__c, Model_To_Date__c
            FROM Scoring_Model_Setting__c
            WHERE Scoring_Model__c IN :models.keySet()
        ]) {
            Marketing_Dictionary__c model = models.get(setting.Scoring_Model__c);
            for (Id pfId : parseIds(model.Product_Family__c)) {
                ScoreInput input = new ScoreInput();
                input.scoringType = TYPE_ML;
                input.productFamilyId = pfId;
                input.topicId = model.Assigned_Topic_Dict__c;
                input.activatedBy = UserInfo.getUserId();
                input.modelDefinition = model;
                input.setting = setting;
                inputs.add(input);
            }
        }
        publish(inputs);
    }

    @TestVisible
    private static void publish(List<ScoreInput> rawInputs) {
        if (rawInputs == null || rawInputs.isEmpty()) {
            return;
        }
        Map<String, ScoreInput> inputsByKey = new Map<String, ScoreInput>();
        for (ScoreInput input : rawInputs) {
            inputsByKey.put(input.key(), input);
        }
        Set<String> keys = inputsByKey.keySet();

        Map<String, Campaign_Scoring_State__c> statesByKey = new Map<String, Campaign_Scoring_State__c>();
        for (Campaign_Scoring_State__c state : [
            SELECT Id, Scoring_Key__c, Score_Id__c
            FROM Campaign_Scoring_State__c
            WHERE Scoring_Key__c IN :keys
        ]) {
            statesByKey.put(state.Scoring_Key__c, state);
        }

        Map<String, List<Campaign_Scoring_History__c>> openHistoryByKey = new Map<String, List<Campaign_Scoring_History__c>>();
        for (Campaign_Scoring_History__c hist : [
            SELECT Id, Scoring_Key__c, Apriori_Score__c, Model_Definition__c, Model_Definition_Id__c,
                   Data_Source_Object_API_Name__c, Source_Model_Id__c, Model_Source__c,
                   Base_Score_Column__c, Base_Score_Formula_Mode__c, Base_Score_Factor__c, Base_Score_Formula__c,
                   Calibrated_Base_Score_Column__c, Calibrated_Score_Formula_Mode__c,
                   Calibrated_Score_Factor__c, Calibrated_Score_Formula__c,
                   Model_From_Date__c, Model_To_Date__c
            FROM Campaign_Scoring_History__c
            WHERE Scoring_Key__c IN :keys
            AND End_Date_Time__c = NULL
        ]) {
            if (!openHistoryByKey.containsKey(hist.Scoring_Key__c)) {
                openHistoryByKey.put(hist.Scoring_Key__c, new List<Campaign_Scoring_History__c>());
            }
            openHistoryByKey.get(hist.Scoring_Key__c).add(hist);
        }

        List<ScoreInput> changed = new List<ScoreInput>();
        for (String key : keys) {
            ScoreInput input = inputsByKey.get(key);
            List<Campaign_Scoring_History__c> openRows = openHistoryByKey.get(key);
            Boolean unchanged = openRows != null
                && openRows.size() == 1
                && statesByKey.containsKey(key)
                && matchesSnapshot(openRows[0], input);
            if (!unchanged) {
                changed.add(input);
            }
        }
        if (changed.isEmpty()) {
            return;
        }

        Map<Id, String> dictionaryNames = loadDictionaryNames(changed);
        Map<String, Decimal> scoreIdByPair = loadScoreIdsByPair(changed);
        Decimal nextScoreId = loadMaxScoreId();

        List<Campaign_Scoring_State__c> statesToUpsert = new List<Campaign_Scoring_State__c>();
        Map<String, Campaign_Scoring_State__c> upsertedByKey = new Map<String, Campaign_Scoring_State__c>();
        for (ScoreInput input : changed) {
            String pairKey = buildPairKey(input.productFamilyId, input.topicId);
            Decimal scoreId = scoreIdByPair.get(pairKey);
            if (scoreId == null) {
                nextScoreId += 1;
                scoreId = nextScoreId;
                scoreIdByPair.put(pairKey, scoreId);
            }
            Campaign_Scoring_State__c state = new Campaign_Scoring_State__c();
            fillSnapshot(state, input, scoreId, dictionaryNames);
            statesToUpsert.add(state);
            upsertedByKey.put(input.key(), state);
        }
        upsert statesToUpsert Campaign_Scoring_State__c.Fields.Scoring_Key__c;

        Map<String, Decimal> lastVersionByKey = new Map<String, Decimal>();
        for (AggregateResult agg : [
            SELECT Scoring_Key__c k, MAX(Version_Number__c) v
            FROM Campaign_Scoring_History__c
            WHERE Scoring_Key__c IN :keys
            GROUP BY Scoring_Key__c
        ]) {
            lastVersionByKey.put((String) agg.get('k'), (Decimal) agg.get('v'));
        }

        Datetime now = System.now();
        List<Campaign_Scoring_History__c> toClose = new List<Campaign_Scoring_History__c>();
        List<Campaign_Scoring_History__c> toInsert = new List<Campaign_Scoring_History__c>();
        for (ScoreInput input : changed) {
            String key = input.key();
            List<Campaign_Scoring_History__c> openRows = openHistoryByKey.get(key);
            if (openRows != null) {
                for (Campaign_Scoring_History__c hist : openRows) {
                    toClose.add(new Campaign_Scoring_History__c(Id = hist.Id, End_Date_Time__c = now));
                }
            }
            Campaign_Scoring_State__c state = upsertedByKey.get(key);
            Decimal version = lastVersionByKey.containsKey(key) ? lastVersionByKey.get(key) + 1 : 1;
            Campaign_Scoring_History__c hist = new Campaign_Scoring_History__c();
            fillSnapshot(hist, input, (Decimal) state.Score_Id__c, dictionaryNames);
            hist.Scoring_State__c = state.Id;
            hist.Version_Number__c = version;
            hist.Start_Date_Time__c = now;
            hist.End_Date_Time__c = null;
            if (input.setting != null) {
                Scoring_Model_Setting__c s = input.setting;
                hist.Base_Score_Column__c = s.Base_Score_Column__c;
                hist.Base_Score_Formula_Mode__c = s.Base_Score_Formula_Mode__c;
                hist.Base_Score_Factor__c = s.Base_Score_Factor__c;
                hist.Base_Score_Formula__c = s.Base_Score_Formula__c;
                hist.Calibrated_Base_Score_Column__c = s.Calibrated_Base_Score_Column__c;
                hist.Calibrated_Score_Formula_Mode__c = s.Calibrated_Score_Formula_Mode__c;
                hist.Calibrated_Score_Factor__c = s.Calibrated_Score_Factor__c;
                hist.Calibrated_Score_Formula__c = s.Calibrated_Score_Formula__c;
                hist.Model_From_Date__c = s.Model_From_Date__c;
                hist.Model_To_Date__c = s.Model_To_Date__c;
            }
            toInsert.add(hist);
        }
        if (!toClose.isEmpty()) {
            update toClose;
        }
        insert toInsert;
    }

    private static void fillSnapshot(
        SObject target,
        ScoreInput input,
        Decimal scoreId,
        Map<Id, String> dictionaryNames
    ) {
        Boolean isApriori = input.scoringType == TYPE_APRIORI;
        target.put('Name', buildScoringName(input, dictionaryNames));
        target.put('Scoring_Key__c', input.key());
        target.put('Scoring_Type__c', input.scoringType);
        target.put('Score_Id__c', scoreId);
        target.put('Product_Family_Dict__c', input.productFamilyId);
        target.put('Topic_Dict__c', input.topicId);
        target.put('Activated_By__c', input.activatedBy);
        target.put('Apriori_Score__c', isApriori ? input.aprioriScore : null);
        target.put('Last_Modified_By_Campaign__c', isApriori ? input.campaignId : null);
        target.put('Last_Modified_By_Campaign_Name__c', isApriori ? input.campaignName : null);
        target.put('Model_Definition__c', isApriori ? null : input.modelDefinition.Id);
        target.put('Model_Definition_Id__c', isApriori ? null : input.modelDefinition.Model_Id__c);
        target.put('Data_Source_Object_API_Name__c', isApriori ? null : input.setting.Data360_DMO__c);
        target.put('Source_Model_Id__c', isApriori ? null : input.setting.Source_Model_Id_Column__c);
        target.put('Model_Source__c', isApriori ? null : input.setting.Model_Source__c);
    }

    private static Boolean matchesSnapshot(Campaign_Scoring_History__c hist, ScoreInput input) {
        if (input.scoringType == TYPE_APRIORI) {
            return hist.Apriori_Score__c == input.aprioriScore;
        }
        Scoring_Model_Setting__c s = input.setting;
        return hist.Model_Definition__c == input.modelDefinition.Id
            && hist.Data_Source_Object_API_Name__c == s.Data360_DMO__c
            && hist.Source_Model_Id__c == s.Source_Model_Id_Column__c
            && hist.Model_Source__c == s.Model_Source__c
            && hist.Base_Score_Column__c == s.Base_Score_Column__c
            && hist.Base_Score_Formula_Mode__c == s.Base_Score_Formula_Mode__c
            && hist.Base_Score_Factor__c == s.Base_Score_Factor__c
            && hist.Base_Score_Formula__c == s.Base_Score_Formula__c
            && hist.Calibrated_Base_Score_Column__c == s.Calibrated_Base_Score_Column__c
            && hist.Calibrated_Score_Formula_Mode__c == s.Calibrated_Score_Formula_Mode__c
            && hist.Calibrated_Score_Factor__c == s.Calibrated_Score_Factor__c
            && hist.Calibrated_Score_Formula__c == s.Calibrated_Score_Formula__c
            && hist.Model_From_Date__c == s.Model_From_Date__c
            && hist.Model_To_Date__c == s.Model_To_Date__c;
    }

    private static Map<Id, String> loadDictionaryNames(List<ScoreInput> inputs) {
        Set<Id> ids = new Set<Id>();
        for (ScoreInput input : inputs) {
            ids.add(input.productFamilyId);
            ids.add(input.topicId);
        }
        Map<Id, String> names = new Map<Id, String>();
        for (Marketing_Dictionary__c rec : [SELECT Id, Name FROM Marketing_Dictionary__c WHERE Id IN :ids]) {
            names.put(rec.Id, rec.Name);
        }
        return names;
    }

    /** Score ID already used by any Scoring Type for the same Product Family and Topic. */
    private static Map<String, Decimal> loadScoreIdsByPair(List<ScoreInput> inputs) {
        Set<Id> pfIds = new Set<Id>();
        Set<Id> topicIds = new Set<Id>();
        for (ScoreInput input : inputs) {
            pfIds.add(input.productFamilyId);
            topicIds.add(input.topicId);
        }
        Map<String, Decimal> byPair = new Map<String, Decimal>();
        for (Campaign_Scoring_State__c state : [
            SELECT Product_Family_Dict__c, Topic_Dict__c, Score_Id__c
            FROM Campaign_Scoring_State__c
            WHERE Product_Family_Dict__c IN :pfIds
            AND Topic_Dict__c IN :topicIds
            AND Score_Id__c != NULL
        ]) {
            byPair.put(buildPairKey(state.Product_Family_Dict__c, state.Topic_Dict__c), state.Score_Id__c);
        }
        return byPair;
    }

    private static Decimal loadMaxScoreId() {
        AggregateResult agg = [SELECT MAX(Score_Id__c) m FROM Campaign_Scoring_State__c];
        Decimal maxValue = (Decimal) agg.get('m');
        return maxValue == null ? 0 : maxValue;
    }

    @TestVisible
    private static String buildScoringName(ScoreInput input, Map<Id, String> names) {
        String pfName = names.get(input.productFamilyId);
        String topicName = names.get(input.topicId);
        String value = input.scoringType + '_' + (pfName == null ? '' : pfName) + '_' + (topicName == null ? '' : topicName);
        return value.length() > NAME_MAX_LENGTH ? value.substring(0, NAME_MAX_LENGTH) : value;
    }

    @TestVisible
    private static String buildScoringKey(String scoringType, Id productFamilyId, Id topicId) {
        return scoringType + '_' + String.valueOf(productFamilyId) + '_' + String.valueOf(topicId);
    }

    private static String buildPairKey(Id productFamilyId, Id topicId) {
        return String.valueOf(productFamilyId) + '_' + String.valueOf(topicId);
    }

    private static List<Id> parseIds(String semicolonSeparated) {
        List<Id> ids = new List<Id>();
        if (String.isBlank(semicolonSeparated)) {
            return ids;
        }
        Set<Id> seen = new Set<Id>();
        for (String part : semicolonSeparated.split(';')) {
            String token = part == null ? '' : part.trim();
            if (token.length() != 15 && token.length() != 18) {
                continue;
            }
            try {
                Id parsed = (Id) token;
                if (seen.add(parsed)) {
                    ids.add(parsed);
                }
            } catch (Exception e) {
                continue;
            }
        }
        return ids;
    }
}
