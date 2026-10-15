public with sharing class CampaignScoringAprioriController {
    private static final Decimal MIN_SCORE = 0;
    private static final Decimal MAX_SCORE = 1000;

    public class AprioriContextResult {
        @AuraEnabled public Decimal suggestedScore;
        @AuraEnabled public Boolean hasExistingState;
        @AuraEnabled public Boolean hasMixedScores;
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

        Set<String> keys = new Set<String>();
        for (Id pfId : pfIds) {
            keys.add(buildCompositeKey(topicId, pfId));
        }

        List<Campaign_Scoring_Apriori_State__c> states = [
            SELECT Apriori_Score__c, Composite_Key__c
            FROM Campaign_Scoring_Apriori_State__c
            WHERE Composite_Key__c IN :keys
        ];

        if (states.isEmpty()) {
            return result;
        }

        result.hasExistingState = true;
        Decimal firstScore = states[0].Apriori_Score__c;
        result.suggestedScore = firstScore;
        for (Campaign_Scoring_Apriori_State__c state : states) {
            if (state.Apriori_Score__c != firstScore) {
                result.hasMixedScores = true;
                result.suggestedScore = null;
                break;
            }
        }
        return result;
    }

    @AuraEnabled
    public static void publishAprioriScores(
        Id topicId,
        List<Id> productFamilyIds,
        Decimal score,
        Id campaignId,
        String campaignName
    ) {
        validateScore(score);
        if (topicId == null) {
            throw new AuraHandledException('Topic is required to publish an apriori score.');
        }
        if (productFamilyIds == null || productFamilyIds.isEmpty()) {
            throw new AuraHandledException('At least one Product Family is required to publish an apriori score.');
        }

        Set<Id> pfIds = new Set<Id>();
        for (Id pfId : productFamilyIds) {
            if (pfId != null) {
                pfIds.add(pfId);
            }
        }
        if (pfIds.isEmpty()) {
            throw new AuraHandledException('At least one Product Family is required to publish an apriori score.');
        }

        Set<String> keys = new Set<String>();
        Map<String, Id> keyToPf = new Map<String, Id>();
        for (Id pfId : pfIds) {
            String key = buildCompositeKey(topicId, pfId);
            keys.add(key);
            keyToPf.put(key, pfId);
        }

        Map<String, Campaign_Scoring_Apriori_State__c> existingByKey = new Map<String, Campaign_Scoring_Apriori_State__c>();
        for (Campaign_Scoring_Apriori_State__c state : [
            SELECT Id, Apriori_Score__c, Composite_Key__c, Product_Family_Dict__c, Topic_Dict__c
            FROM Campaign_Scoring_Apriori_State__c
            WHERE Composite_Key__c IN :keys
        ]) {
            existingByKey.put(state.Composite_Key__c, state);
        }

        Datetime now = System.now();
        List<Campaign_Scoring_Apriori_State__c> statesToUpsert = new List<Campaign_Scoring_Apriori_State__c>();
        List<Campaign_Scoring_Apriori_History__c> historyToInsert = new List<Campaign_Scoring_Apriori_History__c>();

        for (String key : keys) {
            Id pfId = keyToPf.get(key);
            Campaign_Scoring_Apriori_State__c existing = existingByKey.get(key);
            if (existing == null) {
                statesToUpsert.add(new Campaign_Scoring_Apriori_State__c(
                    Composite_Key__c = key,
                    Product_Family_Dict__c = pfId,
                    Topic_Dict__c = topicId,
                    Apriori_Score__c = score,
                    Last_Modified_Source_Campaign__c = campaignId,
                    Last_Modified_Source_Campaign_Name__c = campaignName
                ));
                historyToInsert.add(new Campaign_Scoring_Apriori_History__c(
                    Product_Family_Dict__c = pfId,
                    Topic_Dict__c = topicId,
                    Score_Value__c = score,
                    Start_Date_Time__c = now,
                    End_Date_Time__c = null
                ));
                continue;
            }

            Decimal priorScore = existing.Apriori_Score__c;
            Boolean scoreChanged = priorScore != score;

            existing.Apriori_Score__c = score;
            existing.Last_Modified_Source_Campaign__c = campaignId;
            existing.Last_Modified_Source_Campaign_Name__c = campaignName;
            statesToUpsert.add(existing);

            if (scoreChanged) {
                historyToInsert.addAll(closeOpenHistoryAndStartNew(pfId, topicId, priorScore, score, now));
            }
        }

        if (!statesToUpsert.isEmpty()) {
            upsert statesToUpsert Campaign_Scoring_Apriori_State__c.Fields.Composite_Key__c;
        }
        if (!historyToInsert.isEmpty()) {
            insert historyToInsert;
        }
    }

    @TestVisible
    private static List<Campaign_Scoring_Apriori_History__c> closeOpenHistoryAndStartNew(
        Id productFamilyId,
        Id topicId,
        Decimal priorScore,
        Decimal newScore,
        Datetime now
    ) {
        List<Campaign_Scoring_Apriori_History__c> rows = new List<Campaign_Scoring_Apriori_History__c>();
        List<Campaign_Scoring_Apriori_History__c> openRows = [
            SELECT Id, Start_Date_Time__c, Score_Value__c
            FROM Campaign_Scoring_Apriori_History__c
            WHERE Product_Family_Dict__c = :productFamilyId
              AND Topic_Dict__c = :topicId
              AND End_Date_Time__c = NULL
            ORDER BY Start_Date_Time__c DESC
            LIMIT 1
        ];

        if (!openRows.isEmpty()) {
            Campaign_Scoring_Apriori_History__c openRow = openRows[0];
            openRow.End_Date_Time__c = now;
            update openRow;
        } else {
            rows.add(new Campaign_Scoring_Apriori_History__c(
                Product_Family_Dict__c = productFamilyId,
                Topic_Dict__c = topicId,
                Score_Value__c = priorScore,
                Start_Date_Time__c = now.addDays(-1),
                End_Date_Time__c = now
            ));
        }

        rows.add(new Campaign_Scoring_Apriori_History__c(
            Product_Family_Dict__c = productFamilyId,
            Topic_Dict__c = topicId,
            Score_Value__c = newScore,
            Start_Date_Time__c = now,
            End_Date_Time__c = null
        ));
        return rows;
    }

    @TestVisible
    private static String buildCompositeKey(Id topicId, Id productFamilyId) {
        return String.valueOf(topicId) + '_' + String.valueOf(productFamilyId);
    }

    @TestVisible
    private static void validateScore(Decimal score) {
        if (score == null || score < MIN_SCORE || score > MAX_SCORE) {
            throw new AuraHandledException('Apriori score must be a whole number between 0 and 1000.');
        }
    }
}
