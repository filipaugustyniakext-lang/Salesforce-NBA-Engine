public with sharing class ChannelTemplateController {
    private static final Map<String, String> ASSET_PREFIXES = new Map<String, String>{
        'SHELL_HTML' => '[SHELL_HTML]',
        'SHELL_CSS' => '[SHELL_CSS]',
        'SHELL_JS' => '[SHELL_JS]',
        'CONTENT_BLOCK' => '[CONTENT_BLOCK]'
    };

    public class TemplateAsset {
        @AuraEnabled public Id documentId;
        @AuraEnabled public String name;
        @AuraEnabled public String fileExtension;
        @AuraEnabled public String assetType;
        @AuraEnabled public String assetTypeLabel;
        @AuraEnabled public Integer contentSize;
        @AuraEnabled public Datetime createdDate;
        @AuraEnabled public String createdByName;
        @AuraEnabled public String downloadUrl;
    }

    public class TemplateDefinition {
        @AuraEnabled public Id id;
        @AuraEnabled public String name;
        @AuraEnabled public String status;
        @AuraEnabled public Decimal version;
        @AuraEnabled public String description;
        @AuraEnabled public Datetime lastModifiedDate;
        @AuraEnabled public List<TemplateAsset> assets = new List<TemplateAsset>();
    }

    @AuraEnabled(cacheable=true)
    public static List<TemplateDefinition> getChannelTemplates(Id channelId) {
        if (channelId == null) return new List<TemplateDefinition>();

        List<Channel_Template__c> records = [
            SELECT Id, Name, Status__c, Version__c, Description__c, LastModifiedDate
            FROM Channel_Template__c
            WHERE Channel__c = :channelId
            ORDER BY Status__c ASC, Version__c DESC NULLS LAST, Name ASC
            LIMIT 500
        ];

        Map<Id, TemplateDefinition> byId = new Map<Id, TemplateDefinition>();
        for (Channel_Template__c record : records) {
            TemplateDefinition definition = new TemplateDefinition();
            definition.id = record.Id;
            definition.name = record.Name;
            definition.status = record.Status__c;
            definition.version = record.Version__c;
            definition.description = record.Description__c;
            definition.lastModifiedDate = record.LastModifiedDate;
            byId.put(record.Id, definition);
        }

        if (!byId.isEmpty()) {
            for (ContentDocumentLink link : [
                SELECT LinkedEntityId, ContentDocumentId,
                       ContentDocument.Title,
                       ContentDocument.LatestPublishedVersion.FileExtension,
                       ContentDocument.LatestPublishedVersion.ContentSize,
                       ContentDocument.LatestPublishedVersion.CreatedDate,
                       ContentDocument.LatestPublishedVersion.CreatedBy.Name
                FROM ContentDocumentLink
                WHERE LinkedEntityId IN :byId.keySet()
                ORDER BY ContentDocument.Title ASC
            ]) {
                TemplateDefinition definition = byId.get(link.LinkedEntityId);
                if (definition == null) continue;
                definition.assets.add(toAsset(link));
            }
        }

        List<TemplateDefinition> result = new List<TemplateDefinition>();
        for (Channel_Template__c record : records) result.add(byId.get(record.Id));
        return result;
    }

    @AuraEnabled
    public static Id saveTemplate(Channel_Template__c record, Id channelId) {
        if (record == null || channelId == null) {
            throw new AuraHandledException('Template and Channel are required.');
        }
        if (String.isBlank(record.Name)) {
            throw new AuraHandledException('Template Name is required.');
        }

        record.Name = record.Name.trim();
        if (record.Id == null) {
            record.put('Channel__c', channelId);
        } else {
            Channel_Template__c existing = [
                SELECT Channel__c
                FROM Channel_Template__c
                WHERE Id = :record.Id
                LIMIT 1
            ];
            if (existing.Channel__c != channelId) {
                throw new AuraHandledException('A template cannot be moved to another channel.');
            }
        }
        if (String.isBlank(record.Status__c)) record.Status__c = 'Draft';
        if (record.Version__c == null || record.Version__c < 1) record.Version__c = 1;

        if (record.Status__c == 'Active') {
            if (record.Id == null) {
                throw new AuraHandledException(
                    'Create the template as Draft and attach a Shell HTML file before activating it.'
                );
            }
            Boolean hasShellHtml = false;
            for (ContentDocumentLink link : [
                SELECT ContentDocument.Title
                FROM ContentDocumentLink
                WHERE LinkedEntityId = :record.Id
            ]) {
                if (link.ContentDocument.Title.startsWith(ASSET_PREFIXES.get('SHELL_HTML'))) {
                    hasShellHtml = true;
                    break;
                }
            }
            if (!hasShellHtml) {
                throw new AuraHandledException('A Shell HTML file is required before this template can be Active.');
            }
            List<Channel_Template__c> activeTemplates = [
                SELECT Id, Status__c
                FROM Channel_Template__c
                WHERE Channel__c = :channelId
                  AND Status__c = 'Active'
                  AND Id != :record.Id
            ];
            for (Channel_Template__c activeTemplate : activeTemplates) {
                activeTemplate.Status__c = 'Archived';
            }
            if (!activeTemplates.isEmpty()) update activeTemplates;
        }

        upsert record;
        return record.Id;
    }

    @AuraEnabled
    public static String classifyUploadedFiles(Id templateId, List<Id> documentIds, String assetType) {
        if (documentIds == null || documentIds.isEmpty()) return null;
        Set<Id> uploadedDocumentIds = new Set<Id>(documentIds);
        try {
            if (templateId == null) throw new TemplateAssetException('Template is required.');
            if (!ASSET_PREFIXES.containsKey(assetType)) {
                throw new TemplateAssetException('Unsupported template asset type.');
            }
            // Enforces template access and prevents classifying files linked elsewhere.
            Channel_Template__c template = [
                SELECT Id FROM Channel_Template__c WHERE Id = :templateId LIMIT 1
            ];
            if (template == null) {
                throw new TemplateAssetException('Template is required.');
            }
            Set<Id> linkedDocumentIds = new Set<Id>();
            for (ContentDocumentLink link : [
                SELECT ContentDocumentId
                FROM ContentDocumentLink
                WHERE LinkedEntityId = :templateId
                  AND ContentDocumentId IN :uploadedDocumentIds
            ]) {
                linkedDocumentIds.add(link.ContentDocumentId);
            }
            if (linkedDocumentIds.size() != uploadedDocumentIds.size()) {
                throw new TemplateAssetException('One or more uploaded files are not linked to this template.');
            }

            String requiredExtension = assetType == 'SHELL_CSS'
                ? 'css'
                : assetType == 'SHELL_JS' ? 'js' : 'html';
            String prefix = ASSET_PREFIXES.get(assetType);
            List<ContentDocument> updates = [
                SELECT Id, Title, LatestPublishedVersion.FileExtension
                FROM ContentDocument
                WHERE Id IN :uploadedDocumentIds
            ];
            if (updates.size() != uploadedDocumentIds.size()) {
                throw new TemplateAssetException('One or more uploaded files could not be found.');
            }

            for (ContentDocument document : updates) {
                String extension = document.LatestPublishedVersion.FileExtension == null
                    ? ''
                    : document.LatestPublishedVersion.FileExtension.toLowerCase();
                if (extension != requiredExtension) {
                    throw new TemplateAssetException(
                        'File "' + document.Title + '" must use the .' + requiredExtension + ' extension.'
                    );
                }
                document.Title = prefix + ' ' + stripKnownPrefix(document.Title);
            }
            update updates;

            // A master shell has at most one file of each source type. A new
            // upload replaces the old file while content blocks remain additive.
            if (assetType != 'CONTENT_BLOCK') {
                Set<Id> replacedDocumentIds = new Set<Id>();
                for (ContentDocumentLink link : [
                    SELECT ContentDocumentId, ContentDocument.Title
                    FROM ContentDocumentLink
                    WHERE LinkedEntityId = :templateId
                ]) {
                    if (!uploadedDocumentIds.contains(link.ContentDocumentId)
                        && link.ContentDocument.Title.startsWith(prefix)) {
                        replacedDocumentIds.add(link.ContentDocumentId);
                    }
                }
                removeTemplateFileLinks(templateId, replacedDocumentIds);
            }
            return null;
        } catch (Exception e) {
            // File upload runs in an earlier transaction. Return an error rather
            // than throwing so this cleanup is committed.
            try {
                removeTemplateFileLinks(templateId, uploadedDocumentIds);
            } catch (Exception cleanupError) {
                return e.getMessage() + ' The invalid upload could not be removed automatically.';
            }
            return e.getMessage();
        }
    }

    @AuraEnabled
    public static void deleteTemplateAsset(Id templateId, Id documentId) {
        if (templateId == null || documentId == null) return;
        Channel_Template__c template = [
            SELECT Id FROM Channel_Template__c WHERE Id = :templateId LIMIT 1
        ];
        removeTemplateFileLinks(template.Id, new Set<Id>{ documentId });
    }

    @AuraEnabled
    public static void deleteTemplate(Id templateId) {
        if (templateId == null) return;
        Set<Id> documentIds = new Set<Id>();
        for (ContentDocumentLink link : [
            SELECT ContentDocumentId
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :templateId
        ]) {
            documentIds.add(link.ContentDocumentId);
        }
        removeTemplateFileLinks(templateId, documentIds);
        delete new Channel_Template__c(Id = templateId);
    }

    public static void deleteTemplatesForChannel(Id channelId) {
        if (channelId == null) return;
        List<Channel_Template__c> templates = [
            SELECT Id
            FROM Channel_Template__c
            WHERE Channel__c = :channelId
        ];
        if (templates.isEmpty()) return;

        Set<Id> templateIds = new Map<Id, Channel_Template__c>(templates).keySet();
        List<ContentDocumentLink> links = [
            SELECT Id, ContentDocumentId
            FROM ContentDocumentLink
            WHERE LinkedEntityId IN :templateIds
        ];
        Set<Id> documentIds = new Set<Id>();
        for (ContentDocumentLink link : links) documentIds.add(link.ContentDocumentId);
        if (!links.isEmpty()) delete links;

        Set<Id> orphanIds = new Set<Id>(documentIds);
        if (!orphanIds.isEmpty()) {
            for (ContentDocumentLink remainingLink : [
                SELECT ContentDocumentId
                FROM ContentDocumentLink
                WHERE ContentDocumentId IN :orphanIds
            ]) {
                orphanIds.remove(remainingLink.ContentDocumentId);
            }
            if (!orphanIds.isEmpty()) {
                // File ownership may prevent deleting the underlying document.
                // The template links are already removed, so orphan cleanup is
                // best-effort and must not block channel deletion.
                Database.delete(
                    [SELECT Id FROM ContentDocument WHERE Id IN :orphanIds],
                    false
                );
            }
        }
        delete templates;
    }

    private static void removeTemplateFileLinks(Id templateId, Set<Id> documentIds) {
        if (templateId == null || documentIds == null || documentIds.isEmpty()) return;
        List<ContentDocumentLink> links = [
            SELECT Id, ContentDocumentId
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :templateId
              AND ContentDocumentId IN :documentIds
        ];
        if (!links.isEmpty()) delete links;

        Set<Id> orphanIds = new Set<Id>(documentIds);
        for (ContentDocumentLink remainingLink : [
            SELECT ContentDocumentId
            FROM ContentDocumentLink
            WHERE ContentDocumentId IN :orphanIds
        ]) {
            orphanIds.remove(remainingLink.ContentDocumentId);
        }
        if (!orphanIds.isEmpty()) {
            Database.delete(
                [SELECT Id FROM ContentDocument WHERE Id IN :orphanIds],
                false
            );
        }
    }

    private class TemplateAssetException extends Exception {}

    private static TemplateAsset toAsset(ContentDocumentLink link) {
        String title = link.ContentDocument.Title;
        String assetType = resolveAssetType(title);
        TemplateAsset asset = new TemplateAsset();
        asset.documentId = link.ContentDocumentId;
        asset.name = stripKnownPrefix(title);
        asset.fileExtension = link.ContentDocument.LatestPublishedVersion.FileExtension;
        asset.assetType = assetType;
        asset.assetTypeLabel = assetTypeLabel(assetType);
        asset.contentSize = link.ContentDocument.LatestPublishedVersion.ContentSize;
        asset.createdDate = link.ContentDocument.LatestPublishedVersion.CreatedDate;
        asset.createdByName = link.ContentDocument.LatestPublishedVersion.CreatedBy.Name;
        asset.downloadUrl = '/sfc/servlet.shepherd/document/download/' + link.ContentDocumentId;
        return asset;
    }

    private static String resolveAssetType(String title) {
        for (String assetType : ASSET_PREFIXES.keySet()) {
            if (title != null && title.startsWith(ASSET_PREFIXES.get(assetType))) return assetType;
        }
        return 'UNCLASSIFIED';
    }

    private static String stripKnownPrefix(String title) {
        if (title == null) return '';
        for (String prefix : ASSET_PREFIXES.values()) {
            if (title.startsWith(prefix)) return title.substring(prefix.length()).trim();
        }
        return title;
    }

    private static String assetTypeLabel(String assetType) {
        if (assetType == 'SHELL_HTML') return 'Shell HTML';
        if (assetType == 'SHELL_CSS') return 'Shell CSS';
        if (assetType == 'SHELL_JS') return 'Shell JavaScript';
        if (assetType == 'CONTENT_BLOCK') return 'Content Block HTML';
        return 'Unclassified File';
    }
}
