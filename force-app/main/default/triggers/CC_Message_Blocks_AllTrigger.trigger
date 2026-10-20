trigger CC_Message_Blocks_AllTrigger on CC_Message_Blocks_All__c (before insert, before update, after insert, after update) {
    if (Trigger.isBefore) {
        CC_Message_Blocks_AllTriggerHandler.beforeSave(Trigger.new);
    }
    if (Trigger.isAfter) {
        CC_Message_Blocks_AllTriggerHandler.afterSave(Trigger.new);
    }
}