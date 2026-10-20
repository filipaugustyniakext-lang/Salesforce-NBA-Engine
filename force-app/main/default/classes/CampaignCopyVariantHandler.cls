/**
 * Keeps Campaign ↔ Copy Center junction rows in sync when message variant status changes.
 */
public with sharing class CampaignCopyVariantHandler {

    public static void handleMessageStatusChanges(
        List<CC_Message_Metadata__c> updatedRows,
        Map<Id, CC_Message_Metadata__c> oldById
    ) {
        if (updatedRows == null || updatedRows.isEmpty() || oldById == null) {
            return;
        }

        Set<Id> noLongerPublished = new Set<Id>();
        for (CC_Message_Metadata__c row : updatedRows) {
            CC_Message_Metadata__c prior = oldById.get(row.Id);
            if (prior == null) {
                continue;
            }
            if (prior.Status__c == 'Published' && row.Status__c != 'Published') {
                noLongerPublished.add(row.Id);
            }
        }
        if (noLongerPublished.isEmpty()) {
            return;
        }

        List<Campaign_Copy_Variant__c> junctionRows = [
            SELECT Id, Is_Eligible__c
            FROM Campaign_Copy_Variant__c
            WHERE Message_Variant__c IN :noLongerPublished
            AND Is_Eligible__c = true
        ];
        if (junctionRows.isEmpty()) {
            return;
        }
        for (Campaign_Copy_Variant__c junction : junctionRows) {
            junction.Is_Eligible__c = false;
        }
        update junctionRows;
    }
}