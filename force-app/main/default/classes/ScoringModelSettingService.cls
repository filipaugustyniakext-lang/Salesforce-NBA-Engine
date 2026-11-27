/**
 * Lifecycle of Model Settings. A Model Definition can have several settings, but only one is live (Active) at a time:
 *   Draft      saved, not live
 *   Scheduled  becomes Active on its Model From Date (daily job)
 *   Active     the live setting; publishing ML scores to Campaign Scoring State happens from here
 *   Historized replaced by another live setting, deactivated, or past its Model To Date
 * Only Active Model Definitions can have an Active or Scheduled setting.
 */
public with sharing class ScoringModelSettingService {
    public static final String DRAFT = 'Draft';
    public static final String SCHEDULED = 'Scheduled';
    public static final String ACTIVE = 'Active';
    public static final String HISTORIZED = 'Historized';

    /** Set while this service historizes other settings, so the nested trigger run does not publish twice. */
    private static Boolean historizing = false;

    /** The daily job sets this so the triggers judge Model From/To Dates against the job's date, not the clock. */
    public static Date asOfDate;

    /** Before insert/update: default status, definition must be active, date window, live-vs-scheduled by From Date. */
    public static void beforeSave(List<Scoring_Model_Setting__c> rows, Map<Id, Scoring_Model_Setting__c> oldById) {
        Set<Id> modelIds = new Set<Id>();
        for (Scoring_Model_Setting__c row : rows) {
            if (row.Scoring_Model__c != null) {
                modelIds.add(row.Scoring_Model__c);
            }
        }
        Map<Id, Marketing_Dictionary__c> definitions = new Map<Id, Marketing_Dictionary__c>([
            SELECT Id, Is_Active__c FROM Marketing_Dictionary__c WHERE Id IN :modelIds
        ]);
        Date today = asOfDate != null ? asOfDate : Date.today();
        Datetime now = System.now();

        for (Scoring_Model_Setting__c row : rows) {
            Scoring_Model_Setting__c previous = oldById == null ? null : oldById.get(row.Id);
            if (String.isBlank(row.Status__c)) {
                row.Status__c = DRAFT;
            }
            if (row.Model_From_Date__c != null && row.Model_To_Date__c != null
                && row.Model_From_Date__c > row.Model_To_Date__c) {
                row.addError('Model From Date must be on or before Model To Date.');
                continue;
            }

            Boolean statusChanged = previous == null || previous.Status__c != row.Status__c;
            if (row.Status__c == ACTIVE || row.Status__c == SCHEDULED) {
                if (statusChanged) {
                    Marketing_Dictionary__c definition = definitions.get(row.Scoring_Model__c);
                    if (definition == null || definition.Is_Active__c != true) {
                        row.addError('Only Active model definitions can have an active or scheduled setting.');
                        continue;
                    }
                }
                if (row.Model_From_Date__c != null) {
                    if (row.Status__c == ACTIVE && row.Model_From_Date__c > today) {
                        row.Status__c = SCHEDULED;
                    } else if (row.Status__c == SCHEDULED && row.Model_From_Date__c <= today) {
                        row.Status__c = ACTIVE;
                    }
                }
            }
            if (row.Status__c == ACTIVE && (previous == null || previous.Status__c != ACTIVE)) {
                row.Activated_On__c = now;
            }
            if (row.Status__c == HISTORIZED && (previous == null || previous.Status__c != HISTORIZED)) {
                row.Historized_On__c = now;
            }
        }
    }

    /**
     * After insert/update: a setting that is now Active historizes the other Active settings of its definition, then
     * the scoring state of every touched definition is re-published (live setting, or Inactive when none is live).
     */
    public static void afterSave(List<Scoring_Model_Setting__c> rows) {
        if (historizing) {
            return;
        }
        Set<Id> modelIds = new Set<Id>();
        Set<Id> liveModelIds = new Set<Id>();
        Set<Id> liveIds = new Set<Id>();
        for (Scoring_Model_Setting__c row : rows) {
            modelIds.add(row.Scoring_Model__c);
            if (row.Status__c == ACTIVE) {
                liveModelIds.add(row.Scoring_Model__c);
                liveIds.add(row.Id);
            }
        }
        if (!liveModelIds.isEmpty()) {
            List<Scoring_Model_Setting__c> replaced = [
                SELECT Id, Status__c
                FROM Scoring_Model_Setting__c
                WHERE Scoring_Model__c IN :liveModelIds
                AND Status__c = :ACTIVE
                AND Id NOT IN :liveIds
            ];
            if (!replaced.isEmpty()) {
                for (Scoring_Model_Setting__c other : replaced) {
                    other.Status__c = HISTORIZED;
                }
                historizing = true;
                try {
                    update replaced;
                } finally {
                    historizing = false;
                }
            }
        }
        CampaignScoringService.handleModelSettings(rows);
    }

    /** Manual action: a live setting is historized, a scheduled one goes back to Draft. */
    public static void deactivateSetting(Id settingId) {
        Scoring_Model_Setting__c setting = [SELECT Id, Status__c FROM Scoring_Model_Setting__c WHERE Id = :settingId LIMIT 1];
        if (setting.Status__c == ACTIVE) {
            setting.Status__c = HISTORIZED;
        } else if (setting.Status__c == SCHEDULED) {
            setting.Status__c = DRAFT;
        } else {
            throw new AuraHandledException('Only an active or scheduled setting can be deactivated.');
        }
        update setting;
    }

    /** Manual action: activates the setting now, or schedules it when its Model From Date is in the future. */
    public static void activateSetting(Id settingId) {
        Scoring_Model_Setting__c setting = [SELECT Id, Status__c FROM Scoring_Model_Setting__c WHERE Id = :settingId LIMIT 1];
        if (setting.Status__c == HISTORIZED) {
            throw new AuraHandledException('A historized setting cannot be activated again. Create a new setting instead.');
        }
        setting.Status__c = ACTIVE;
        update setting;
    }
}
