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
        @AuraEnabled public List<CatalogComponent> components = new List<CatalogComponent>();
    }

    public class CatalogComponent {
        @AuraEnabled public String type;
        @AuraEnabled public String label;
        @AuraEnabled public String description;
        @AuraEnabled public String icon;
        @AuraEnabled public String fileName;
        @AuraEnabled public String componentGroup;
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
                   Manifest_JSON__c, LastModifiedDate
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
            definition.components = readCatalog(record.Manifest_JSON__c);
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
                    'Create the template as Draft, attach its source files, define its components, then validate it before activation.'
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
    public static void saveComponentCatalog(Id templateId, String componentsJson) {
        if (templateId == null) throw new AuraHandledException('Template is required.');
        Channel_Template__c template = [
            SELECT Id, Status__c
            FROM Channel_Template__c
            WHERE Id = :templateId
            LIMIT 1
        ];
        if (template.Status__c == 'Active') {
            throw new AuraHandledException(
                'Active template packages are immutable. Archive this version before changing it.'
            );
        }
        List<Object> rawRows;
        try {
            rawRows = (List<Object>) JSON.deserializeUntyped(
                String.isBlank(componentsJson) ? '[]' : componentsJson
            );
        } catch (Exception error) {
            throw new AuraHandledException('Component catalog is not valid.');
        }
        List<Object> components = new List<Object>();
        Set<String> types = new Set<String>();
        for (Object rawRow : rawRows) {
            if (!(rawRow instanceof Map<String, Object>)) continue;
            Map<String, Object> row = (Map<String, Object>) rawRow;
            String type = textValue(row.get('type'));
            if (String.isBlank(type)) continue;
            if (!SUPPORTED_COMPONENT_TYPES.contains(type)) {
                throw new AuraHandledException('Unsupported component type: ' + type);
            }
            if (types.contains(type)) {
                throw new AuraHandledException('Component type ' + type + ' is already used.');
            }
            types.add(type);
            String fileName = textValue(row.get('fileName'));
            if (String.isBlank(fileName)) {
                throw new AuraHandledException(type + ' requires an HTML file.');
            }
            String label = textValue(row.get('label'));
            if (String.isBlank(label)) label = type;
            if (label.length() > 80) label = label.substring(0, 80);
            String description = textValue(row.get('description'));
            if (description.length() > 255) description = description.substring(0, 255);
            String icon = textValue(row.get('icon'));
            if (String.isBlank(icon)) icon = defaultComponentIcon(type);
            if (!Pattern.matches('utility:[a-z0-9_]+', icon)) {
                throw new AuraHandledException('Choose an SLDS utility icon for ' + type + '.');
            }
            components.add(new Map<String, Object>{
                'type' => type,
                'label' => label,
                'description' => description,
                'icon' => icon,
                'fileName' => fileName,
                'group' => type == 'Spacer' ? 'Layout' : 'Content'
            });
        }
        template.Manifest_JSON__c = JSON.serialize(new Map<String, Object>{
            'schemaVersion' => '2.0',
            'components' => components
        });
        template.Validation_Status__c = 'Not Validated';
        template.Validation_Message__c = null;
        template.Package_Hash__c = null;
        update template;
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

    @AuraEnabled(cacheable=true)
    public static List<TemplateOption> getSelectableTemplates(String channelName, String channelType) {
        List<TemplateOption> options = new List<TemplateOption>();
        if (String.isBlank(channelName) && String.isBlank(channelType)) return options;
        for (Channel_Template__c template : [
            SELECT Id, Name, Package_Id__c, SemVer__c, Channel__r.Name, Channel__r.Channel_Type__c
            FROM Channel_Template__c
            WHERE Status__c = 'Active'
              AND Validation_Status__c = 'Valid'
              AND (Channel__r.Name = :channelName OR Channel__r.Channel_Type__c = :channelType)
            ORDER BY Channel__r.Name ASC, Name ASC
        ]) {
            Boolean exactChannel = template.Channel__r.Name == channelName;
            if (String.isNotBlank(channelName) && !exactChannel) continue;
            TemplateOption option = new TemplateOption();
            option.id = template.Id;
            option.name = template.Name;
            option.packageLabel = String.isBlank(template.Package_Id__c)
                ? template.Name
                : template.Package_Id__c + ' · ' + template.SemVer__c;
            options.add(option);
        }
        return options;
    }

    @AuraEnabled
    public static TemplateRenderSource getTemplateRenderSource(Id templateId) {
        Channel_Template__c template = [
            SELECT Id, Name, Manifest_JSON__c, Status__c, Validation_Status__c
            FROM Channel_Template__c
            WHERE Id = :templateId
            LIMIT 1
        ];
        TemplateRenderSource source = new TemplateRenderSource();
        source.templateId = template.Id;
        source.name = template.Name;
        HtmlLibrary library = readHtmlFiles(template.Id);
        Map<String, String> htmlByName = library.byName;
        String shellName = '';
        if (String.isNotBlank(template.Manifest_JSON__c)) {
            Map<String, Object> manifest = (Map<String, Object>) JSON.deserializeUntyped(
                protectManifest(template.Manifest_JSON__c)
            );
            Map<String, Object> master = manifest.get('masterShell') instanceof Map<String, Object>
                ? (Map<String, Object>) manifest.get('masterShell') : new Map<String, Object>();
            Map<String, Object> injection = master.get('injection') instanceof Map<String, Object>
                ? (Map<String, Object>) master.get('injection') : new Map<String, Object>();
            shellName = stringValue(master.get('fileName'));
            if (String.isNotBlank(stringValue(injection.get('bodySlotKey')))) {
                source.bodySlotKey = restorePlaceholder(stringValue(injection.get('bodySlotKey')));
            }
            for (CatalogComponent component : readCatalog(template.Manifest_JSON__c)) {
                RenderBlock renderBlock = new RenderBlock();
                renderBlock.type = component.type;
                renderBlock.fileName = component.fileName;
                renderBlock.label = component.label;
                renderBlock.description = component.description;
                renderBlock.icon = component.icon;
                renderBlock.componentGroup = component.componentGroup;
                renderBlock.html = htmlByName.get(baseName(renderBlock.fileName).toLowerCase());
                if (String.isBlank(renderBlock.html)) {
                    String withExtension = baseName(renderBlock.fileName).toLowerCase();
                    if (!withExtension.endsWith('.html')) renderBlock.html = htmlByName.get(withExtension + '.html');
                }
                if (String.isNotBlank(renderBlock.type)) source.blocks.add(renderBlock);
            }
        }
        source.shellHtml = library.shellHtml;
        if (String.isBlank(source.shellHtml)) {
            source.shellHtml = htmlByName.get(baseName(shellName).toLowerCase());
        }
        if (String.isBlank(source.shellHtml)) {
            for (String name : htmlByName.keySet()) {
                if (name.contains('master')) {
                    source.shellHtml = htmlByName.get(name);
                    break;
                }
            }
        }
        source.bodySlotKey = detectBodySlotKey(source.shellHtml, source.bodySlotKey);
        return source;
    }

    public class TemplateOption {
        @AuraEnabled public Id id;
        @AuraEnabled public String name;
        @AuraEnabled public String packageLabel;
    }

    public class TemplateRenderSource {
        @AuraEnabled public Id templateId;
        @AuraEnabled public String name;
        @AuraEnabled public String shellHtml;
        @AuraEnabled public String bodySlotKey;
        @AuraEnabled public List<RenderBlock> blocks = new List<RenderBlock>();
    }

    public class RenderBlock {
        @AuraEnabled public String type;
        @AuraEnabled public String fileName;
        @AuraEnabled public String html;
        @AuraEnabled public String label;
        @AuraEnabled public String description;
        @AuraEnabled public String icon;
        @AuraEnabled public String componentGroup;
    }

    private static final Set<String> SUPPORTED_COMPONENT_TYPES = new Set<String>{
        'RichText', 'Image', 'TextImage', 'Banner', 'Prefooter', 'Spacer'
    };

    private static List<CatalogComponent> readCatalog(String jsonText) {
        List<CatalogComponent> components = new List<CatalogComponent>();
        if (String.isBlank(jsonText)) return components;
        Map<String, Object> manifest;
        try {
            manifest = (Map<String, Object>) JSON.deserializeUntyped(protectManifest(jsonText));
        } catch (Exception error) {
            return components;
        }
        Object rawComponents = manifest.get('components');
        if (!(rawComponents instanceof List<Object>)) {
            rawComponents = manifest.containsKey('contentBlocks')
                ? manifest.get('contentBlocks')
                : manifest.get('blocks');
        }
        if (!(rawComponents instanceof List<Object>)) return components;
        for (Object rawComponent : (List<Object>) rawComponents) {
            if (!(rawComponent instanceof Map<String, Object>)) continue;
            Map<String, Object> row = (Map<String, Object>) rawComponent;
            CatalogComponent component = new CatalogComponent();
            component.type = restorePlaceholder(textValue(row.get('type')));
            if (String.isBlank(component.type)) component.type = restorePlaceholder(textValue(row.get('id')));
            component.fileName = restorePlaceholder(textValue(row.get('fileName')));
            component.label = textValue(row.get('label'));
            if (String.isBlank(component.label)) component.label = textValue(row.get('displayName'));
            if (String.isBlank(component.label)) component.label = component.type;
            component.description = textValue(row.get('description'));
            component.icon = textValue(row.get('icon'));
            component.componentGroup = textValue(row.get('group'));
            if (String.isBlank(component.componentGroup)) {
                component.componentGroup = component.type == 'Spacer' ? 'Layout' : 'Content';
            }
            if (String.isNotBlank(component.type)) components.add(component);
        }
        return components;
    }

    private static String detectBodySlotKey(String shell, String declaredKey) {
        if (String.isNotBlank(declaredKey)) return declaredKey;
        String source = String.valueOf(shell);
        Matcher keyBeforeLabel = Pattern.compile('data-key="([^"]+)"[^>]*data-label="BODY"').matcher(source);
        if (keyBeforeLabel.find()) return keyBeforeLabel.group(1);
        Matcher keyAfterLabel = Pattern.compile('data-label="BODY"[^>]*data-key="([^"]+)"').matcher(source);
        if (keyAfterLabel.find()) return keyAfterLabel.group(1);
        return '49fwfqshzd9';
    }

    private static String defaultComponentIcon(String type) {
        if (type == 'RichText') return 'utility:display_rich_text';
        if (type == 'Image') return 'utility:image';
        if (type == 'TextImage') return 'utility:layout_card';
        if (type == 'Banner') return 'utility:layout_banner';
        if (type == 'Prefooter') return 'utility:note';
        if (type == 'Spacer') return 'utility:spacer';
        return 'utility:page';
    }

    private static String textValue(Object value) {
        return value == null ? '' : String.valueOf(value).trim();
    }

    private class HtmlLibrary {
        public String shellHtml = '';
        public Map<String, String> byName = new Map<String, String>();
    }

    private static HtmlLibrary readHtmlFiles(Id templateId) {
        HtmlLibrary library = new HtmlLibrary();
        List<ContentDocumentLink> links = [
            SELECT ContentDocument.Title, ContentDocument.LatestPublishedVersionId,
                   ContentDocument.LatestPublishedVersion.FileExtension
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :templateId
        ];
        Set<Id> versionIds = new Set<Id>();
        for (ContentDocumentLink link : links) {
            if (isHtmlFile(link)) versionIds.add(link.ContentDocument.LatestPublishedVersionId);
        }
        Map<Id, ContentVersion> versions = versionIds.isEmpty()
            ? new Map<Id, ContentVersion>()
            : new Map<Id, ContentVersion>([SELECT Id, VersionData FROM ContentVersion WHERE Id IN :versionIds]);
        for (ContentDocumentLink link : links) {
            if (!isHtmlFile(link)) continue;
            ContentVersion version = versions.get(link.ContentDocument.LatestPublishedVersionId);
            if (version == null || version.VersionData == null) continue;
            String rawTitle = link.ContentDocument.Title == null ? '' : link.ContentDocument.Title;
            Boolean shellFile = rawTitle.startsWith('[SHELL_HTML]');
            String title = rawTitle;
            Integer marker = title.indexOf(']');
            if (title.startsWith('[') && marker >= 0) title = title.substring(marker + 1).trim();
            String html = version.VersionData.toString();
            library.byName.put((title + '.html').toLowerCase(), html);
            library.byName.put(title.toLowerCase(), html);
            if (shellFile) library.shellHtml = html;
        }
        return library;
    }

    private static Boolean isHtmlFile(ContentDocumentLink link) {
        if (link.ContentDocument == null || link.ContentDocument.LatestPublishedVersion == null) return false;
        String extension = link.ContentDocument.LatestPublishedVersion.FileExtension;
        String title = link.ContentDocument.Title == null ? '' : link.ContentDocument.Title.toLowerCase();
        return 'html'.equalsIgnoreCase(extension) || title.endsWith('.html');
    }

    private static String protectManifest(String jsonText) {
        String source = String.valueOf(jsonText);
        String result = '';
        Integer cursor = 0;
        while (cursor < source.length()) {
            Integer open = source.indexOf('{{', cursor);
            if (open < 0) return result + source.substring(cursor);
            Integer close = source.indexOf('}}', open + 2);
            if (close < 0) return result + source.substring(cursor);
            result += source.substring(cursor, open) + '[[CC:' + source.substring(open + 2, close) + ']]';
            cursor = close + 2;
        }
        return result;
    }

    private static String restorePlaceholder(String value) {
        String text = String.valueOf(value);
        Integer cursor = 0;
        String restored = '';
        while (cursor < text.length()) {
            Integer open = text.indexOf('[[CC:', cursor);
            if (open < 0) return restored + text.substring(cursor);
            Integer close = text.indexOf(']]', open + 5);
            if (close < 0) return restored + text.substring(cursor);
            restored += text.substring(cursor, open) + '{{' + text.substring(open + 5, close) + '}}';
            cursor = close + 2;
        }
        return restored;
    }

    private static String stringValue(Object value) {
        return value == null ? '' : String.valueOf(value).trim();
    }

    private static String baseName(String path) {
        String normalized = String.valueOf(path).replace('\\', '/');
        Integer slash = normalized.lastIndexOf('/');
        return slash >= 0 ? normalized.substring(slash + 1) : normalized;
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
