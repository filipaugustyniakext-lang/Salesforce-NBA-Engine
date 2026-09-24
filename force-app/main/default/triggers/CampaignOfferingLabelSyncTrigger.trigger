trigger CampaignOfferingLabelSyncTrigger on Campaign (before insert, before update) {
    if (CampaignOfferingLabelSync.RUNNING_HEAL) return;
    CampaignOfferingLabelSync.syncLabels(Trigger.new);
}
