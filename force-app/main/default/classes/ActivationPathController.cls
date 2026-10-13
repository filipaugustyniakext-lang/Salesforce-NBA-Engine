public with sharing class ActivationPathController {

    /**
     * Fetches all path allocations for the main datatable view.
     */
    @AuraEnabled
    public static List<Activation_Path_Allocation__c> getAllPathAllocations() {
        try {
            return [
                SELECT Id, Name, Path_Name__c, Path_Probability__c, Path_Status__c,
                       LastModifiedDate, LastModifiedBy.Name
                FROM Activation_Path_Allocation__c 
                WITH USER_MODE
                ORDER BY Path_Name__c ASC
            ];
        } catch (Exception e) {
            AuraHandledException ahe = new AuraHandledException(e.getMessage());
            ahe.setMessage('Error fetching all path allocations: ' + e.getMessage());
            throw ahe;
        }
    }

    /**
     * Saves changes (upserts new/edited records and deletes removed ones).
     */
    @AuraEnabled
    public static void saveAllocations(
        List<Activation_Path_Allocation__c> allocationsToUpsert, 
        List<Activation_Path_Allocation__c> allocationsToDelete
    ) {
        try {
            if (allocationsToDelete != null && !allocationsToDelete.isEmpty()) {
                delete as user allocationsToDelete;
            }
            if (allocationsToUpsert != null && !allocationsToUpsert.isEmpty()) {
                upsert as user allocationsToUpsert;
            }
        } catch (Exception e) {
            AuraHandledException ahe = new AuraHandledException(e.getMessage());
            ahe.setMessage('Error saving allocations: ' + e.getMessage());
            throw ahe;
        }
    }

    /**
     * Deletes a single allocation record directly from the list view.
     */
    @AuraEnabled
    public static void deleteSingleAllocation(Id allocationId) {
        try {
            Activation_Path_Allocation__c recordToDelete = new Activation_Path_Allocation__c(Id = allocationId);
            delete as user recordToDelete;
        } catch (Exception e) {
            AuraHandledException ahe = new AuraHandledException(e.getMessage());
            ahe.setMessage('Error deleting allocation: ' + e.getMessage());
            throw ahe;
        }
    }
}