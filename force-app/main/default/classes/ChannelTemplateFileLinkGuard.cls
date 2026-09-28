public with sharing class ChannelTemplateFileLinkGuard {
    public static void protectActiveTemplateLinks(List<ContentDocumentLink> links) {
        if (ChannelTemplateTriggerHandler.allowActiveDelete || links == null || links.isEmpty()) {
            return;
        }
        Set<Id> linkedEntityIds = new Set<Id>();
        for (ContentDocumentLink link : links) {
            if (link.LinkedEntityId != null) linkedEntityIds.add(link.LinkedEntityId);
        }
        if (linkedEntityIds.isEmpty()) return;

        Set<Id> activeTemplateIds = new Set<Id>();
        for (Channel_Template__c template : [
            SELECT Id
            FROM Channel_Template__c
            WHERE Id IN :linkedEntityIds
              AND Status__c = 'Active'
        ]) {
            activeTemplateIds.add(template.Id);
        }
        if (activeTemplateIds.isEmpty()) return;

        for (ContentDocumentLink link : links) {
            if (activeTemplateIds.contains(link.LinkedEntityId)) {
                link.addError(
                    'Active template package file links are immutable. Archive the template before changing files.'
                );
            }
        }
    }
}
