/**
 * Deletes every row of one Campaign Scoring object. Deleting the history first and the state second keeps
 * history from outliving its state; finish() chains the state delete after the history delete.
 */
public with sharing class ScoringDataDeleteBatch implements Database.Batchable<SObject> {
    private final String objectName;

    public ScoringDataDeleteBatch(String objectName) {
        this.objectName = objectName;
    }

    public Database.QueryLocator start(Database.BatchableContext context) {
        if (objectName == 'Campaign_Scoring_History__c') {
            return Database.getQueryLocator([SELECT Id FROM Campaign_Scoring_History__c]);
        }
        return Database.getQueryLocator([SELECT Id FROM Campaign_Scoring_State__c]);
    }

    public void execute(Database.BatchableContext context, List<SObject> scope) {
        CampaignScoringService.maintenanceDeleteInProgress = true;
        try {
            delete scope;
        } finally {
            CampaignScoringService.maintenanceDeleteInProgress = false;
        }
    }

    public void finish(Database.BatchableContext context) {
        if (objectName == 'Campaign_Scoring_History__c') {
            Database.executeBatch(new ScoringDataDeleteBatch('Campaign_Scoring_State__c'), 2000);
        }
    }
}
