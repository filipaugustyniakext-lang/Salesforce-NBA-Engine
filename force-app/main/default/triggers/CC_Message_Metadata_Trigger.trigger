trigger CC_Message_Metadata_Trigger on CC_Message_Metadata__c (after delete, after update) {
    if (Trigger.isAfter && Trigger.isDelete) {
        List<String> variantIdsToDelete = new List<String>();

        for (CC_Message_Metadata__c record : Trigger.old) {
            if (String.isNotBlank(record.MessageVariantId__c)) {
                variantIdsToDelete.add(record.MessageVariantId__c);
            }
        }

        if (!variantIdsToDelete.isEmpty()) {
            MarketingCloudCopySync.deleteVariantsFromMCEAsync(variantIdsToDelete);
        }
    }

    if (Trigger.isAfter && Trigger.isUpdate) {
        CampaignCopyVariantHandler.handleMessageStatusChanges(Trigger.new, Trigger.oldMap);
    }
}