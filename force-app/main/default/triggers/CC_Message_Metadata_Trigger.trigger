trigger CC_Message_Metadata_Trigger on CC_Message_Metadata__c (after delete) {
    List<String> variantIdsToDelete = new List<String>();
    
    // Trigger.old contains the records being deleted
    for (CC_Message_Metadata__c record : Trigger.old) {
        // Use the MessageVariantId__c mapped in your sync class 
        if (String.isNotBlank(record.MessageVariantId__c)) {
            variantIdsToDelete.add(record.MessageVariantId__c);
        }
    }
    
    if (!variantIdsToDelete.isEmpty()) {
        MarketingCloudCopySync.deleteVariantsFromMCEAsync(variantIdsToDelete);
    }
}