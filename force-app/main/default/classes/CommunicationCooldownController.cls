public with sharing class CommunicationCooldownController {
    
    @AuraEnabled
    public static Communication_Cooldown_Period__c getChannelSettings(String cooldownCategory, String nameValue, String audienceType) {
        List<Communication_Cooldown_Period__c> records = [
            SELECT Id, Cooldown_Days__c, IsActive__c, Audience_Type__c, Cooldown_Category__c, Name__c
            FROM Communication_Cooldown_Period__c 
            WHERE Cooldown_Category__c = :cooldownCategory AND Name__c = :nameValue AND Audience_Type__c = :audienceType
            WITH SECURITY_ENFORCED
            LIMIT 1
        ];
        return records.isEmpty() ? null : records[0];
    }

    @AuraEnabled
    public static List<Communication_Cooldown_Period__c> getAllCooldownRecords() {
        return [
            SELECT Id, Cooldown_Category__c, Name__c, Audience_Type__c, Cooldown_Days__c, IsActive__c, LastModifiedDate, LastModifiedBy.Name
            FROM Communication_Cooldown_Period__c
            WITH SECURITY_ENFORCED
            ORDER BY Cooldown_Category__c ASC, Name__c ASC, Audience_Type__c ASC
        ];
    }

    @AuraEnabled
    public static String upsertChannelSettings(String recordId, String cooldownCategory, String nameValue, String audienceType, Integer cooldownDays, Boolean isActive) {
        try {
            Communication_Cooldown_Period__c record = new Communication_Cooldown_Period__c();
            
            // Query defensively using unique matching parameters to find existing rules
            List<Communication_Cooldown_Period__c> existing = [
                SELECT Id FROM Communication_Cooldown_Period__c 
                WHERE Cooldown_Category__c = :cooldownCategory AND Name__c = :nameValue AND Audience_Type__c = :audienceType 
                WITH SECURITY_ENFORCED
                LIMIT 1
            ];
            
            if (!existing.isEmpty()) {
                record.Id = existing[0].Id;
            } else if (String.isNotBlank(recordId)) {
                record.Id = recordId;
            }
            
            // Map parameters to fields cleanly using standard double-underscore names
            record.Cooldown_Category__c = cooldownCategory;
            record.Name__c = nameValue;
            record.Audience_Type__c = audienceType;
            record.Cooldown_Days__c = cooldownDays;
            record.IsActive__c = isActive;
            
            upsert as user record;
            return record.Id;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static List<HistoryWrapper> getCooldownHistory(String cooldownCategory, String nameValue, String audienceType) {
        List<HistoryWrapper> historyList = new List<HistoryWrapper>();
        
        List<Communication_Cooldown_Period__c> records = [
            SELECT Id FROM Communication_Cooldown_Period__c 
            WHERE Cooldown_Category__c = :cooldownCategory AND Name__c = :nameValue AND Audience_Type__c = :audienceType 
            WITH SECURITY_ENFORCED
            LIMIT 1
        ];
        
        if(records.isEmpty()) return historyList;
        Id parentId = records[0].Id;

        List<Communication_Cooldown_Period__History> rawHistory = [
            SELECT CreatedBy.Name, CreatedDate, Field, OldValue, NewValue 
            FROM Communication_Cooldown_Period__History 
            WHERE ParentId = :parentId
            ORDER BY CreatedDate DESC 
            LIMIT 15
        ];

        for(Communication_Cooldown_Period__History h : rawHistory) {
            historyList.add(new HistoryWrapper(h, audienceType));
        }
        return historyList;
    }

    public class HistoryWrapper {
        @AuraEnabled public String user {get;set;}
        @AuraEnabled public DateTime changeDate {get;set;}
        @AuraEnabled public String audience {get;set;} 
        @AuraEnabled public String action {get;set;}

        public HistoryWrapper(Communication_Cooldown_Period__History historyRecord, String audienceType) {
            this.user = historyRecord.CreatedBy.Name;
            this.changeDate = historyRecord.CreatedDate;
            this.audience = audienceType;
            
            String fieldLabel = '';
            if(historyRecord.Field == 'Cooldown_Days__c') fieldLabel = 'Cooldown Period';
            else if(historyRecord.Field == 'IsActive__c') fieldLabel = 'Rule Status';
            else if(historyRecord.Field == 'Audience_Type__c') fieldLabel = 'Audience Type';
            else if(historyRecord.Field == 'Cooldown_Category__c') fieldLabel = 'Cooldown Category';
            else if(historyRecord.Field == 'Name__c') fieldLabel = 'Name';
            else fieldLabel = historyRecord.Field;
            
            if(historyRecord.Field == 'created') {
                this.action = 'Created initial tracking configuration rule.';
            } else {
                this.action = 'Changed ' + fieldLabel + ' from "' + historyRecord.OldValue + '" to "' + historyRecord.NewValue + '".';
            }
        }
    }
}