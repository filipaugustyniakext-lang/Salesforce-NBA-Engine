public without sharing class ChannelTemplateFileVersionGuard {
    public static void beforeInsert(List<ContentVersion> versions) {
        Set<Id> firstPublishIds = new Set<Id>();
        Set<Id> documentIds = new Set<Id>();
        for (ContentVersion version : versions) {
            if (version.FirstPublishLocationId != null) {
                firstPublishIds.add(version.FirstPublishLocationId);
            }
            if (version.ContentDocumentId != null) documentIds.add(version.ContentDocumentId);
        }

        Set<Id> activeTemplateIds = new Set<Id>();
        if (!firstPublishIds.isEmpty()) {
            for (Channel_Template__c template : [
                SELECT Id
                FROM Channel_Template__c
                WHERE Id IN :firstPublishIds
                  AND Status__c = 'Active'
            ]) {
                activeTemplateIds.add(template.Id);
            }
        }

        Set<Id> activeDocumentIds = new Set<Id>();
        if (!documentIds.isEmpty()) {
            List<ContentDocumentLink> links = [
                SELECT ContentDocumentId, LinkedEntityId
                FROM ContentDocumentLink
                WHERE ContentDocumentId IN :documentIds
            ];
            Set<Id> linkedTemplateIds = new Set<Id>();
            for (ContentDocumentLink link : links) linkedTemplateIds.add(link.LinkedEntityId);
            Set<Id> activeLinkedTemplateIds = new Set<Id>();
            if (!linkedTemplateIds.isEmpty()) {
                for (Channel_Template__c template : [
                    SELECT Id
                    FROM Channel_Template__c
                    WHERE Id IN :linkedTemplateIds
                      AND Status__c = 'Active'
                ]) {
                    activeLinkedTemplateIds.add(template.Id);
                }
            }
            for (ContentDocumentLink link : links) {
                if (activeLinkedTemplateIds.contains(link.LinkedEntityId)) {
                    activeDocumentIds.add(link.ContentDocumentId);
                }
            }
        }

        for (ContentVersion version : versions) {
            if (activeTemplateIds.contains(version.FirstPublishLocationId)
                || activeDocumentIds.contains(version.ContentDocumentId)) {
                version.addError(
                    'Active template package files are immutable. Archive the template before uploading a new version.'
                );
            }
        }
    }
}
