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
        record.Channel__c = channelId;
        if (String.isBlank(record.Status__c)) record.Status__c = 'Draft';
        if (record.Version__c == null || record.Version__c < 1) record.Version__c = 1;

        if (record.Status__c == 'Active') {
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
    public static void classifyUploadedFiles(List<Id> documentIds, String assetType) {
        if (documentIds == null || documentIds.isEmpty()) return;
        if (!ASSET_PREFIXES.containsKey(assetType)) {
            throw new AuraHandledException('Unsupported template asset type.');
        }

        String requiredExtension = assetType == 'SHELL_CSS'
            ? 'css'
            : assetType == 'SHELL_JS' ? 'js' : 'html';
        String prefix = ASSET_PREFIXES.get(assetType);
        List<ContentDocument> updates = new List<ContentDocument>();

        for (ContentDocument document : [
            SELECT Id, Title, LatestPublishedVersion.FileExtension
            FROM ContentDocument
            WHERE Id IN :documentIds
        ]) {
            String extension = document.LatestPublishedVersion.FileExtension == null
                ? ''
                : document.LatestPublishedVersion.FileExtension.toLowerCase();
            if (extension != requiredExtension) {
                throw new AuraHandledException(
                    'File "' + document.Title + '" must use the .' + requiredExtension + ' extension.'
                );
            }
            String cleanTitle = stripKnownPrefix(document.Title);
            document.Title = prefix + ' ' + cleanTitle;
            updates.add(document);
        }
        if (!updates.isEmpty()) update updates;
    }

    @AuraEnabled
    public static void deleteTemplateAsset(Id documentId) {
        if (documentId == null) return;
        delete [SELECT Id FROM ContentDocument WHERE Id = :documentId LIMIT 1];
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
        if (!documentIds.isEmpty()) {
            delete [SELECT Id FROM ContentDocument WHERE Id IN :documentIds];
        }
        delete new Channel_Template__c(Id = templateId);
    }

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
