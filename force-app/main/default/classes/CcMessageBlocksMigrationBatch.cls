/**
 * One-time migration of existing message content into schema v1 authoring rows (CC_Message_Blocks__c).
 * Source per variant: the MCE mirror (CC_Message_Blocks_All__c, by MessageVariantId__c), or
 * Canvas_Blocks_JSON__c when the mirror has no rows. The original block payload is kept under
 * `legacy` so the MCE round trip and the legacy editor keep working. Idempotent: variants that
 * already have rows for their current version are skipped.
 *
 * Run: Database.executeBatch(new CcMessageBlocksMigrationBatch(true), 50);
 * (true = also delete pre-v1 CC_Message_Blocks__c rows without a version id for migrated variants)
 */
public with sharing class CcMessageBlocksMigrationBatch implements Database.Batchable<SObject>, Database.Stateful {
    private final Boolean deleteUnversioned;
    public Integer migratedMessages = 0;
    public Integer migratedBlocks = 0;
    public Integer skippedMessages = 0;
    public List<String> errors = new List<String>();

    public CcMessageBlocksMigrationBatch(Boolean deleteUnversioned) {
        this.deleteUnversioned = deleteUnversioned == true;
    }

    public Database.QueryLocator start(Database.BatchableContext context) {
        return Database.getQueryLocator([
            SELECT Id, Name, MessageName__c, MessageVariantId__c, Message_Variant_Id__c, MessageVariant__c, Version__c,
                   Channel_Type__c, Message_Type__c, Canvas_Blocks_JSON__c, CurrentMessageVariantVersionId__c,
                   Current_Message_Variant_Version_Id__c, CurrentMessageVariantVersionNumber__c, Block_Count__c
            FROM CC_Message_Metadata__c
        ]);
    }

    public void execute(Database.BatchableContext context, List<CC_Message_Metadata__c> scope) {
        migrate(scope);
    }

    public void migrate(List<CC_Message_Metadata__c> scope) {
        Map<String, CC_Message_Metadata__c> byVariant = new Map<String, CC_Message_Metadata__c>();
        Map<Id, String> versionByMessage = new Map<Id, String>();
        for (CC_Message_Metadata__c message : scope) {
            String variantId = CcMessageContentService.variantIdOf(message);
            if (String.isBlank(variantId)) {
                skippedMessages++;
                continue;
            }
            byVariant.put(variantId, message);
            String versionId = String.isNotBlank(message.CurrentMessageVariantVersionId__c)
                ? message.CurrentMessageVariantVersionId__c
                : message.Current_Message_Variant_Version_Id__c;
            versionByMessage.put(message.Id, versionId);
        }
        if (byVariant.isEmpty()) return;

        Set<Id> alreadyMigrated = new Set<Id>();
        for (CC_Message_Blocks__c row : [
            SELECT Message_Metadata__c, MessageVariantVersionId__c
            FROM CC_Message_Blocks__c
            WHERE Message_Metadata__c IN :versionByMessage.keySet() AND MessageVariantVersionId__c != null
        ]) {
            if (row.MessageVariantVersionId__c == versionByMessage.get(row.Message_Metadata__c)) {
                alreadyMigrated.add(row.Message_Metadata__c);
            }
        }

        Map<String, List<CC_Message_Blocks_All__c>> mirrorByVariant = new Map<String, List<CC_Message_Blocks_All__c>>();
        for (CC_Message_Blocks_All__c row : [
            SELECT MessageVariantId__c, ContentBlockOrder__c, BlockType__c, ContentJson__c, ContentJsonPart2__c,
                   ContentBuilderAssetId__c, ContentBlockPath__c
            FROM CC_Message_Blocks_All__c
            WHERE MessageVariantId__c IN :byVariant.keySet()
            ORDER BY MessageVariantId__c, ContentBlockOrder__c ASC NULLS LAST
        ]) {
            if (!mirrorByVariant.containsKey(row.MessageVariantId__c)) mirrorByVariant.put(row.MessageVariantId__c, new List<CC_Message_Blocks_All__c>());
            mirrorByVariant.get(row.MessageVariantId__c).add(row);
        }

        List<CC_Message_Blocks__c> blockRows = new List<CC_Message_Blocks__c>();
        List<CC_Message_History__c> historyRows = new List<CC_Message_History__c>();
        List<CC_Message_Metadata__c> metadataUpdates = new List<CC_Message_Metadata__c>();
        Set<String> migratedVariants = new Set<String>();
        for (String variantId : byVariant.keySet()) {
            CC_Message_Metadata__c message = byVariant.get(variantId);
            if (alreadyMigrated.contains(message.Id)) {
                skippedMessages++;
                continue;
            }
            List<LegacyBlock> sources = sourcesFor(message, mirrorByVariant.get(variantId));
            String versionId = versionByMessage.get(message.Id);
            Decimal versionNumber = message.CurrentMessageVariantVersionNumber__c == null ? 1 : message.CurrentMessageVariantVersionNumber__c;
            CC_Message_Metadata__c metadataUpdate = CcMessageContentService.partialUpdate(message);
            Boolean changed = false;
            if (String.isBlank(versionId)) {
                versionId = CcMessageContentService.newGuid();
                metadataUpdate.CurrentMessageVariantVersionId__c = versionId;
                metadataUpdate.Current_Message_Variant_Version_Id__c = versionId;
                changed = true;
            }
            if (message.CurrentMessageVariantVersionNumber__c == null) {
                metadataUpdate.CurrentMessageVariantVersionNumber__c = versionNumber;
                changed = true;
            }
            if (message.Block_Count__c == null || message.Block_Count__c != sources.size()) {
                metadataUpdate.Block_Count__c = sources.size();
                changed = true;
            }
            if (changed) metadataUpdates.add(metadataUpdate);
            Integer order = 0;
            for (LegacyBlock source : sources) {
                order++;
                String messageBlockId = CcMessageContentService.newGuid();
                String jsonText = JSON.serialize(wrap(source, messageBlockId, order));
                CC_Message_Blocks__c row = new CC_Message_Blocks__c(
                    MessageBlockId__c = messageBlockId,
                    Message_Metadata__c = message.Id,
                    MessageName__c = message.MessageName__c,
                    MessageType__c = String.isNotBlank(message.Message_Type__c) ? message.Message_Type__c : message.Channel_Type__c,
                    MessageVariant__c = message.MessageVariant__c != null ? message.MessageVariant__c : message.Version__c,
                    MessageVariantId__c = variantId,
                    MessageVariantNumber__c = message.MessageVariant__c != null ? message.MessageVariant__c : message.Version__c,
                    MessageVariantVersionId__c = versionId,
                    MessageVariantVersionNumber__c = versionNumber,
                    ContentBlockOrder__c = order,
                    BlockType__c = source.blockType,
                    BlockTemplateDefinitionName__c = source.blockType,
                    ContentBuilderAssetId__c = source.assetId,
                    ContentBlockPath__c = source.assetPath,
                    UpdatedAt__c = Datetime.now(),
                    UpdatedBy__c = UserInfo.getName()
                );
                CcMessageContentService.putJson(row, jsonText);
                blockRows.add(row);
                CC_Message_History__c history = new CC_Message_History__c(
                    Message_Metadata__c = message.Id,
                    History_Key__c = (variantId + '|' + versionId + '|' + order).left(255),
                    MessageName__c = message.MessageName__c,
                    MessageType__c = row.MessageType__c,
                    MessageVariantId__c = variantId,
                    MessageVariantNumber__c = row.MessageVariantNumber__c,
                    MessageVariantVersionId__c = versionId,
                    MessageVariantVersionNumber__c = versionNumber,
                    ContentBlockOrder__c = order,
                    MessageBlockId__c = messageBlockId,
                    BlockTemplateDefinitionName__c = source.blockType,
                    BlockType__c = source.blockType,
                    Action__c = 'Migrated',
                    Commit_Comment__c = 'Migrated to Copy Center schema v1'
                );
                CcMessageContentService.putJson(history, jsonText);
                historyRows.add(history);
            }
            migratedVariants.add(variantId);
            migratedMessages++;
            migratedBlocks += sources.size();
        }

        Savepoint sp = Database.setSavepoint();
        try {
            if (deleteUnversioned && !migratedVariants.isEmpty()) {
                delete [
                    SELECT Id FROM CC_Message_Blocks__c
                    WHERE MessageVariantId__c IN :migratedVariants AND MessageVariantVersionId__c = null
                ];
            }
            if (!blockRows.isEmpty()) insert blockRows;
            if (!historyRows.isEmpty()) upsert historyRows History_Key__c;
            if (!metadataUpdates.isEmpty()) update metadataUpdates;
        } catch (Exception e) {
            Database.rollback(sp);
            errors.add(e.getMessage());
        }
    }

    public void finish(Database.BatchableContext context) {
        System.debug(LoggingLevel.INFO, 'CcMessageBlocksMigrationBatch: migrated ' + migratedMessages + ' message(s), '
            + migratedBlocks + ' block(s), skipped ' + skippedMessages + '. Errors: ' + String.join(errors, ' | '));
    }

    private class LegacyBlock {
        String blockType;
        String assetId;
        String assetPath;
        Object payload;
    }

    private static List<LegacyBlock> sourcesFor(CC_Message_Metadata__c message, List<CC_Message_Blocks_All__c> mirror) {
        List<LegacyBlock> result = new List<LegacyBlock>();
        if (mirror != null && !mirror.isEmpty()) {
            for (CC_Message_Blocks_All__c row : mirror) {
                LegacyBlock block = new LegacyBlock();
                block.blockType = row.BlockType__c;
                block.assetId = row.ContentBuilderAssetId__c;
                block.assetPath = row.ContentBlockPath__c;
                block.payload = parse(CcMessageContentService.joinJson(row.ContentJson__c, row.ContentJsonPart2__c));
                result.add(block);
            }
            return result;
        }
        Object canvas = parse(message.Canvas_Blocks_JSON__c);
        if (canvas instanceof List<Object>) {
            for (Object item : (List<Object>) canvas) {
                LegacyBlock block = new LegacyBlock();
                Map<String, Object> asMap = item instanceof Map<String, Object> ? (Map<String, Object>) item : new Map<String, Object>();
                Object type = asMap.containsKey('blockType') ? asMap.get('blockType') : asMap.get('type');
                block.blockType = type == null ? 'Block' : String.valueOf(type);
                block.payload = item;
                result.add(block);
            }
        }
        return result;
    }

    private static Object parse(String jsonText) {
        if (String.isBlank(jsonText)) return null;
        try {
            return JSON.deserializeUntyped(jsonText);
        } catch (Exception e) {
            return jsonText;
        }
    }

    private static Map<String, Object> wrap(LegacyBlock source, String messageBlockId, Integer order) {
        return new Map<String, Object>{
            'schemaVersion' => CcTemplateValidator.SCHEMA_VERSION,
            'messageBlockId' => messageBlockId,
            'blockTemplateDefinitionId' => null,
            'blockTemplateDefinitionName' => source.blockType,
            'contentTypes' => new List<String>(),
            'mceBlockAssetId' => source.assetId,
            'mceBlockAssetPath' => source.assetPath,
            'mcnBlockAssetId' => null,
            'mcnBlockAssetPath' => null,
            'blockOrderNumber' => order,
            'legacy' => source.payload,
            'blockConfig' => new Map<String, Object>{ 'sectionId' => 'block', 'blockSettings' => null, 'rows' => new List<Object>() }
        };
    }
}
