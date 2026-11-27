trigger ScoringModelSettingScoringTrigger on Scoring_Model_Setting__c (before insert, before update, after insert, after update) {
    if (Trigger.isBefore) {
        ScoringModelSettingService.beforeSave(Trigger.new, Trigger.oldMap);
    } else {
        ScoringModelSettingService.afterSave(Trigger.new);
    }
}
