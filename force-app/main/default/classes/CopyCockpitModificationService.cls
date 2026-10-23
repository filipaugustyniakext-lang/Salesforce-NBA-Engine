/**
 * Stamps Copy Center audit fields on user-driven changes and schedules MCE DE pushes.
 */
public with sharing class CopyCockpitModificationService {
    /** MCE data extensions use MessageVariantId as the row primary key. */
    private static void ensureMceVariantId(CC_Message_Metadata__c record) {
        if (record == null) {
            return;
        }
        if (String.isNotBlank(record.MessageVariantId__c) && String.isNotBlank(record.Message_Variant_Id__c)) {
            return;
        }
        if (String.isNotBlank(record.MessageVariantId__c)) {
            record.Message_Variant_Id__c = record.MessageVariantId__c.trim();
            return;
        }
        if (String.isNotBlank(record.Message_Variant_Id__c)) {
            record.MessageVariantId__c = record.Message_Variant_Id__c.trim();
            return;
        }
        String guid = newMessageVariantGuid();
        record.MessageVariantId__c = guid;
        record.Message_Variant_Id__c = guid;
        if (record.MessageVariant__c == null && record.Version__c != null) {
            record.MessageVariant__c = record.Version__c;
        }
    }

    private static void ensureMceVariantIds(List<CC_Message_Metadata__c> records) {
        if (records == null) {
            return;
        }
        for (CC_Message_Metadata__c record : records) {
            ensureMceVariantId(record);
        }
    }

    private static String newMessageVariantGuid() {
        String hex = EncodingUtil.convertToHex(Crypto.generateAesKey(128)).toLowerCase();
        return hex.substring(0, 8) + '-'
            + hex.substring(8, 12) + '-'
            + hex.substring(12, 16) + '-'
            + hex.substring(16, 20) + '-'
            + hex.substring(20, 32);
    }

    public static void stampMetadata(CC_Message_Metadata__c record) {
        if (record == null) {
            return;
        }
        String actor = UserInfo.getName();
        Datetime now = System.now();
        record.MCE_Last_Modified_By__c = actor;
        record.LastModifiedBy__c = actor;
        record.MCE_Updated_At__c = now;
        record.UpdatedAt__c = now;
        record.LastModifiedAt__c = now;
    }

    public static void stampMetadata(List<CC_Message_Metadata__c> records) {
        if (records == null) {
            return;
        }
        for (CC_Message_Metadata__c record : records) {
            stampMetadata(record);
        }
    }

    public static void stampBlock(CC_Message_Blocks_All__c record) {
        if (record == null) {
            return;
        }
        record.UpdatedBy__c = UserInfo.getName();
        record.UpdatedAt__c = System.now();
    }

    public static void stampBlocks(List<CC_Message_Blocks_All__c> records) {
        if (records == null) {
            return;
        }
        for (CC_Message_Blocks_All__c record : records) {
            stampBlock(record);
        }
    }

    public static void insertMetadata(CC_Message_Metadata__c record) {
        if (record == null) {
            return;
        }
        ensureMceVariantId(record);
        stampMetadata(record);
        insert record;
        MarketingCloudCopySync.scheduleMetadataPush(new Set<Id>{ record.Id }, 'Create');
    }

    public static void insertMetadata(List<CC_Message_Metadata__c> records) {
        if (records == null || records.isEmpty()) {
            return;
        }
        ensureMceVariantIds(records);
        stampMetadata(records);
        insert records;
        Set<Id> ids = new Set<Id>();
        for (CC_Message_Metadata__c record : records) {
            if (record.Id != null) {
                ids.add(record.Id);
            }
        }
        MarketingCloudCopySync.scheduleMetadataPush(ids, 'Create');
    }

    public static void updateMetadata(List<CC_Message_Metadata__c> records) {
        if (records == null || records.isEmpty()) {
            return;
        }
        ensureMceVariantIds(records);
        stampMetadata(records);
        update records;
        Set<Id> ids = new Set<Id>();
        for (CC_Message_Metadata__c record : records) {
            if (record.Id != null) {
                ids.add(record.Id);
            }
        }
        MarketingCloudCopySync.scheduleMetadataPush(ids, 'Update');
    }

    public static void updateMetadata(CC_Message_Metadata__c record) {
        if (record == null) {
            return;
        }
        updateMetadata(new List<CC_Message_Metadata__c>{ record });
    }

    public static void upsertBlocks(List<CC_Message_Blocks_All__c> records) {
        if (records == null || records.isEmpty()) {
            return;
        }
        stampBlocks(records);
        upsert records;
        Set<Id> ids = new Set<Id>();
        for (CC_Message_Blocks_All__c record : records) {
            if (record.Id != null) {
                ids.add(record.Id);
            }
        }
        MarketingCloudCopySync.scheduleBlockPush(ids);
    }
}
