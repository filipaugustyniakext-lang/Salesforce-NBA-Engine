trigger ScoringModelDefinitionScoringTrigger on Marketing_Dictionary__c (before insert, before update, after insert, after update) {
    if (Trigger.isBefore) {
        CampaignScoringService.validateModelDefinitions(Trigger.new, Trigger.oldMap);
    } else {
        CampaignScoringService.handleModelDefinitions(Trigger.new, Trigger.oldMap);
    }
}
