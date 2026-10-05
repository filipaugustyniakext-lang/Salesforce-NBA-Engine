trigger ChannelTemplateTrigger on Channel_Template__c (
    before insert,
    before update,
    before delete,
    after update
) {
    if (Trigger.isBefore && Trigger.isInsert) {
        ChannelTemplateTriggerHandler.beforeInsert(Trigger.new);
    } else if (Trigger.isBefore && Trigger.isUpdate) {
        ChannelTemplateTriggerHandler.beforeUpdate(Trigger.new, Trigger.oldMap);
    } else if (Trigger.isBefore && Trigger.isDelete) {
        ChannelTemplateTriggerHandler.beforeDelete(Trigger.old);
    } else if (Trigger.isAfter && Trigger.isUpdate) {
        ChannelTemplateTriggerHandler.afterUpdate(Trigger.new, Trigger.oldMap);
    }
}
