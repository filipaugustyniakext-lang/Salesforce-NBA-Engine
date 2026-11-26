trigger ScoringModelSettingScoringTrigger on Scoring_Model_Setting__c (after insert, after update) {
    CampaignScoringService.handleModelSettings(Trigger.new);
}
