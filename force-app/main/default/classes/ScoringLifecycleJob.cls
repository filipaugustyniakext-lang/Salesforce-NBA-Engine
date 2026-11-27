/**
 * Daily job for the scoring lifecycle. Runs as a system process, so it is not limited by the sharing of whoever
 * scheduled it. Order matters: definitions expire first, then live settings past their Model To Date are historized,
 * then scheduled settings that are due go live (historizing the setting they replace).
 */
public without sharing class ScoringLifecycleJob implements Schedulable {
    public class Summary {
        public Integer definitionsExpired = 0;
        public Integer settingsHistorized = 0;
        public Integer settingsActivated = 0;
    }

    public void execute(SchedulableContext context) {
        runLifecycle(Date.today());
    }

    public static String scheduleDaily() {
        return System.schedule('Scoring lifecycle (daily)', '0 0 2 * * ?', new ScoringLifecycleJob());
    }

    public static Summary runLifecycle(Date today) {
        ScoringModelSettingService.asOfDate = today;
        try {
            return process(today);
        } finally {
            ScoringModelSettingService.asOfDate = null;
        }
    }

    private static Summary process(Date today) {
        Summary summary = new Summary();

        List<Marketing_Dictionary__c> expired = [
            SELECT Id
            FROM Marketing_Dictionary__c
            WHERE Dictionary_Sub_Type__c = 'Scoring Model'
            AND Is_Active__c = true
            AND Model_Expiration_Date__c != NULL
            AND Model_Expiration_Date__c <= :today
        ];
        Set<Id> expiredIds = new Set<Id>();
        for (Marketing_Dictionary__c definition : expired) {
            definition.Is_Active__c = false;
            expiredIds.add(definition.Id);
        }
        if (!expired.isEmpty()) {
            update expired;
            summary.definitionsExpired = expired.size();
        }

        List<Scoring_Model_Setting__c> toHistorize = new List<Scoring_Model_Setting__c>();
        for (Scoring_Model_Setting__c setting : [
            SELECT Id, Status__c
            FROM Scoring_Model_Setting__c
            WHERE Status__c = :ScoringModelSettingService.ACTIVE
            AND (Scoring_Model__c IN :expiredIds OR Model_To_Date__c < :today)
        ]) {
            setting.Status__c = ScoringModelSettingService.HISTORIZED;
            toHistorize.add(setting);
        }

        Map<Id, Scoring_Model_Setting__c> dueByDefinition = new Map<Id, Scoring_Model_Setting__c>();
        for (Scoring_Model_Setting__c setting : [
            SELECT Id, Status__c, Scoring_Model__c, Scoring_Model__r.Is_Active__c, Model_From_Date__c, Model_To_Date__c
            FROM Scoring_Model_Setting__c
            WHERE Status__c = :ScoringModelSettingService.SCHEDULED
            AND Model_From_Date__c <= :today
            ORDER BY Model_From_Date__c ASC, CreatedDate ASC
        ]) {
            if (setting.Model_To_Date__c < today) {
                setting.Status__c = ScoringModelSettingService.HISTORIZED;
                toHistorize.add(setting);
            } else if (setting.Scoring_Model__r.Is_Active__c == true) {
                Scoring_Model_Setting__c earlier = dueByDefinition.get(setting.Scoring_Model__c);
                if (earlier != null) {
                    earlier.Status__c = ScoringModelSettingService.HISTORIZED;
                    toHistorize.add(earlier);
                }
                dueByDefinition.put(setting.Scoring_Model__c, setting);
            }
        }
        if (!toHistorize.isEmpty()) {
            update toHistorize;
            summary.settingsHistorized = toHistorize.size();
        }
        if (!dueByDefinition.isEmpty()) {
            List<Scoring_Model_Setting__c> toActivate = dueByDefinition.values();
            for (Scoring_Model_Setting__c setting : toActivate) {
                setting.Status__c = ScoringModelSettingService.ACTIVE;
            }
            update toActivate;
            summary.settingsActivated = toActivate.size();
        }
        return summary;
    }
}
