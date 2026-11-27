trigger CampaignScoringPublishTrigger on Campaign (after insert, after update) {
    CampaignScoringService.handleCampaignChanges(Trigger.new, Trigger.oldMap);
}
