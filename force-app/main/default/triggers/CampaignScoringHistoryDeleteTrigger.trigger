trigger CampaignScoringHistoryDeleteTrigger on Campaign_Scoring_History__c (before delete) {
    CampaignScoringService.blockManualDelete(Trigger.old);
}
