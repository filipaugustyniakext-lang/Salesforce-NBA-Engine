trigger ScoringModelDefinitionScoringTrigger on Marketing_Dictionary__c (after insert, after update) {
    CampaignScoringService.handleModelDefinitions(Trigger.new);
}
