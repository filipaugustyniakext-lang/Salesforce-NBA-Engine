public with sharing class CC_Message_Blocks_AllTriggerHandler {
    public static void beforeSave(List<CC_Message_Blocks_All__c> records) {
        if (MarketingCloudCopySync.isInboundSyncActive()) {
            return;
        }
        CopyCockpitModificationService.stampBlocks(records);
    }

    public static void afterSave(List<CC_Message_Blocks_All__c> records) {
        if (MarketingCloudCopySync.isInboundSyncActive()) {
            return;
        }
        Set<Id> ids = new Set<Id>();
        for (CC_Message_Blocks_All__c record : records) {
            if (record.Id != null) {
                ids.add(record.Id);
            }
        }
        MarketingCloudCopySync.scheduleBlockPush(ids);
    }
}
