trigger CampaignScoringPublishTrigger on Campaign (after insert, after update) {
    CampaignScoringService.handleCampaignActivations(Trigger.new, Trigger.oldMap);
}
