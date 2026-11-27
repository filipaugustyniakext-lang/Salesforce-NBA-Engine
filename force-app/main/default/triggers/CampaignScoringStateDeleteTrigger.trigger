trigger CampaignScoringStateDeleteTrigger on Campaign_Scoring_State__c (before delete) {
    CampaignScoringService.blockManualDelete(Trigger.old);
}
