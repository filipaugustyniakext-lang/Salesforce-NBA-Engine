/**
 * Stamps Copy Center audit fields on user-driven changes and schedules MCE DE pushes.
 */
public with sharing class CopyCockpitModificationService {
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
        stampMetadata(record);
        insert record;
        MarketingCloudCopySync.scheduleMetadataPush(new Set<Id>{ record.Id });
    }

    public static void insertMetadata(List<CC_Message_Metadata__c> records) {
        if (records == null || records.isEmpty()) {
            return;
        }
        stampMetadata(records);
        insert records;
        Set<Id> ids = new Set<Id>();
        for (CC_Message_Metadata__c record : records) {
            if (record.Id != null) {
                ids.add(record.Id);
            }
        }
        MarketingCloudCopySync.scheduleMetadataPush(ids);
    }

    public static void updateMetadata(List<CC_Message_Metadata__c> records) {
        if (records == null || records.isEmpty()) {
            return;
        }
        stampMetadata(records);
        update records;
        Set<Id> ids = new Set<Id>();
        for (CC_Message_Metadata__c record : records) {
            if (record.Id != null) {
                ids.add(record.Id);
            }
        }
        MarketingCloudCopySync.scheduleMetadataPush(ids);
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