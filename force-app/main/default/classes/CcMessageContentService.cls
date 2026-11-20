/**
 * Reads and writes the schema v1 content of a message variant version as CC_Message_Blocks__c rows
 * (one row per block, ordered by ContentBlockOrder__c, JSON split over ContentJson__c / ContentJsonPart2__c).
 * Contract: docs/copy-center/CopyCenterJsonBoilerplate.v1.json
 */
public with sharing class CcMessageContentService {
    public static final Integer JSON_PART_LIMIT = 131072;
    private static final Set<String> EDITABLE_STATUSES = new Set<String>{ 'Draft', 'Ready', 'Inactive', null };

    public class ContentBlock {
        @AuraEnabled public Id id;
        @AuraEnabled public String messageBlockId;
        @AuraEnabled public Decimal order;
        @AuraEnabled public Id blockTemplateDefinitionId;
        @AuraEnabled public String blockTemplateDefinitionName;
        @AuraEnabled public String contentJson;
    }

    public class MessageContent {
        @AuraEnabled public Id messageId;
        @AuraEnabled public String messageName;
        @AuraEnabled public String messageVariantId;
        @AuraEnabled public Decimal messageVariantNumber;
        @AuraEnabled public String channelType;
        @AuraEnabled public String status;
        @AuraEnabled public Id templateId;
        @AuraEnabled public Boolean templateIsV1 = false;
        @AuraEnabled public String versionId;
        @AuraEnabled public Decimal versionNumber;
        @AuraEnabled public Boolean isDraftVersion = false;
        @AuraEnabled public String currentVersionId;
        @AuraEnabled public String draftVersionId;
        @AuraEnabled public String messageSettingsJson;
        @AuraEnabled public List<ContentBlock> blocks = new List<ContentBlock>();
    }

    // ─── Reads ───────────────────────────────────────────────────────────────

    /** Loads the draft version when one exists (Create New Variant Version), otherwise the current version. */
    @AuraEnabled
    public static MessageContent getMessageContent(Id messageId) {
        CC_Message_Metadata__c message = queryMessage(messageId);
        String versionId = String.isNotBlank(message.Draft_Version_Id__c)
            ? message.Draft_Version_Id__c
            : message.CurrentMessageVariantVersionId__c;
        return buildContent(message, versionId);
    }

    public static MessageContent buildContent(CC_Message_Metadata__c message, String versionId) {
        MessageContent content = new MessageContent();
        content.messageId = message.Id;
        content.messageName = message.MessageName__c;
        content.messageVariantId = variantIdOf(message);
        content.messageVariantNumber = message.MessageVariant__c != null ? message.MessageVariant__c : message.Version__c;
        content.channelType = message.Channel_Type__c;
        content.status = message.Status__c;
        content.templateId = message.Source_Template__c;
        content.templateIsV1 = message.Source_Template__c != null && String.isNotBlank(message.Source_Template__r.Definition_JSON__c);
        content.currentVersionId = message.CurrentMessageVariantVersionId__c;
        content.draftVersionId = message.Draft_Version_Id__c;
        content.versionId = versionId;
        content.isDraftVersion = String.isNotBlank(message.Draft_Version_Id__c) && versionId == message.Draft_Version_Id__c;
        content.versionNumber = content.isDraftVersion
            ? (message.CurrentMessageVariantVersionNumber__c == null ? 1 : message.CurrentMessageVariantVersionNumber__c + 1)
            : (message.CurrentMessageVariantVersionNumber__c == null ? 1 : message.CurrentMessageVariantVersionNumber__c);
        content.messageSettingsJson = message.Message_Settings_JSON__c;
        if (String.isBlank(versionId)) return content;
        for (CC_Message_Blocks__c row : queryBlocks(message.Id, versionId)) {
            ContentBlock block = new ContentBlock();
            block.id = row.Id;
            block.messageBlockId = row.MessageBlockId__c;
            block.order = row.ContentBlockOrder__c;
            block.blockTemplateDefinitionId = row.BlockTemplateDefinitionId__c;
            block.blockTemplateDefinitionName = row.BlockTemplateDefinitionName__c;
            block.contentJson = joinJson(row.ContentJson__c, row.ContentJsonPart2__c);
            content.blocks.add(block);
        }
        return content;
    }

    // ─── Writes ──────────────────────────────────────────────────────────────

    /**
     * Saves the ordered list of v1 blocks (JSON array) for the version being edited.
     * Live messages can only be changed through a draft version (Create New Variant Version).
     */
    @AuraEnabled
    public static MessageContent saveMessageContent(Id messageId, String blocksJson, String messageSettingsJson) {
        CC_Message_Metadata__c message = queryMessage(messageId);
        Boolean editingDraft = String.isNotBlank(message.Draft_Version_Id__c);
        if (!editingDraft && !EDITABLE_STATUSES.contains(message.Status__c)) {
            throw error(message.Status__c == 'Archived'
                ? 'Archived messages cannot be edited. Create a new message variant from it instead.'
                : 'This message is ' + message.Status__c + '. Use Create New Variant Version to edit it without changing the live content.');
        }
        String versionId = editingDraft ? message.Draft_Version_Id__c : message.CurrentMessageVariantVersionId__c;
        Decimal versionNumber = editingDraft
            ? (message.CurrentMessageVariantVersionNumber__c == null ? 1 : message.CurrentMessageVariantVersionNumber__c + 1)
            : (message.CurrentMessageVariantVersionNumber__c == null ? 1 : message.CurrentMessageVariantVersionNumber__c);
        CC_Message_Metadata__c metadataUpdate = partialUpdate(message);
        if (String.isBlank(versionId)) {
            versionId = newGuid();
            metadataUpdate.CurrentMessageVariantVersionId__c = versionId;
            metadataUpdate.Current_Message_Variant_Version_Id__c = versionId;
            metadataUpdate.CurrentMessageVariantVersionNumber__c = versionNumber;
        }

        List<Object> blocks = parseBlocks(blocksJson);
        Map<Id, Channel_Template_Block__c> definitions = loadDefinitions(blocks);
        List<CC_Message_Blocks__c> existingRows = queryBlocks(message.Id, versionId);
        Set<String> versionBlockIds = new Set<String>();
        for (CC_Message_Blocks__c existing : existingRows) versionBlockIds.add(existing.MessageBlockId__c);
        List<CC_Message_Blocks__c> rows = new List<CC_Message_Blocks__c>();
        Set<String> keptIds = new Set<String>();
        Integer order = 0;
        for (Object raw : blocks) {
            order++;
            Map<String, Object> block = (Map<String, Object>) raw;
            String messageBlockId = (String) block.get('messageBlockId');
            // Ids from another version (or message) are replaced so the upsert never moves their rows.
            if (String.isBlank(messageBlockId) || keptIds.contains(messageBlockId) || !versionBlockIds.contains(messageBlockId)) {
                messageBlockId = newGuid();
                block.put('messageBlockId', messageBlockId);
            }
            keptIds.add(messageBlockId);
            block.put('blockOrderNumber', order);
            rows.add(toRow(message, block, versionId, versionNumber, order, definitions));
        }

        List<CC_Message_Blocks__c> stale = new List<CC_Message_Blocks__c>();
        for (CC_Message_Blocks__c existing : existingRows) {
            if (!keptIds.contains(existing.MessageBlockId__c)) stale.add(existing);
        }
        Savepoint sp = Database.setSavepoint();
        try {
            if (!stale.isEmpty()) delete stale;
            if (!rows.isEmpty()) upsert rows MessageBlockId__c;
            if (!editingDraft) metadataUpdate.Block_Count__c = rows.size();
            if (messageSettingsJson != null) metadataUpdate.Message_Settings_JSON__c = messageSettingsJson;
            metadataUpdate.LastModifiedBy__c = UserInfo.getName();
            metadataUpdate.LastModifiedAt__c = Datetime.now();
            CopyCockpitModificationService.updateMetadata(metadataUpdate);
        } catch (DmlException e) {
            Database.rollback(sp);
            throw error(e.getDmlMessage(0));
        }
        return buildContent(queryMessage(messageId), versionId);
    }

    /** Validates every block of a version against its block definition (used before Ready / Live). */
    public static CcTemplateValidator.Result validateVersion(Id messageId, String versionId) {
        CcTemplateValidator.Result result = new CcTemplateValidator.Result();
        List<CC_Message_Blocks__c> rows = queryBlocks(messageId, versionId);
        Set<Id> definitionIds = new Set<Id>();
        for (CC_Message_Blocks__c row : rows) {
            if (row.BlockTemplateDefinitionId__c != null) definitionIds.add(row.BlockTemplateDefinitionId__c);
        }
        Map<Id, Channel_Template_Block__c> definitions = new Map<Id, Channel_Template_Block__c>([
            SELECT Id, Status__c, Definition_JSON__c FROM Channel_Template_Block__c WHERE Id IN :definitionIds
        ]);
        Integer index = 0;
        for (CC_Message_Blocks__c row : rows) {
            index++;
            String label = 'Block ' + index + (String.isBlank(row.BlockTemplateDefinitionName__c) ? '' : ' (' + row.BlockTemplateDefinitionName__c + ')');
            Channel_Template_Block__c definition = definitions.get(row.BlockTemplateDefinitionId__c);
            if (row.BlockTemplateDefinitionId__c != null && (definition == null || definition.Status__c == 'Archived')) {
                result.error(label, 'Its content block template is no longer available.');
                continue;
            }
            result.mergeFrom(null, CcTemplateValidator.validateMessageBlock(
                joinJson(row.ContentJson__c, row.ContentJsonPart2__c),
                definition == null ? null : definition.Definition_JSON__c,
                label
            ));
        }
        return result;
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    public static CC_Message_Metadata__c queryMessage(Id messageId) {
        if (messageId == null) throw error('Message is required.');
        List<CC_Message_Metadata__c> rows = [
            SELECT Id, Name, MessageName__c, MessageVariantId__c, Message_Variant_Id__c, MessageVariant__c, Version__c,
                   Channel_Type__c, Message_Type__c, Status__c, Source_Template__c, Source_Template__r.Definition_JSON__c,
                   CurrentMessageVariantVersionId__c, CurrentMessageVariantVersionNumber__c, Draft_Version_Id__c,
                   Message_Settings_JSON__c, Block_Count__c, IsActive__c, Published_At__c, PublishedAt__c,
                   DeactivatedAt__c, Deactivated_At__c, Campaign__c
            FROM CC_Message_Metadata__c
            WHERE Id = :messageId
            LIMIT 1
        ];
        if (rows.isEmpty()) throw error('Message was not found.');
        return rows[0];
    }

    public static List<CC_Message_Blocks__c> queryBlocks(Id messageId, String versionId) {
        return [
            SELECT Id, MessageBlockId__c, ContentBlockOrder__c, BlockTemplateDefinitionId__c, BlockTemplateDefinitionName__c,
                   BlockTemplateDefinitionContentTypes__c, BlockType__c, ContentJson__c, ContentJsonPart2__c,
                   ContentBuilderAssetId__c, ContentBlockPath__c, MCN_BlockTemplateAssetId__c, MCN_BlockTemplateAssetPath__c,
                   MessageVariantVersionId__c, MessageVariantVersionNumber__c, MessageVariantId__c, MessageName__c,
                   MessageType__c, MessageVariant__c, MessageVariantNumber__c
            FROM CC_Message_Blocks__c
            WHERE Message_Metadata__c = :messageId AND MessageVariantVersionId__c = :versionId
            ORDER BY ContentBlockOrder__c ASC NULLS LAST
        ];
    }

    /**
     * CopyCockpitModificationService.ensureMceVariantId generates a new variant GUID when the in-memory
     * record has none, so partial updates must always carry the existing variant ids.
     */
    public static CC_Message_Metadata__c partialUpdate(CC_Message_Metadata__c message) {
        return new CC_Message_Metadata__c(
            Id = message.Id,
            MessageVariantId__c = message.MessageVariantId__c,
            Message_Variant_Id__c = message.Message_Variant_Id__c
        );
    }

    public static String variantIdOf(CC_Message_Metadata__c message) {
        return String.isNotBlank(message.MessageVariantId__c) ? message.MessageVariantId__c : message.Message_Variant_Id__c;
    }

    public static String joinJson(String part1, String part2) {
        return (part1 == null ? '' : part1) + (part2 == null ? '' : part2);
    }

    public static void putJson(SObject row, String jsonText) {
        if (jsonText.length() > JSON_PART_LIMIT * 2) {
            throw error('A content block is too large (' + jsonText.length() + ' characters, limit ' + (JSON_PART_LIMIT * 2) + ').');
        }
        row.put('ContentJson__c', jsonText.left(JSON_PART_LIMIT));
        row.put('ContentJsonPart2__c', jsonText.length() > JSON_PART_LIMIT ? jsonText.substring(JSON_PART_LIMIT) : null);
    }

    public static String newGuid() {
        Blob random = Crypto.generateAesKey(128);
        String hex = EncodingUtil.convertToHex(random);
        return hex.substring(0, 8) + '-' + hex.substring(8, 12) + '-4' + hex.substring(13, 16) + '-'
            + hex.substring(16, 20) + '-' + hex.substring(20, 32);
    }

    private static List<Object> parseBlocks(String blocksJson) {
        if (String.isBlank(blocksJson)) return new List<Object>();
        try {
            Object parsed = JSON.deserializeUntyped(blocksJson);
            if (!(parsed instanceof List<Object>)) throw error('Blocks must be a JSON array.');
            for (Object item : (List<Object>) parsed) {
                if (!(item instanceof Map<String, Object>)) throw error('Every block must be a JSON object.');
            }
            return (List<Object>) parsed;
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw error('Blocks JSON is not valid: ' + e.getMessage());
        }
    }

    private static Map<Id, Channel_Template_Block__c> loadDefinitions(List<Object> blocks) {
        Set<Id> ids = new Set<Id>();
        for (Object raw : blocks) {
            Object rawId = ((Map<String, Object>) raw).get('blockTemplateDefinitionId');
            if (rawId != null && String.isNotBlank(String.valueOf(rawId))) ids.add(Id.valueOf(String.valueOf(rawId)));
        }
        return new Map<Id, Channel_Template_Block__c>([
            SELECT Id, Name, Status__c, Content_Types__c, MCE_Asset_Id__c, MCE_Asset_Path__c, MCN_Asset_Id__c, MCN_Asset_Path__c
            FROM Channel_Template_Block__c
            WHERE Id IN :ids
        ]);
    }

    private static CC_Message_Blocks__c toRow(
        CC_Message_Metadata__c message,
        Map<String, Object> block,
        String versionId,
        Decimal versionNumber,
        Integer order,
        Map<Id, Channel_Template_Block__c> definitions
    ) {
        CC_Message_Blocks__c row = new CC_Message_Blocks__c();
        row.MessageBlockId__c = (String) block.get('messageBlockId');
        row.Message_Metadata__c = message.Id;
        row.MessageName__c = message.MessageName__c;
        row.MessageType__c = String.isNotBlank(message.Message_Type__c) ? message.Message_Type__c : message.Channel_Type__c;
        row.MessageVariantId__c = variantIdOf(message);
        row.MessageVariantNumber__c = message.MessageVariant__c != null ? message.MessageVariant__c : message.Version__c;
        row.MessageVariant__c = row.MessageVariantNumber__c;
        row.MessageVariantVersionId__c = versionId;
        row.MessageVariantVersionNumber__c = versionNumber;
        row.ContentBlockOrder__c = order;
        row.UpdatedBy__c = UserInfo.getName();
        row.UpdatedAt__c = Datetime.now();
        Object definitionId = block.get('blockTemplateDefinitionId');
        Channel_Template_Block__c definition = definitionId == null || String.isBlank(String.valueOf(definitionId))
            ? null
            : definitions.get(Id.valueOf(String.valueOf(definitionId)));
        if (definitionId != null && String.isNotBlank(String.valueOf(definitionId)) && definition == null) {
            throw error('Block ' + order + ' refers to a content block template that does not exist.');
        }
        if (definition != null) {
            row.BlockTemplateDefinitionId__c = definition.Id;
            row.BlockTemplateDefinitionName__c = definition.Name;
            row.BlockTemplateDefinitionContentTypes__c = definition.Content_Types__c;
            row.ContentBuilderAssetId__c = definition.MCE_Asset_Id__c;
            row.ContentBlockPath__c = definition.MCE_Asset_Path__c;
            row.MCN_BlockTemplateAssetId__c = definition.MCN_Asset_Id__c;
            row.MCN_BlockTemplateAssetPath__c = definition.MCN_Asset_Path__c;
            block.put('blockTemplateDefinitionName', definition.Name);
            block.put('mceBlockAssetId', definition.MCE_Asset_Id__c);
            block.put('mceBlockAssetPath', definition.MCE_Asset_Path__c);
            block.put('mcnBlockAssetId', definition.MCN_Asset_Id__c);
            block.put('mcnBlockAssetPath', definition.MCN_Asset_Path__c);
        } else {
            row.BlockTemplateDefinitionName__c = (String) block.get('blockTemplateDefinitionName');
        }
        row.BlockType__c = String.isNotBlank(row.BlockTemplateDefinitionName__c) ? row.BlockTemplateDefinitionName__c.left(255) : 'Block';
        putJson(row, JSON.serialize(block));
        return row;
    }

    public static AuraHandledException error(String message) {
        AuraHandledException ex = new AuraHandledException(message);
        ex.setMessage(message);
        return ex;
    }
}
