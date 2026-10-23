trigger CC_Message_Metadata_Trigger on CC_Message_Metadata__c (after delete, after update) {
    if (Trigger.isAfter && Trigger.isDelete) {
        List<String> variantIdsToDelete = new List<String>();

        for (CC_Message_Metadata__c record : Trigger.old) {
            String variantKey = String.isNotBlank(record.MessageVariantId__c)
                ? record.MessageVariantId__c.trim()
                : (String.isNotBlank(record.Message_Variant_Id__c)
                    ? record.Message_Variant_Id__c.trim()
                    : null);
            if (String.isNotBlank(variantKey)) {
                variantIdsToDelete.add(variantKey);
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