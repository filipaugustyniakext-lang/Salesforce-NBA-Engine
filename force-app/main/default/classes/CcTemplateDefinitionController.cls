/**
 * Backend of the schema v1 template wizard (c/ccTemplateManager) in Marketing Dictionary > Channels.
 * Templates are Channel_Template__c records with Definition_JSON__c; multi-block templates own
 * Channel_Template_Block__c children. Contract: docs/copy-center/binding-syntax.md
 */
public with sharing class CcTemplateDefinitionController {
    private static final Integer HTML_PART_LIMIT = 131072;
    private static final Set<String> BLOCK_STATUSES = new Set<String>{ 'Draft', 'Ready', 'Active', 'Archived' };

    public class BlockSummary {
        @AuraEnabled public Id id;
        @AuraEnabled public String name;
        @AuraEnabled public String status;
        @AuraEnabled public Decimal order;
        @AuraEnabled public String description;
        @AuraEnabled public List<String> contentTypes = new List<String>();
        @AuraEnabled public String validationStatus;
        @AuraEnabled public String validationMessage;
        @AuraEnabled public Integer usageCount = 0;
        @AuraEnabled public String sourceHtml;
        @AuraEnabled public String definitionJson;
        @AuraEnabled public String mceAssetId;
        @AuraEnabled public String mceAssetPath;
        @AuraEnabled public String mcnAssetId;
        @AuraEnabled public String mcnAssetPath;
    }

    public class TemplateSummary {
        @AuraEnabled public Id id;
        @AuraEnabled public String name;
        @AuraEnabled public String slug;
        @AuraEnabled public String status;
        @AuraEnabled public Id localeId;
        @AuraEnabled public String localeCode;
        @AuraEnabled public String classification;
        @AuraEnabled public String templateMode;
        @AuraEnabled public String description;
        @AuraEnabled public Decimal version;
        @AuraEnabled public String validationStatus;
        @AuraEnabled public String validationMessage;
        @AuraEnabled public Boolean isV1 = false;
        @AuraEnabled public Integer messageCount = 0;
        @AuraEnabled public Integer liveMessageCount = 0;
        @AuraEnabled public Datetime lastModifiedDate;
        @AuraEnabled public List<BlockSummary> blocks = new List<BlockSummary>();
        @AuraEnabled public String shellHtml;
        @AuraEnabled public String definitionJson;
        @AuraEnabled public String mceAssetId;
        @AuraEnabled public String mceAssetPath;
        @AuraEnabled public String mcnAssetId;
        @AuraEnabled public String mcnAssetPath;
    }

    public class SaveResult {
        @AuraEnabled public Id id;
        @AuraEnabled public String validationStatus;
        @AuraEnabled public CcTemplateValidator.Result validation;
    }

    // ─── Reads ───────────────────────────────────────────────────────────────

    @AuraEnabled
    public static List<TemplateSummary> getTemplates(Id channelId) {
        if (channelId == null) return new List<TemplateSummary>();
        List<Channel_Template__c> records = queryTemplates(channelId, null);
        return summarize(records, false);
    }

    @AuraEnabled
    public static TemplateSummary getTemplateDetail(Id templateId) {
        if (templateId == null) throw error('Template is required.');
        List<Channel_Template__c> records = queryTemplates(null, templateId);
        if (records.isEmpty()) throw error('Template was not found.');
        TemplateSummary summary = summarize(records, true)[0];
        if (!summary.isV1) {
            ChannelTemplateController.TemplateRenderSource source = ChannelTemplateController.getTemplateRenderSource(templateId);
            summary.shellHtml = source == null ? null : source.shellHtml;
        }
        return summary;
    }

    /** Shell + Active blocks of a v1 template, used by the Copy Center editor and preview. */
    @AuraEnabled
    public static TemplateSummary getActiveTemplateBundle(Id templateId) {
        TemplateSummary summary = getTemplateDetail(templateId);
        List<BlockSummary> active = new List<BlockSummary>();
        for (BlockSummary block : summary.blocks) {
            if (block.status == 'Active') active.add(block);
        }
        summary.blocks = active;
        return summary;
    }

    // ─── Template writes ─────────────────────────────────────────────────────

    /**
     * payload: { id, channelId, slug, localeId, classification, templateMode, description, shellHtml, definitionJson,
     *            mceAssetId, mceAssetPath, mcnAssetId, mcnAssetPath }
     */
    @AuraEnabled
    public static SaveResult saveTemplate(String payloadJson) {
        Map<String, Object> payload = parsePayload(payloadJson);
        Id templateId = idValue(payload, 'id');
        Id channelId = idValue(payload, 'channelId');
        Channel_Template__c record;
        if (templateId != null) {
            record = queryTemplates(null, templateId)[0];
        } else {
            if (channelId == null) throw error('Channel is required.');
            record = new Channel_Template__c(Channel__c = channelId, Status__c = 'Draft', Version__c = 1);
        }
        Id localeId = idValue(payload, 'localeId');
        String localeCode = localeCodeFor(localeId);
        String slug = stringValue(payload, 'slug');
        String classification = stringValue(payload, 'classification');
        record.Locale__c = localeId;
        record.Template_Slug__c = slug;
        record.Template_Classification__c = classification;
        record.Template_Mode__c = stringValue(payload, 'templateMode') == 'single' ? 'Single Block' : 'Multi Block';
        record.Description__c = truncate(stringValue(payload, 'description'), 255);
        record.Country_Code__c = countryOf(localeCode);
        record.Name = truncate(ChannelTemplateController.composeTemplateName(localeCode, slug, classification), 80);
        String shell = stringValue(payload, 'shellHtml');
        if (shell != null && shell.length() > HTML_PART_LIMIT * 2) {
            throw error('Shell HTML is too large (' + shell.length() + ' characters, limit ' + (HTML_PART_LIMIT * 2) + ').');
        }
        record.Shell_HTML__c = shell == null ? null : shell.left(HTML_PART_LIMIT);
        record.Shell_HTML_Part2__c = shell != null && shell.length() > HTML_PART_LIMIT ? shell.substring(HTML_PART_LIMIT) : null;
        String definition = stringValue(payload, 'definitionJson');
        record.Definition_JSON__c = String.isBlank(definition) ? '{"schemaVersion":"1.0","kind":"shell","sections":[],"contentSlots":[],"regions":[]}' : definition;
        record.MCE_Asset_Id__c = stringValue(payload, 'mceAssetId');
        record.MCE_Asset_Path__c = stringValue(payload, 'mceAssetPath');
        record.MCN_Asset_Id__c = stringValue(payload, 'mcnAssetId');
        record.MCN_Asset_Path__c = stringValue(payload, 'mcnAssetPath');

        CcTemplateValidator.Result validation = CcTemplateValidator.validateTemplate(record, blocksOf(record.Id), false);
        applyValidation(record, validation);
        if (record.Status__c == 'Active' && !validation.valid) {
            throw error('This template is Active, so changes must stay valid:\n' + validation.summary());
        }
        try {
            upsert record;
        } catch (DmlException e) {
            throw error(e.getDmlMessage(0));
        }
        SaveResult result = new SaveResult();
        result.id = record.Id;
        result.validationStatus = record.Validation_Status__c;
        result.validation = validation;
        return result;
    }

    @AuraEnabled
    public static CcTemplateValidator.Result validateTemplate(Id templateId) {
        Channel_Template__c record = queryTemplates(null, templateId)[0];
        CcTemplateValidator.Result validation = CcTemplateValidator.validateTemplate(record, blocksOf(templateId), true);
        applyValidation(record, validation);
        update new Channel_Template__c(
            Id = record.Id,
            Validation_Status__c = record.Validation_Status__c,
            Validation_Message__c = record.Validation_Message__c,
            Validated_At__c = record.Validated_At__c
        );
        return validation;
    }

    @AuraEnabled
    public static void activateTemplate(Id templateId) {
        CcTemplateValidator.Result validation = validateTemplate(templateId);
        if (!validation.valid) throw error('Fix the validation errors before activating:\n' + validation.summary());
        try {
            update new Channel_Template__c(Id = templateId, Status__c = 'Active');
        } catch (DmlException e) {
            throw error(e.getDmlMessage(0));
        }
    }

    @AuraEnabled
    public static void archiveTemplate(Id templateId) {
        try {
            update new Channel_Template__c(Id = templateId, Status__c = 'Archived');
        } catch (DmlException e) {
            throw error(e.getDmlMessage(0));
        }
    }

    @AuraEnabled
    public static void deleteTemplate(Id templateId) {
        Integer used = [SELECT COUNT() FROM CC_Message_Blocks__c WHERE BlockTemplateDefinitionId__r.Channel_Template__c = :templateId];
        if (used > 0) {
            throw error('Content blocks of this template are used by ' + used + ' message block(s). Remove them from the messages first.');
        }
        try {
            ChannelTemplateController.deleteTemplate(templateId);
        } catch (AuraHandledException e) {
            throw error(e.getMessage());
        }
    }

    // ─── Block writes ────────────────────────────────────────────────────────

    /** payload: { id, templateId, name, description, order, sourceHtml, definitionJson, mceAssetId, mceAssetPath, mcnAssetId, mcnAssetPath } */
    @AuraEnabled
    public static SaveResult saveBlock(String payloadJson) {
        Map<String, Object> payload = parsePayload(payloadJson);
        Id blockId = idValue(payload, 'id');
        Channel_Template_Block__c block;
        if (blockId != null) {
            block = queryBlocks(null, blockId)[0];
        } else {
            Id templateId = idValue(payload, 'templateId');
            if (templateId == null) throw error('Save the template before adding content blocks.');
            block = new Channel_Template_Block__c(Channel_Template__c = templateId, Status__c = 'Draft');
        }
        String name = stringValue(payload, 'name');
        if (String.isBlank(name)) throw error('Block name is required.');
        block.Name = truncate(name, 80);
        block.Description__c = truncate(stringValue(payload, 'description'), 255);
        Object order = payload.get('order');
        if (order != null) block.Block_Order__c = Decimal.valueOf(String.valueOf(order));
        block.Source_HTML__c = stringValue(payload, 'sourceHtml');
        block.Definition_JSON__c = stringValue(payload, 'definitionJson');
        block.Content_Types__c = String.join(new List<String>(CcTemplateValidator.contentTypesOf(block.Definition_JSON__c)), ';');
        block.MCE_Asset_Id__c = stringValue(payload, 'mceAssetId');
        block.MCE_Asset_Path__c = stringValue(payload, 'mceAssetPath');
        block.MCN_Asset_Id__c = stringValue(payload, 'mcnAssetId');
        block.MCN_Asset_Path__c = stringValue(payload, 'mcnAssetPath');
        if (block.Source_HTML__c != null && block.Source_HTML__c.length() > HTML_PART_LIMIT) {
            throw error('Block HTML is too large (limit ' + HTML_PART_LIMIT + ' characters).');
        }
        CcTemplateValidator.Result validation = CcTemplateValidator.validateBlock(block);
        block.Validation_Status__c = validation.valid ? 'Valid' : 'Invalid';
        block.Validation_Message__c = truncate(validation.summary(), 32768);
        block.Validated_At__c = Datetime.now();
        if ((block.Status__c == 'Active' || block.Status__c == 'Ready') && !validation.valid) {
            throw error('This block is ' + block.Status__c + ', so changes must stay valid:\n' + validation.summary());
        }
        upsert block;
        SaveResult result = new SaveResult();
        result.id = block.Id;
        result.validationStatus = block.Validation_Status__c;
        result.validation = validation;
        return result;
    }

    @AuraEnabled
    public static void setBlockStatus(Id blockId, String status) {
        if (!BLOCK_STATUSES.contains(status)) throw error('Unknown block status ' + status + '.');
        Channel_Template_Block__c block = queryBlocks(null, blockId)[0];
        if (status == 'Active' || status == 'Ready') {
            CcTemplateValidator.Result validation = CcTemplateValidator.validateBlock(block);
            if (!validation.valid) throw error('Only valid blocks can be set to ' + status + ':\n' + validation.summary());
        }
        if (status != 'Active' && block.Status__c == 'Active') {
            Channel_Template__c template = [SELECT Status__c, Template_Mode__c FROM Channel_Template__c WHERE Id = :block.Channel_Template__c];
            if (template.Status__c == 'Active') {
                Integer otherActive = [
                    SELECT COUNT() FROM Channel_Template_Block__c
                    WHERE Channel_Template__c = :block.Channel_Template__c AND Status__c = 'Active' AND Id != :blockId
                ];
                if (otherActive == 0) throw error('An Active template needs at least one Active content block.');
            }
        }
        update new Channel_Template_Block__c(Id = blockId, Status__c = status);
    }

    @AuraEnabled
    public static void deleteBlock(Id blockId) {
        Integer used = [SELECT COUNT() FROM CC_Message_Blocks__c WHERE BlockTemplateDefinitionId__c = :blockId];
        if (used > 0) {
            throw error('This content block is used by ' + used + ' message block(s) and cannot be deleted. Archive it instead.');
        }
        Channel_Template_Block__c block = queryBlocks(null, blockId)[0];
        if (block.Status__c == 'Active') {
            throw error('Deactivate (set to Draft or Archived) this block before deleting it.');
        }
        delete block;
    }

    @AuraEnabled
    public static void reorderBlocks(List<Id> blockIds) {
        List<Channel_Template_Block__c> updates = new List<Channel_Template_Block__c>();
        for (Integer i = 0; i < blockIds.size(); i++) {
            updates.add(new Channel_Template_Block__c(Id = blockIds[i], Block_Order__c = i + 1));
        }
        update updates;
    }

    // ─── Internals ───────────────────────────────────────────────────────────

    private static List<Channel_Template__c> queryTemplates(Id channelId, Id templateId) {
        String soql = 'SELECT Id, Name, Channel__c, Status__c, Version__c, Description__c, Template_Slug__c, '
            + 'Template_Classification__c, Template_Mode__c, Locale__c, Locale__r.Name, Country_Code__c, '
            + 'Definition_JSON__c, Shell_HTML__c, Shell_HTML_Part2__c, Validation_Status__c, Validation_Message__c, '
            + 'Validated_At__c, MCE_Asset_Id__c, MCE_Asset_Path__c, MCN_Asset_Id__c, MCN_Asset_Path__c, LastModifiedDate '
            + 'FROM Channel_Template__c WHERE ';
        soql += templateId != null ? 'Id = :templateId' : 'Channel__c = :channelId';
        soql += ' ORDER BY Status__c ASC, Name ASC LIMIT 500';
        return Database.query(soql);
    }

    private static List<Channel_Template_Block__c> queryBlocks(Set<Id> templateIds, Id blockId) {
        String soql = 'SELECT Id, Name, Channel_Template__c, Status__c, Block_Order__c, Description__c, Content_Types__c, '
            + 'Source_HTML__c, Definition_JSON__c, Validation_Status__c, Validation_Message__c, '
            + 'MCE_Asset_Id__c, MCE_Asset_Path__c, MCN_Asset_Id__c, MCN_Asset_Path__c '
            + 'FROM Channel_Template_Block__c WHERE ';
        soql += blockId != null ? 'Id = :blockId' : 'Channel_Template__c IN :templateIds';
        soql += ' ORDER BY Block_Order__c ASC NULLS LAST, Name ASC';
        List<Channel_Template_Block__c> rows = Database.query(soql);
        if (blockId != null && rows.isEmpty()) throw error('Content block was not found.');
        return rows;
    }

    private static List<Channel_Template_Block__c> blocksOf(Id templateId) {
        if (templateId == null) return new List<Channel_Template_Block__c>();
        return queryBlocks(new Set<Id>{ templateId }, null);
    }

    private static List<TemplateSummary> summarize(List<Channel_Template__c> records, Boolean includeSource) {
        Map<Id, TemplateSummary> byId = new Map<Id, TemplateSummary>();
        List<TemplateSummary> ordered = new List<TemplateSummary>();
        for (Channel_Template__c record : records) {
            TemplateSummary summary = new TemplateSummary();
            summary.id = record.Id;
            summary.name = record.Name;
            summary.slug = record.Template_Slug__c;
            summary.status = record.Status__c;
            summary.localeId = record.Locale__c;
            summary.localeCode = record.Locale__r?.Name;
            summary.classification = record.Template_Classification__c;
            summary.templateMode = CcTemplateValidator.templateModeKey(record);
            summary.description = record.Description__c;
            summary.version = record.Version__c;
            summary.validationStatus = record.Validation_Status__c;
            summary.validationMessage = record.Validation_Message__c;
            summary.isV1 = CcTemplateValidator.isV1(record);
            summary.lastModifiedDate = record.LastModifiedDate;
            summary.mceAssetId = record.MCE_Asset_Id__c;
            summary.mceAssetPath = record.MCE_Asset_Path__c;
            summary.mcnAssetId = record.MCN_Asset_Id__c;
            summary.mcnAssetPath = record.MCN_Asset_Path__c;
            if (includeSource) {
                summary.shellHtml = (record.Shell_HTML__c == null ? '' : record.Shell_HTML__c)
                    + (record.Shell_HTML_Part2__c == null ? '' : record.Shell_HTML_Part2__c);
                summary.definitionJson = record.Definition_JSON__c;
            }
            byId.put(record.Id, summary);
            ordered.add(summary);
        }
        if (byId.isEmpty()) return ordered;

        for (AggregateResult row : [
            SELECT Source_Template__c templateId, Status__c status, COUNT(Id) total
            FROM CC_Message_Metadata__c
            WHERE Source_Template__c IN :byId.keySet()
            GROUP BY Source_Template__c, Status__c
        ]) {
            TemplateSummary summary = byId.get((Id) row.get('templateId'));
            Integer total = (Integer) row.get('total');
            summary.messageCount += total;
            String status = (String) row.get('status');
            if (status == 'Live' || status == 'Published') summary.liveMessageCount += total;
        }

        Map<Id, BlockSummary> blocksById = new Map<Id, BlockSummary>();
        for (Channel_Template_Block__c block : queryBlocks(byId.keySet(), null)) {
            BlockSummary blockSummary = new BlockSummary();
            blockSummary.id = block.Id;
            blockSummary.name = block.Name;
            blockSummary.status = block.Status__c;
            blockSummary.order = block.Block_Order__c;
            blockSummary.description = block.Description__c;
            blockSummary.contentTypes = String.isBlank(block.Content_Types__c) ? new List<String>() : block.Content_Types__c.split(';');
            blockSummary.validationStatus = block.Validation_Status__c;
            blockSummary.validationMessage = block.Validation_Message__c;
            blockSummary.mceAssetId = block.MCE_Asset_Id__c;
            blockSummary.mceAssetPath = block.MCE_Asset_Path__c;
            blockSummary.mcnAssetId = block.MCN_Asset_Id__c;
            blockSummary.mcnAssetPath = block.MCN_Asset_Path__c;
            if (includeSource) {
                blockSummary.sourceHtml = block.Source_HTML__c;
                blockSummary.definitionJson = block.Definition_JSON__c;
            }
            byId.get(block.Channel_Template__c).blocks.add(blockSummary);
            blocksById.put(block.Id, blockSummary);
        }
        if (!blocksById.isEmpty()) {
            for (AggregateResult row : [
                SELECT BlockTemplateDefinitionId__c blockId, COUNT(Id) total
                FROM CC_Message_Blocks__c
                WHERE BlockTemplateDefinitionId__c IN :blocksById.keySet()
                GROUP BY BlockTemplateDefinitionId__c
            ]) {
                blocksById.get((Id) row.get('blockId')).usageCount = (Integer) row.get('total');
            }
        }
        return ordered;
    }

    private static void applyValidation(Channel_Template__c record, CcTemplateValidator.Result validation) {
        record.Validation_Status__c = validation.valid ? 'Valid' : 'Invalid';
        record.Validation_Message__c = truncate(validation.summary(), 32768);
        record.Validated_At__c = Datetime.now();
    }

    private static String localeCodeFor(Id localeId) {
        if (localeId == null) throw error('Select a template locale.');
        List<Marketing_Dictionary__c> rows = [
            SELECT Name FROM Marketing_Dictionary__c
            WHERE Id = :localeId AND Dictionary_Sub_Type__c = 'Locale'
            LIMIT 1
        ];
        if (rows.isEmpty()) throw error('Select a locale configured in Marketing Dictionary > Locales.');
        return rows[0].Name;
    }

    private static String countryOf(String localeCode) {
        if (String.isBlank(localeCode)) return null;
        List<String> parts = localeCode.split('_');
        return truncate(parts.size() > 1 ? parts[1] : parts[0].toUpperCase(), 8);
    }

    private static Map<String, Object> parsePayload(String payloadJson) {
        if (String.isBlank(payloadJson)) throw error('Nothing to save.');
        try {
            return (Map<String, Object>) JSON.deserializeUntyped(payloadJson);
        } catch (Exception e) {
            throw error('Save payload is not valid JSON.');
        }
    }

    private static Id idValue(Map<String, Object> payload, String key) {
        Object value = payload.get(key);
        return value == null || String.isBlank(String.valueOf(value)) ? null : Id.valueOf(String.valueOf(value));
    }

    private static String stringValue(Map<String, Object> payload, String key) {
        Object value = payload.get(key);
        return value == null ? null : String.valueOf(value);
    }

    private static String truncate(String value, Integer size) {
        return value == null ? null : value.left(size);
    }

    private static AuraHandledException error(String message) {
        AuraHandledException ex = new AuraHandledException(message);
        ex.setMessage(message);
        return ex;
    }
}
