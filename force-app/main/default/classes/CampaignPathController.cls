public with sharing class CampaignPathController {
    
    // NEW: Fetches ALL paths for the master datatable view
    @AuraEnabled(cacheable=true)
    public static List<Campaign_Path_Allocation__c> getAllPathAllocations() {
        return [SELECT Id, Name, Path_Name__c, Path_Propability__c, Path_Status__c,
                       Campaign__c, Campaign__r.Name, 
                       LastModifiedDate, LastModifiedBy.Name
                FROM Campaign_Path_Allocation__c 
                ORDER BY Campaign__r.Name ASC, Path_Name__c ASC];
    }

    // Fetches campaigns for the combobox inside the modal
    @AuraEnabled(cacheable=true)
    public static List<Campaign> getActiveCampaigns() {
        return [SELECT Id, Name FROM Campaign 
                WHERE IsActive = TRUE 
                ORDER BY CreatedDate DESC LIMIT 100];
    }

    // Fetches paths for a specific campaign when the modal opens
    @AuraEnabled
    public static List<Campaign_Path_Allocation__c> getPathAllocations(Id campaignId) {
        return [SELECT Id, Name, Path_Name__c, Path_Propability__c, Path_Status__c, Campaign__c 
                FROM Campaign_Path_Allocation__c 
                WHERE Campaign__c = :campaignId 
                ORDER BY CreatedDate ASC];
    }

    // Saves the data
    @AuraEnabled
    public static void saveAllocations(List<Campaign_Path_Allocation__c> allocationsToUpsert, List<Campaign_Path_Allocation__c> allocationsToDelete) {
        try {
            if (allocationsToDelete != null && !allocationsToDelete.isEmpty()) {
                delete allocationsToDelete;
            }
            if (allocationsToUpsert != null && !allocationsToUpsert.isEmpty()) {
                upsert allocationsToUpsert;
            }
        } catch (Exception e) {
            throw new AuraHandledException('Error saving allocations: ' + e.getMessage());
        }
    }

    // Deletes a single allocation directly from the list view
    @AuraEnabled
    public static void deleteSingleAllocation(Id allocationId) {
        try {
            delete new Campaign_Path_Allocation__c(Id = allocationId);
        } catch (Exception e) {
            throw new AuraHandledException('Error deleting allocation: ' + e.getMessage());
        }
    }
}