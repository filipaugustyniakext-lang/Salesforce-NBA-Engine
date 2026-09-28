public with sharing class ChannelTemplateController {
    private static final Map<String, String> ASSET_PREFIXES = new Map<String, String>{
        'MANIFEST' => '[MANIFEST]',
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
        @AuraEnabled public String packageId;
        @AuraEnabled public String semVer;
        @AuraEnabled public String packageHash;
        @AuraEnabled public String compilerVersion;
        @AuraEnabled public String validationStatus;
        @AuraEnabled public String validationMessage;
        @AuraEnabled public Datetime validatedAt;
        @AuraEnabled public Datetime lastModifiedDate;
        @AuraEnabled public List<TemplateAsset> assets = new List<TemplateAsset>();
    }

    public class ValidationResponse {
        @AuraEnabled public Boolean valid;
        @AuraEnabled public String message;
        @AuraEnabled public String packageId;
        @AuraEnabled public String semVer;
        @AuraEnabled public String packageHash;
        @AuraEnabled public String compilerVersion;
    }

    @AuraEnabled(cacheable=true)
    public static List<TemplateDefinition> getChannelTemplates(Id channelId) {
        if (channelId == null) return new List<TemplateDefinition>();

        List<Channel_Template__c> records = [
            SELECT Id, Name, Status__c, Version__c, Description__c,
                   Package_Id__c, SemVer__c, Package_Hash__c, Compiler_Version__c,
                   Validation_Status__c, Validation_Message__c, Validated_At__c,
                   LastModifiedDate
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
            definition.packageId = record.Package_Id__c;
            definition.semVer = record.SemVer__c;
            definition.packageHash = record.Package_Hash__c;
            definition.compilerVersion = record.Compiler_Version__c;
            definition.validationStatus = record.Validation_Status__c;
            definition.validationMessage = record.Validation_Message__c;
            definition.validatedAt = record.Validated_At__c;
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

        Marketing_Dictionary__c channel = [
            SELECT Id, Channel_Type__c
            FROM Marketing_Dictionary__c
            WHERE Id = :channelId
            LIMIT 1
        ];
        record.Name = record.Name.trim();
        Channel_Template__c existing;
        if (record.Id == null) {
            record.put('Channel__c', channelId);
        } else {
            existing = [
                SELECT Channel__c, Status__c
                FROM Channel_Template__c
                WHERE Id = :record.Id
                LIMIT 1
            ];
            if (existing.Channel__c != channelId) {
                throw new AuraHandledException('A template cannot be moved to another channel.');
            }
            if (existing.Status__c == 'Active' && record.Status__c == 'Archived') {
                update new Channel_Template__c(Id = record.Id, Status__c = 'Archived');
                return record.Id;
            }
            if (existing.Status__c == 'Active' && record.Status__c != 'Archived') {
                throw new AuraHandledException(
                    'Active template packages are immutable. Archive this version before changing it.'
                );
            }
        }
        if (String.isBlank(record.Status__c)) record.Status__c = 'Draft';
        if (record.Version__c == null || record.Version__c < 1) record.Version__c = 1;

        if (record.Status__c == 'Active') {
            if (record.Id == null) {
                throw new AuraHandledException(
                    'Create the template as Draft, attach its manifest and source files, then validate it before activation.'
                );
            }
            ChannelTemplateManifestService.ValidationResult validation =
                ChannelTemplateManifestService.validate(record.Id, channel.Channel_Type__c);
            if (!validation.valid) {
                throw new AuraHandledException(
                    'Template package validation failed:\n' + validation.message
                );
            }
            applyValidation(record, validation);
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
    public static ValidationResponse validateTemplate(Id templateId) {
        Channel_Template__c template = [
            SELECT Id, Status__c, Channel__r.Channel_Type__c,
                   Package_Id__c, SemVer__c, Package_Hash__c,
                   Compiler_Version__c, Validation_Status__c,
                   Validation_Message__c
            FROM Channel_Template__c
            WHERE Id = :templateId
            LIMIT 1
        ];
        if (template.Status__c == 'Active') {
            ValidationResponse frozenResponse = new ValidationResponse();
            frozenResponse.valid = template.Validation_Status__c == 'Valid';
            frozenResponse.message = template.Validation_Message__c;
            frozenResponse.packageId = template.Package_Id__c;
            frozenResponse.semVer = template.SemVer__c;
            frozenResponse.packageHash = template.Package_Hash__c;
            frozenResponse.compilerVersion = template.Compiler_Version__c;
            return frozenResponse;
        }
        ChannelTemplateManifestService.ValidationResult validation =
            ChannelTemplateManifestService.validate(
                template.Id,
                template.Channel__r.Channel_Type__c
            );
        applyValidation(template, validation);
        update template;

        ValidationResponse response = new ValidationResponse();
        response.valid = validation.valid;
        response.message = validation.message;
        response.packageId = validation.packageId;
        response.semVer = validation.semVer;
        response.packageHash = validation.packageHash;
        response.compilerVersion = validation.compilerVersion;
        return response;
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
                SELECT Id, Status__c FROM Channel_Template__c WHERE Id = :templateId LIMIT 1
            ];
            if (template == null) {
                throw new TemplateAssetException('Template is required.');
            }
            if (template.Status__c == 'Active') {
                throw new TemplateAssetException(
                    'Active template packages are immutable. Archive this version before replacing files.'
                );
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

            String requiredExtension = assetType == 'MANIFEST'
                ? 'json'
                : assetType == 'SHELL_CSS'
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
            markNeedsValidation(templateId);
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
            SELECT Id, Status__c FROM Channel_Template__c WHERE Id = :templateId LIMIT 1
        ];
        if (template.Status__c == 'Active') {
            throw new AuraHandledException(
                'Active template packages are immutable. Archive this version before removing files.'
            );
        }
        removeTemplateFileLinks(template.Id, new Set<Id>{ documentId });
        markNeedsValidation(template.Id);
    }

    @AuraEnabled
    public static void deleteTemplate(Id templateId) {
        if (templateId == null) return;
        Channel_Template__c template = [
            SELECT Id, Status__c
            FROM Channel_Template__c
            WHERE Id = :templateId
            LIMIT 1
        ];
        if (template.Status__c == 'Active') {
            throw new AuraHandledException(
                'Active template packages cannot be deleted. Archive this version first.'
            );
        }
        Set<Id> documentIds = new Set<Id>();
        for (ContentDocumentLink link : [
            SELECT ContentDocumentId
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :templateId
        ]) {
            documentIds.add(link.ContentDocumentId);
        }
        removeTemplateFileLinks(templateId, documentIds);
        delete template;
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
        ChannelTemplateTriggerHandler.allowActiveDelete = true;
        try {
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
        } finally {
            ChannelTemplateTriggerHandler.allowActiveDelete = false;
        }
    }

    private static void applyValidation(
        Channel_Template__c template,
        ChannelTemplateManifestService.ValidationResult validation
    ) {
        ChannelTemplateManifestService.applyToTemplate(template, validation);
    }

    private static void markNeedsValidation(Id templateId) {
        update new Channel_Template__c(
            Id = templateId,
            Validation_Status__c = 'Not Validated',
            Validation_Message__c = 'Source files changed. Validate the package again.',
            Package_Hash__c = null,
            Validated_At__c = null
        );
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
        if (assetType == 'MANIFEST') return 'Package Manifest';
        if (assetType == 'SHELL_HTML') return 'Shell HTML';
        if (assetType == 'SHELL_CSS') return 'Shell CSS';
        if (assetType == 'SHELL_JS') return 'Shell JavaScript';
        if (assetType == 'CONTENT_BLOCK') return 'Content Block HTML';
        return 'Unclassified File';
    }
}
