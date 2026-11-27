/**
 * Maintains Campaign Scoring State (the current picture) and Campaign Scoring History (versioned snapshots) with ONE
 * record per Product Family + Topic pair. Each pair can carry an apriori source and an ML source side by side; a
 * publish only touches the fields of its own source.
 *
 * Apriori scores are published when a campaign with an a-priori score is activated (CampaignScoringPublishTrigger).
 * ML scores are published when an active Scoring Model has a Model Setting (Scoring_Model_Setting__c and
 * Marketing_Dictionary__c triggers). Each time at least one source changes, the pair gets a new History version
 * holding the full picture (both sources) and the source that triggered it. Unchanged input never creates a version.
 */
public with sharing class CampaignScoringService {
    public static final String SOURCE_APRIORI = 'Apriori';
    public static final String SOURCE_ML = 'ML';
    public static final String SOURCE_BOTH = 'Both';
    public static final String STATUS_ACTIVE = 'Active';
    public static final String STATUS_INACTIVE = 'Inactive';

    private static final Decimal MIN_SCORE = 0;
    private static final Decimal MAX_SCORE = 1000;
    private static final Integer NAME_MAX_LENGTH = 80;
    public static final String NO_LIVE_SETTING_DESCRIPTION = 'No active settings for this ML Model Definition.';
    private static final String MANUAL_DELETE_MESSAGE =
        'Campaign Scoring State and History rows are maintained by the system and cannot be deleted one by one. '
        + 'Use the Delete All Scoring Records button to remove them.';

    /** Fields that State and History both carry as the "current picture" of a pair. */
    private static final List<String> PICTURE_FIELDS = new List<String>{
        'Apriori_Score__c', 'Apriori_Status__c', 'Apriori_Status_Description__c', 'Apriori_Live_Since__c',
        'Apriori_Last_Modified_By__c', 'Last_Modified_By_Campaign__c', 'Last_Modified_By_Campaign_Name__c',
        'ML_Status__c', 'ML_Status_Description__c', 'ML_Live_Since__c', 'ML_Last_Modified_By__c',
        'Model_Definition__c', 'Model_Definition_Id__c', 'Data_Source_Object_API_Name__c', 'Source_Model_Id__c',
        'Model_Source__c', 'ML_Score_Definition_Setting__c'
    };

    /** ML setting detail that only History keeps. */
    private static final List<String> ML_DETAIL_FIELDS = new List<String>{
        'Base_Score_Column__c', 'Base_Score_Formula_Mode__c', 'Base_Score_Factor__c', 'Base_Score_Formula__c',
        'Calibrated_Base_Score_Column__c', 'Calibrated_Score_Formula_Mode__c', 'Calibrated_Score_Factor__c',
        'Calibrated_Score_Formula__c', 'Model_From_Date__c', 'Model_To_Date__c'
    };

    /** Set only by the bulk delete paths (Delete All Scoring Records). Manual deletes are blocked otherwise. */
    public static Boolean maintenanceDeleteInProgress = false;

    public class AprioriContextResult {
        @AuraEnabled public Decimal suggestedScore;
        @AuraEnabled public Boolean hasExistingState;
        @AuraEnabled public Boolean hasMixedScores;
    }

    /** One source's new value for one pair. */
    @TestVisible
    private class SourceInput {
        String source;
        Id productFamilyId;
        Id topicId;
        Decimal aprioriScore;
        Id campaignId;
        String campaignName;
        Id activatedBy;
        Marketing_Dictionary__c modelDefinition;
        Scoring_Model_Setting__c setting;

        String key() {
            return buildScoringKey(productFamilyId, topicId);
        }
    }

    /** The changes requested for one pair in this transaction. */
    private class PairChange {
        Id productFamilyId;
        Id topicId;
        SourceInput apriori;
        SourceInput ml;
        Boolean aprioriChanged = false;
        Boolean mlChanged = false;
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
            WHERE Topic_Dict__c = :topicId
            AND Product_Family_Dict__c IN :pfIds
            AND Apriori_Score__c != NULL
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

    /**
     * Before-trigger rules for Scoring Model definitions: one Product Family per definition, and only one Active
     * definition per Product Family + Topic. Checked when a definition is created, activated, or has its Topic or
     * Product Family changed; unrelated edits are not blocked by legacy data.
     */
    public static void validateModelDefinitions(List<Marketing_Dictionary__c> newRows, Map<Id, Marketing_Dictionary__c> oldById) {
        List<Marketing_Dictionary__c> candidates = new List<Marketing_Dictionary__c>();
        Set<Id> topicIds = new Set<Id>();
        Set<Id> candidateIds = new Set<Id>();
        for (Marketing_Dictionary__c definition : newRows) {
            if (definition.Dictionary_Sub_Type__c != 'Scoring Model' || definition.Offering_Type__c != 'Product Family') {
                continue;
            }
            Marketing_Dictionary__c previous = oldById == null ? null : oldById.get(definition.Id);
            Boolean offeringChanged = previous == null
                || previous.Product_Family__c != definition.Product_Family__c
                || previous.Offering_Type__c != definition.Offering_Type__c;
            List<Id> productFamilies = parseIds(definition.Product_Family__c);
            if (offeringChanged && productFamilies.size() > 1) {
                definition.addError('A model definition covers exactly one Product Family.');
                continue;
            }
            if (definition.Is_Active__c != true || definition.Assigned_Topic_Dict__c == null || productFamilies.isEmpty()) {
                continue;
            }
            Boolean relevant = offeringChanged
                || previous.Is_Active__c != true
                || previous.Assigned_Topic_Dict__c != definition.Assigned_Topic_Dict__c;
            if (relevant) {
                candidates.add(definition);
                topicIds.add(definition.Assigned_Topic_Dict__c);
                if (definition.Id != null) {
                    candidateIds.add(definition.Id);
                }
            }
        }
        if (candidates.isEmpty()) {
            return;
        }

        Map<String, Marketing_Dictionary__c> activeByKey = new Map<String, Marketing_Dictionary__c>();
        for (Marketing_Dictionary__c existing : [
            SELECT Id, Name, Model_Id__c, Assigned_Topic_Dict__c, Product_Family__c
            FROM Marketing_Dictionary__c
            WHERE Dictionary_Sub_Type__c = 'Scoring Model'
            AND Is_Active__c = true
            AND Offering_Type__c = 'Product Family'
            AND Assigned_Topic_Dict__c IN :topicIds
            AND Id NOT IN :candidateIds
        ]) {
            for (Id pfId : parseIds(existing.Product_Family__c)) {
                activeByKey.put(buildScoringKey(pfId, existing.Assigned_Topic_Dict__c), existing);
            }
        }
        for (Marketing_Dictionary__c definition : candidates) {
            String key = buildScoringKey(parseIds(definition.Product_Family__c)[0], definition.Assigned_Topic_Dict__c);
            Marketing_Dictionary__c owner = activeByKey.get(key);
            if (owner != null) {
                definition.addError(
                    'Model "' + owner.Name + '" (Model ID ' + owner.Model_Id__c + ') is already active for this Product Family and Topic. '
                    + 'Only one active Model Definition can cover a Product Family and Topic.'
                );
            } else {
                activeByKey.put(key, definition);
            }
        }
    }

    /**
     * After-trigger entry point for Scoring Model definitions. A definition that stops being active, or whose Topic or
     * Product Family changes, makes the pairs it no longer serves Inactive for ML; an active definition then
     * (re)publishes its live setting for the pairs it serves.
     */
    public static void handleModelDefinitions(List<Marketing_Dictionary__c> definitions, Map<Id, Marketing_Dictionary__c> oldById) {
        Set<Id> modelIds = new Set<Id>();
        for (Marketing_Dictionary__c definition : definitions) {
            if (definition.Dictionary_Sub_Type__c != 'Scoring Model') {
                continue;
            }
            Marketing_Dictionary__c previous = oldById == null ? null : oldById.get(definition.Id);
            if (previous != null && previous.Is_Active__c == true) {
                if (definition.Is_Active__c != true) {
                    deactivateMlForModel(definition.Id, new Set<String>(), 'Model definition is not active.');
                } else if (previous.Assigned_Topic_Dict__c != definition.Assigned_Topic_Dict__c
                    || previous.Product_Family__c != definition.Product_Family__c
                    || previous.Offering_Type__c != definition.Offering_Type__c) {
                    Set<String> keep = new Set<String>();
                    if (definition.Offering_Type__c == 'Product Family' && definition.Assigned_Topic_Dict__c != null) {
                        for (Id pfId : parseIds(definition.Product_Family__c)) {
                            keep.add(buildScoringKey(pfId, definition.Assigned_Topic_Dict__c));
                        }
                    }
                    deactivateMlForModel(definition.Id, keep, 'Pair no longer covered by this model definition.');
                }
            }
            if (definition.Is_Active__c == true) {
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
        List<SourceInput> inputs = new List<SourceInput>();
        for (Campaign camp : campaigns) {
            if (camp.Scoring_Method__c != 'A-priori'
                || camp.Topic_Dict__c == null
                || camp.Overall_Score__c == null
                || camp.Overall_Score__c < MIN_SCORE
                || camp.Overall_Score__c > MAX_SCORE) {
                continue;
            }
            for (Id pfId : parseIds(camp.Product_Family_Ids__c)) {
                SourceInput input = new SourceInput();
                input.source = SOURCE_APRIORI;
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
     * Publishes ML scoring state for the given Scoring Model definitions. Only active Product Family models with a Topic
     * produce rows, one per Product Family, from the definition's live (Active) Model Setting. A definition without a
     * live setting makes its ML pairs Inactive.
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

        List<SourceInput> inputs = new List<SourceInput>();
        Set<Id> liveModelIds = new Set<Id>();
        for (Scoring_Model_Setting__c setting : [
            SELECT Id, Scoring_Model__c, Data360_DMO__c, Source_Model_Id_Column__c, Model_Source__c,
                   Base_Score_Column__c, Base_Score_Formula_Mode__c, Base_Score_Factor__c, Base_Score_Formula__c,
                   Calibrated_Base_Score_Column__c, Calibrated_Score_Formula_Mode__c,
                   Calibrated_Score_Factor__c, Calibrated_Score_Formula__c,
                   Model_From_Date__c, Model_To_Date__c
            FROM Scoring_Model_Setting__c
            WHERE Scoring_Model__c IN :models.keySet()
            AND Status__c = 'Active'
        ]) {
            liveModelIds.add(setting.Scoring_Model__c);
            Marketing_Dictionary__c model = models.get(setting.Scoring_Model__c);
            for (Id pfId : parseIds(model.Product_Family__c)) {
                SourceInput input = new SourceInput();
                input.source = SOURCE_ML;
                input.productFamilyId = pfId;
                input.topicId = model.Assigned_Topic_Dict__c;
                input.activatedBy = UserInfo.getUserId();
                input.modelDefinition = model;
                input.setting = setting;
                inputs.add(input);
            }
        }
        publish(inputs);
        for (Id modelId : models.keySet()) {
            if (!liveModelIds.contains(modelId)) {
                deactivateMlForModel(modelId, new Set<String>(), NO_LIVE_SETTING_DESCRIPTION);
            }
        }
    }

    @TestVisible
    private static void publish(List<SourceInput> rawInputs) {
        if (rawInputs == null || rawInputs.isEmpty()) {
            return;
        }

        Map<String, PairChange> pairs = new Map<String, PairChange>();
        for (SourceInput input : rawInputs) {
            String key = input.key();
            PairChange pair = pairs.get(key);
            if (pair == null) {
                pair = new PairChange();
                pair.productFamilyId = input.productFamilyId;
                pair.topicId = input.topicId;
                pairs.put(key, pair);
            }
            if (input.source == SOURCE_APRIORI) {
                pair.apriori = input;
            } else {
                pair.ml = input;
            }
        }
        Set<String> keys = pairs.keySet();

        Map<String, Campaign_Scoring_State__c> statesByKey = new Map<String, Campaign_Scoring_State__c>();
        for (Campaign_Scoring_State__c state : [
            SELECT Id, Scoring_Key__c, Score_Id__c
            FROM Campaign_Scoring_State__c
            WHERE Scoring_Key__c IN :keys
        ]) {
            statesByKey.put(state.Scoring_Key__c, state);
        }

        Map<String, List<Campaign_Scoring_History__c>> openHistoryByKey = loadOpenHistory(keys);

        List<String> changedKeys = new List<String>();
        for (String key : keys) {
            PairChange pair = pairs.get(key);
            List<Campaign_Scoring_History__c> openRows = openHistoryByKey.get(key);
            Boolean hasPicture = statesByKey.containsKey(key) && openRows != null && openRows.size() == 1;
            Campaign_Scoring_History__c current = hasPicture ? openRows[0] : null;
            if (pair.apriori != null) {
                pair.aprioriChanged = current == null || !aprioriMatches(current, pair.apriori);
            }
            if (pair.ml != null) {
                pair.mlChanged = current == null || !mlMatches(current, pair.ml);
            }
            if (pair.aprioriChanged || pair.mlChanged) {
                changedKeys.add(key);
            }
        }
        if (changedKeys.isEmpty()) {
            return;
        }

        Datetime now = System.now();
        Set<Id> dictionaryIds = new Set<Id>();
        for (String key : changedKeys) {
            dictionaryIds.add(pairs.get(key).productFamilyId);
            dictionaryIds.add(pairs.get(key).topicId);
        }
        Map<Id, String> names = loadDictionaryNames(dictionaryIds);
        Decimal nextScoreId = loadMaxScoreId();

        List<Campaign_Scoring_State__c> statesToUpsert = new List<Campaign_Scoring_State__c>();
        for (String key : changedKeys) {
            PairChange pair = pairs.get(key);
            Campaign_Scoring_State__c state = new Campaign_Scoring_State__c();
            state.Scoring_Key__c = key;
            state.Name = buildScoringName(pair.productFamilyId, pair.topicId, names);
            state.Product_Family_Dict__c = pair.productFamilyId;
            state.Topic_Dict__c = pair.topicId;
            Campaign_Scoring_State__c existing = statesByKey.get(key);
            if (existing == null || existing.Score_Id__c == null) {
                nextScoreId += 1;
                state.Score_Id__c = nextScoreId;
            }
            if (pair.aprioriChanged) {
                applyApriori(state, pair.apriori, now);
            }
            if (pair.mlChanged) {
                applyMl(state, pair.ml, now);
            }
            statesToUpsert.add(state);
        }
        upsert statesToUpsert Campaign_Scoring_State__c.Fields.Scoring_Key__c;

        Map<String, String> changedSourceByKey = new Map<String, String>();
        Map<String, Scoring_Model_Setting__c> mlSettingByKey = new Map<String, Scoring_Model_Setting__c>();
        for (String key : changedKeys) {
            PairChange pair = pairs.get(key);
            changedSourceByKey.put(key, pair.aprioriChanged && pair.mlChanged
                ? SOURCE_BOTH
                : (pair.aprioriChanged ? SOURCE_APRIORI : SOURCE_ML));
            if (pair.mlChanged) {
                mlSettingByKey.put(key, pair.ml.setting);
            }
        }
        writeSnapshots(changedKeys, changedSourceByKey, mlSettingByKey, openHistoryByKey, names, now);
    }

    /**
     * Closes the open History version of each pair and writes the next one from the pair's current State row.
     * The ML setting detail is taken from mlSettingByKey when ML changed, otherwise carried over from the previous version.
     */
    private static void writeSnapshots(
        List<String> keys,
        Map<String, String> changedSourceByKey,
        Map<String, Scoring_Model_Setting__c> mlSettingByKey,
        Map<String, List<Campaign_Scoring_History__c>> openHistoryByKey,
        Map<Id, String> names,
        Datetime now
    ) {
        Map<String, Campaign_Scoring_State__c> currentByKey = reloadStates(keys);
        Map<String, Decimal> lastVersionByKey = loadLastVersions(keys);

        List<Campaign_Scoring_History__c> toClose = new List<Campaign_Scoring_History__c>();
        List<Campaign_Scoring_History__c> toInsert = new List<Campaign_Scoring_History__c>();
        for (String key : keys) {
            Campaign_Scoring_State__c state = currentByKey.get(key);
            List<Campaign_Scoring_History__c> openRows = openHistoryByKey.get(key);
            Campaign_Scoring_History__c previous = openRows != null && !openRows.isEmpty() ? openRows[0] : null;
            if (openRows != null) {
                for (Campaign_Scoring_History__c hist : openRows) {
                    toClose.add(new Campaign_Scoring_History__c(Id = hist.Id, End_Date_Time__c = now));
                }
            }

            Decimal version = lastVersionByKey.containsKey(key) ? lastVersionByKey.get(key) + 1 : 1;
            Campaign_Scoring_History__c snapshot = new Campaign_Scoring_History__c();
            for (String field : PICTURE_FIELDS) {
                snapshot.put(field, state.get(field));
            }
            snapshot.Scoring_Key__c = key;
            snapshot.Score_Id__c = state.Score_Id__c;
            snapshot.Product_Family_Dict__c = state.Product_Family_Dict__c;
            snapshot.Topic_Dict__c = state.Topic_Dict__c;
            snapshot.Scoring_State__c = state.Id;
            snapshot.Name = buildHistoryName(state.Product_Family_Dict__c, state.Topic_Dict__c, names, version);
            snapshot.Version_Number__c = version;
            snapshot.Start_Date_Time__c = now;
            snapshot.End_Date_Time__c = null;
            snapshot.Changed_Source__c = changedSourceByKey.get(key);

            Scoring_Model_Setting__c mlSetting = mlSettingByKey.get(key);
            if (mlSetting != null) {
                applyMlDetail(snapshot, mlSetting);
            } else if (previous != null) {
                for (String field : ML_DETAIL_FIELDS) {
                    snapshot.put(field, previous.get(field));
                }
            }
            toInsert.add(snapshot);
        }
        if (!toClose.isEmpty()) {
            update toClose;
        }
        insert toInsert;
    }

    /**
     * Marks the ML source Inactive on every pair currently owned by the given model definition, except the pairs in
     * keepKeys, and writes a History version for each. The last values stay on the record for reference.
     */
    @TestVisible
    private static void deactivateMlForModel(Id modelDefinitionId, Set<String> keepKeys, String description) {
        List<Campaign_Scoring_State__c> states = [
            SELECT Id, Scoring_Key__c, Product_Family_Dict__c, Topic_Dict__c
            FROM Campaign_Scoring_State__c
            WHERE Model_Definition__c = :modelDefinitionId
            AND ML_Status__c = :STATUS_ACTIVE
            AND Scoring_Key__c NOT IN :keepKeys
        ];
        if (states.isEmpty()) {
            return;
        }
        List<String> keys = new List<String>();
        Set<Id> dictionaryIds = new Set<Id>();
        for (Campaign_Scoring_State__c state : states) {
            state.ML_Status__c = STATUS_INACTIVE;
            state.ML_Status_Description__c = description;
            state.ML_Score_Definition_Setting__c = null;
            keys.add(state.Scoring_Key__c);
            dictionaryIds.add(state.Product_Family_Dict__c);
            dictionaryIds.add(state.Topic_Dict__c);
        }
        update states;

        Map<String, String> changedSourceByKey = new Map<String, String>();
        for (String key : keys) {
            changedSourceByKey.put(key, SOURCE_ML);
        }
        writeSnapshots(
            keys,
            changedSourceByKey,
            new Map<String, Scoring_Model_Setting__c>(),
            loadOpenHistory(new Set<String>(keys)),
            loadDictionaryNames(dictionaryIds),
            System.now()
        );
    }

    private static void applyApriori(Campaign_Scoring_State__c state, SourceInput input, Datetime now) {
        state.Apriori_Score__c = input.aprioriScore;
        state.Apriori_Status__c = STATUS_ACTIVE;
        state.Apriori_Status_Description__c = null;
        state.Apriori_Live_Since__c = now;
        state.Apriori_Last_Modified_By__c = input.activatedBy;
        state.Last_Modified_By_Campaign__c = input.campaignId;
        state.Last_Modified_By_Campaign_Name__c = input.campaignName;
    }

    private static void applyMl(Campaign_Scoring_State__c state, SourceInput input, Datetime now) {
        state.ML_Status__c = STATUS_ACTIVE;
        state.ML_Status_Description__c = null;
        state.ML_Live_Since__c = now;
        state.ML_Last_Modified_By__c = input.activatedBy;
        state.Model_Definition__c = input.modelDefinition.Id;
        state.Model_Definition_Id__c = input.modelDefinition.Model_Id__c;
        state.Data_Source_Object_API_Name__c = input.setting.Data360_DMO__c;
        state.Source_Model_Id__c = input.setting.Source_Model_Id_Column__c;
        state.Model_Source__c = input.setting.Model_Source__c;
        state.ML_Score_Definition_Setting__c = input.setting.Id;
    }

    private static void applyMlDetail(Campaign_Scoring_History__c snapshot, Scoring_Model_Setting__c s) {
        snapshot.Base_Score_Column__c = s.Base_Score_Column__c;
        snapshot.Base_Score_Formula_Mode__c = s.Base_Score_Formula_Mode__c;
        snapshot.Base_Score_Factor__c = s.Base_Score_Factor__c;
        snapshot.Base_Score_Formula__c = s.Base_Score_Formula__c;
        snapshot.Calibrated_Base_Score_Column__c = s.Calibrated_Base_Score_Column__c;
        snapshot.Calibrated_Score_Formula_Mode__c = s.Calibrated_Score_Formula_Mode__c;
        snapshot.Calibrated_Score_Factor__c = s.Calibrated_Score_Factor__c;
        snapshot.Calibrated_Score_Formula__c = s.Calibrated_Score_Formula__c;
        snapshot.Model_From_Date__c = s.Model_From_Date__c;
        snapshot.Model_To_Date__c = s.Model_To_Date__c;
    }

    private static Boolean aprioriMatches(Campaign_Scoring_History__c current, SourceInput input) {
        return current.Apriori_Status__c == STATUS_ACTIVE && current.Apriori_Score__c == input.aprioriScore;
    }

    private static Boolean mlMatches(Campaign_Scoring_History__c current, SourceInput input) {
        Scoring_Model_Setting__c s = input.setting;
        return current.ML_Status__c == STATUS_ACTIVE
            && current.ML_Score_Definition_Setting__c == s.Id
            && current.Model_Definition__c == input.modelDefinition.Id
            && current.Data_Source_Object_API_Name__c == s.Data360_DMO__c
            && current.Source_Model_Id__c == s.Source_Model_Id_Column__c
            && current.Model_Source__c == s.Model_Source__c
            && current.Base_Score_Column__c == s.Base_Score_Column__c
            && current.Base_Score_Formula_Mode__c == s.Base_Score_Formula_Mode__c
            && current.Base_Score_Factor__c == s.Base_Score_Factor__c
            && current.Base_Score_Formula__c == s.Base_Score_Formula__c
            && current.Calibrated_Base_Score_Column__c == s.Calibrated_Base_Score_Column__c
            && current.Calibrated_Score_Formula_Mode__c == s.Calibrated_Score_Formula_Mode__c
            && current.Calibrated_Score_Factor__c == s.Calibrated_Score_Factor__c
            && current.Calibrated_Score_Formula__c == s.Calibrated_Score_Formula__c
            && current.Model_From_Date__c == s.Model_From_Date__c
            && current.Model_To_Date__c == s.Model_To_Date__c;
    }

    private static Map<String, List<Campaign_Scoring_History__c>> loadOpenHistory(Set<String> keys) {
        Map<String, List<Campaign_Scoring_History__c>> byKey = new Map<String, List<Campaign_Scoring_History__c>>();
        for (Campaign_Scoring_History__c hist : [
            SELECT Id, Scoring_Key__c, Apriori_Score__c, Apriori_Status__c, ML_Status__c,
                   ML_Score_Definition_Setting__c, Model_Definition__c, Data_Source_Object_API_Name__c,
                   Source_Model_Id__c, Model_Source__c,
                   Base_Score_Column__c, Base_Score_Formula_Mode__c, Base_Score_Factor__c, Base_Score_Formula__c,
                   Calibrated_Base_Score_Column__c, Calibrated_Score_Formula_Mode__c,
                   Calibrated_Score_Factor__c, Calibrated_Score_Formula__c,
                   Model_From_Date__c, Model_To_Date__c
            FROM Campaign_Scoring_History__c
            WHERE Scoring_Key__c IN :keys
            AND End_Date_Time__c = NULL
        ]) {
            if (!byKey.containsKey(hist.Scoring_Key__c)) {
                byKey.put(hist.Scoring_Key__c, new List<Campaign_Scoring_History__c>());
            }
            byKey.get(hist.Scoring_Key__c).add(hist);
        }
        return byKey;
    }

    private static Map<String, Campaign_Scoring_State__c> reloadStates(List<String> keys) {
        Map<String, Campaign_Scoring_State__c> byKey = new Map<String, Campaign_Scoring_State__c>();
        for (Campaign_Scoring_State__c state : [
            SELECT Id, Scoring_Key__c, Score_Id__c, Product_Family_Dict__c, Topic_Dict__c,
                   Apriori_Score__c, Apriori_Status__c, Apriori_Status_Description__c, Apriori_Live_Since__c,
                   Apriori_Last_Modified_By__c, Last_Modified_By_Campaign__c, Last_Modified_By_Campaign_Name__c,
                   ML_Status__c, ML_Status_Description__c, ML_Live_Since__c, ML_Last_Modified_By__c,
                   Model_Definition__c, Model_Definition_Id__c, Data_Source_Object_API_Name__c,
                   Source_Model_Id__c, Model_Source__c, ML_Score_Definition_Setting__c
            FROM Campaign_Scoring_State__c
            WHERE Scoring_Key__c IN :keys
        ]) {
            byKey.put(state.Scoring_Key__c, state);
        }
        return byKey;
    }

    private static Map<String, Decimal> loadLastVersions(List<String> keys) {
        Map<String, Decimal> byKey = new Map<String, Decimal>();
        for (AggregateResult agg : [
            SELECT Scoring_Key__c k, MAX(Version_Number__c) v
            FROM Campaign_Scoring_History__c
            WHERE Scoring_Key__c IN :keys
            GROUP BY Scoring_Key__c
        ]) {
            byKey.put((String) agg.get('k'), (Decimal) agg.get('v'));
        }
        return byKey;
    }

    private static Map<Id, String> loadDictionaryNames(Set<Id> ids) {
        Map<Id, String> names = new Map<Id, String>();
        for (Marketing_Dictionary__c rec : [SELECT Id, Name FROM Marketing_Dictionary__c WHERE Id IN :ids]) {
            names.put(rec.Id, rec.Name);
        }
        return names;
    }

    private static Decimal loadMaxScoreId() {
        AggregateResult agg = [SELECT MAX(Score_Id__c) m FROM Campaign_Scoring_State__c];
        Decimal maxValue = (Decimal) agg.get('m');
        return maxValue == null ? 0 : maxValue;
    }

    @TestVisible
    private static String buildScoringName(Id productFamilyId, Id topicId, Map<Id, String> names) {
        String pfName = names.get(productFamilyId);
        String topicName = names.get(topicId);
        String value = (pfName == null ? '' : pfName) + '_' + (topicName == null ? '' : topicName);
        return value.length() > NAME_MAX_LENGTH ? value.substring(0, NAME_MAX_LENGTH) : value;
    }

    /** The version suffix is always kept; the base name is shortened to make room for it. */
    @TestVisible
    private static String buildHistoryName(Id productFamilyId, Id topicId, Map<Id, String> names, Decimal version) {
        String suffix = '_' + String.valueOf(version.intValue());
        String base = buildScoringName(productFamilyId, topicId, names);
        Integer room = NAME_MAX_LENGTH - suffix.length();
        return (base.length() > room ? base.substring(0, room) : base) + suffix;
    }

    @TestVisible
    private static String buildScoringKey(Id productFamilyId, Id topicId) {
        return String.valueOf(productFamilyId) + '_' + String.valueOf(topicId);
    }

    /** Called from the before-delete triggers on State and History. */
    public static void blockManualDelete(List<SObject> rows) {
        if (maintenanceDeleteInProgress) {
            return;
        }
        for (SObject row : rows) {
            row.addError(MANUAL_DELETE_MESSAGE);
        }
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
