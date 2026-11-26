/**
 * Behind the "Delete All Scoring Records" button of the Campaign Scoring State list view. Deletes every Campaign
 * Scoring State row and every Campaign Scoring History row. Small volumes are deleted immediately, larger ones
 * in the background.
 */
public with sharing class DeleteAllScoringStatesController {
    @TestVisible
    private static final Integer MAX_SYNC_ROWS = 9000;

    private final ApexPages.StandardSetController setController;

    public DeleteAllScoringStatesController(ApexPages.StandardSetController controller) {
        this.setController = controller;
    }

    public Integer getStateCount() {
        return [SELECT COUNT() FROM Campaign_Scoring_State__c];
    }

    public Integer getHistoryCount() {
        return [SELECT COUNT() FROM Campaign_Scoring_History__c];
    }

    public Boolean getCanDelete() {
        return Schema.sObjectType.Campaign_Scoring_State__c.isDeletable()
            && Schema.sObjectType.Campaign_Scoring_History__c.isDeletable();
    }

    public PageReference deleteAll() {
        if (!getCanDelete()) {
            ApexPages.addMessage(new ApexPages.Message(
                ApexPages.Severity.ERROR,
                'You do not have permission to delete Campaign Scoring State and History records.'
            ));
            return null;
        }
        Integer stateCount = getStateCount();
        Integer historyCount = getHistoryCount();
        try {
            if (stateCount + historyCount <= MAX_SYNC_ROWS) {
                delete [SELECT Id FROM Campaign_Scoring_History__c];
                delete [SELECT Id FROM Campaign_Scoring_State__c];
            } else {
                Database.executeBatch(new ScoringDataDeleteBatch('Campaign_Scoring_History__c'), 2000);
            }
        } catch (DmlException e) {
            ApexPages.addMessages(e);
            return null;
        }
        return setController.cancel();
    }

    public PageReference cancel() {
        return setController.cancel();
    }
}
