public with sharing class ChannelCooldownController {
    
    @AuraEnabled
    public static Channel_Cooldown_Period__c getChannelSettings(String channelName, String audienceType) {
        List<Channel_Cooldown_Period__c> records = [
            SELECT Id, Cooldown_Days__c, IsActive__c, Audience_Type__c
            FROM Channel_Cooldown_Period__c 
            WHERE Channel_Name__c = :channelName AND Audience_Type__c = :audienceType
            LIMIT 1
        ];
        return records.isEmpty() ? null : records[0];
    }

    @AuraEnabled
public static List<Channel_Cooldown_Period__c> getAllCooldownRecords() {
    return [
        SELECT Id, Channel_Name__c, Audience_Type__c, Cooldown_Days__c, IsActive__c, LastModifiedDate, LastModifiedBy.Name
        FROM Channel_Cooldown_Period__c
        ORDER BY Channel_Name__c ASC, Audience_Type__c ASC
    ];
}

    @AuraEnabled
    public static String upsertChannelSettings(String recordId, String channelName, String audienceType, Integer cooldownDays, Boolean isActive) {
        try {
            Channel_Cooldown_Period__c record = new Channel_Cooldown_Period__c();
            
            // Query defensively using natural parameters to locate existing entries
            List<Channel_Cooldown_Period__c> existing = [
                SELECT Id FROM Channel_Cooldown_Period__c 
                WHERE Channel_Name__c = :channelName AND Audience_Type__c = :audienceType 
                LIMIT 1
            ];
            
            if (!existing.isEmpty()) {
                record.Id = existing[0].Id;
            } else if (String.isNotBlank(recordId)) {
                record.Id = recordId;
            }
            
            // Map parameters to fields cleanly
            record.Channel_Name__c = channelName;
            record.Audience_Type__c = audienceType;
            record.Cooldown_Days__c = cooldownDays;
            record.IsActive__c = isActive;
            
            upsert record;
            return record.Id;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static List<HistoryWrapper> getCooldownHistory(String channelName, String audienceType) {
        List<HistoryWrapper> historyList = new List<HistoryWrapper>();
        
        List<Channel_Cooldown_Period__c> records = [
            SELECT Id FROM Channel_Cooldown_Period__c 
            WHERE Channel_Name__c = :channelName AND Audience_Type__c = :audienceType 
            LIMIT 1
        ];
        
        if(records.isEmpty()) return historyList;
        Id parentId = records[0].Id;

        List<Channel_Cooldown_Period__History> rawHistory = [
            SELECT CreatedBy.Name, CreatedDate, Field, OldValue, NewValue 
            FROM Channel_Cooldown_Period__History 
            WHERE ParentId = :parentId
            ORDER BY CreatedDate DESC 
            LIMIT 15
        ];

        for(Channel_Cooldown_Period__History h : rawHistory) {
            historyList.add(new HistoryWrapper(h, audienceType));
        }
        return historyList;
    }

    public class HistoryWrapper {
        @AuraEnabled public String user {get;set;}
        @AuraEnabled public DateTime changeDate {get;set;}
        @AuraEnabled public String audience {get;set;} 
        @AuraEnabled public String action {get;set;}

        public HistoryWrapper(Channel_Cooldown_Period__History historyRecord, String audienceType) {
            this.user = historyRecord.CreatedBy.Name;
            this.changeDate = historyRecord.CreatedDate;
            this.audience = audienceType;
            
            String fieldLabel = '';
            if(historyRecord.Field == 'Cooldown_Days__c') fieldLabel = 'Cooldown Period';
            else if(historyRecord.Field == 'IsActive__c') fieldLabel = 'Rule Status';
            else if(historyRecord.Field == 'Audience_Type__c') fieldLabel = 'Target Segment';
            else fieldLabel = historyRecord.Field;
            
            if(historyRecord.Field == 'created') {
                this.action = 'Created initial tracking configuration rule.';
            } else {
                this.action = 'Changed ' + fieldLabel + ' from "' + historyRecord.OldValue + '" to "' + historyRecord.NewValue + '".';
            }
        }
    }
}