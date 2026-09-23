public with sharing class CopyCockpitController {

    @AuraEnabled(cacheable=false)
    public static List<CC_Message_Metadata__c> getMessagesByChannelType(String channelType) {
        if (String.isBlank(channelType)) return new List<CC_Message_Metadata__c>();
        return [
            SELECT Id, Name,
                   Channel__c, Channel_Type__c,
                   Status__c,
                   Subject__c,
                   Version__c,
                   Language__c,
                   Valid_From__c, Valid_To__c,
                   Offer__c, Offer__r.Name,
                   Campaign__c, Campaign__r.Name,
                   Is_Active__c,
                   Block_Count__c,
                   Display_Probability__c,
                   Display_Probability_Manual__c,
                   Scheduled_Action__c,
                   Scheduled_At__c,
                   Scheduled_Status__c,
                   Scheduled_From_Status__c,
                   Scheduled_To_Status__c,
                   Message_Variant_Id__c,
                   Message_Variant__c,
                   Published_At__c,
                   MCE_Updated_At__c,
                   MCE_Last_Modified_By__c,
                   CreatedDate, LastModifiedDate
            FROM CC_Message_Metadata__c
            WHERE Channel_Type__c = :channelType
            ORDER BY Name ASC, Version__c ASC NULLS LAST
            LIMIT 2000
        ];
    }

    /** Returns saved-version counts grouped by CC_Message_Metadata__c parent Id.
     *  Returns empty map until CC_Message_Versions__c object exists.
     */
    @AuraEnabled(cacheable=false)
    public static Map<String, Integer> getVersionCountsByMessageIds(List<String> messageIds) {
        Map<String, Integer> counts = new Map<String, Integer>();
        if (messageIds == null || messageIds.isEmpty()) return counts;
        for (String mid : messageIds) counts.put(mid, 0);
        return counts;
    }

    @AuraEnabled(cacheable=true)
    public static List<Offer__c> getActiveOffers() {
        return [
            SELECT Id, Name, Country_Code__c
            FROM Offer__c
            WHERE Is_Active__c = true
            ORDER BY Name ASC
            LIMIT 1000
        ];
    }

    @AuraEnabled(cacheable=true)
    public static List<Marketing_Dictionary__c> getProductFamilies() {
        return [
            SELECT Id, Name
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Product'
            AND Dictionary_Sub_Type__c = 'Product Family'
            ORDER BY Name ASC
            LIMIT 500
        ];
    }

    @AuraEnabled(cacheable=true)
    public static List<Channel_Banner_Placement__c> getPlaceholders() {
        return [
            SELECT Id, Name
            FROM Channel_Banner_Placement__c
            ORDER BY Name ASC
            LIMIT 200
        ];
    }

    @AuraEnabled(cacheable=false)
    public static List<Offer__c> getActiveOffersByFamily(String familyName) {
        if (String.isBlank(familyName)) return new List<Offer__c>();
        Set<Id> offerIds = new Set<Id>();
        for (Offer_Version__c v : [
            SELECT Offer_Lookup__c
            FROM Offer_Version__c
            WHERE Is_Active__c = true
            AND Product_Family_Name__c = :familyName
            AND Offer_Lookup__c != null
        ]) {
            offerIds.add(v.Offer_Lookup__c);
        }
        if (offerIds.isEmpty()) return new List<Offer__c>();
        return [
            SELECT Id, Name, Country_Code__c
            FROM Offer__c
            WHERE Id IN :offerIds
            AND Is_Active__c = true
            ORDER BY Name ASC
            LIMIT 500
        ];
    }

    @AuraEnabled(cacheable=false)
    public static void saveMasterRowSettings(String settingsJson) {
        try {
            Map<String, Object> data = (Map<String, Object>) JSON.deserializeUntyped(settingsJson);
            String offerId = (String) data.get('offerId');
            List<Object> variantsList = (List<Object>) data.get('variants');

            List<CC_Message_Metadata__c> toUpdate = new List<CC_Message_Metadata__c>();
            for (Object varObj : variantsList) {
                Map<String, Object> varData = (Map<String, Object>) varObj;
                CC_Message_Metadata__c rec = new CC_Message_Metadata__c();
                rec.Id = (Id) varData.get('id');
                rec.Offer__c = String.isNotBlank(offerId) ? (Id) offerId : null;
                Object prob = varData.get('probability');
                rec.Display_Probability_Manual__c = prob != null
                    ? Decimal.valueOf(String.valueOf(prob))
                    : null;
                toUpdate.add(rec);
            }

            if (!toUpdate.isEmpty()) update toUpdate;
        } catch (Exception e) {
            throw new AuraHandledException('Save failed: ' + e.getMessage());
        }
    }

    /** Returns all taken variant numbers for a given message name + channel type. */
    @AuraEnabled(cacheable=false)
    public static List<Decimal> getExistingVariants(String messageName, String channelType) {
        if (String.isBlank(messageName) || String.isBlank(channelType)) return new List<Decimal>();
        List<CC_Message_Metadata__c> rows = [
            SELECT Version__c
            FROM CC_Message_Metadata__c
            WHERE Name = :messageName
              AND Channel_Type__c = :channelType
            ORDER BY Version__c ASC NULLS LAST
        ];
        List<Decimal> variants = new List<Decimal>();
        for (CC_Message_Metadata__c r : rows) {
            if (r.Version__c != null) variants.add(r.Version__c);
        }
        return variants;
    }

    @AuraEnabled(cacheable=false)
    public static CC_Message_Metadata__c getMessageById(Id recordId) {
        return [
            SELECT Id, Name,
                   Channel__c, Channel_Type__c,
                   Status__c,
                   Subject__c, Body__c,
                   Version__c,
                   Language__c,
                   Valid_From__c, Valid_To__c,
                   Offer__c, Offer__r.Name,
                   Campaign__c, Campaign__r.Name,
                   CreatedDate, LastModifiedDate
            FROM CC_Message_Metadata__c
            WHERE Id = :recordId
            LIMIT 1
        ];
    }

    @AuraEnabled
    public static Id createMessage(String messageJson) {
        try {
            Map<String, Object> data = (Map<String, Object>) JSON.deserializeUntyped(messageJson);
            CC_Message_Metadata__c rec = new CC_Message_Metadata__c();
            rec.Name           = (String)  data.get('messageName');
            rec.Version__c     = data.get('version') != null ? Decimal.valueOf(String.valueOf(data.get('version'))) : 1;
            rec.Language__c    = (String)  data.get('language');
            rec.Channel__c     = (String)  data.get('channelName');
            rec.Channel_Type__c = (String) data.get('channelType');
            rec.Status__c      = 'Draft';
            if (data.get('offerId') != null && String.isNotBlank((String) data.get('offerId'))) {
                rec.Offer__c = (Id) data.get('offerId');
            }
            if (data.get('messageSubtype') != null) {
                rec.Subject__c = (String) data.get('messageSubtype');
            }
            insert rec;
            return rec.Id;
        } catch (Exception e) {
            throw new AuraHandledException('Create failed: ' + e.getMessage());
        }
    }

    @AuraEnabled
    public static Id cloneMessage(Id sourceId, Decimal newVersion) {
        try {
            CC_Message_Metadata__c src = [
                SELECT Name, Channel__c, Channel_Type__c,
                       Subject__c, Body__c, Language__c,
                       Offer__c, Campaign__c,
                       Valid_From__c, Valid_To__c
                FROM CC_Message_Metadata__c
                WHERE Id = :sourceId
                LIMIT 1
            ];
            CC_Message_Metadata__c copy = src.clone(false, false, false, false);
            copy.Version__c = newVersion;
            copy.Status__c  = 'Draft';
            insert copy;
            return copy.Id;
        } catch (Exception e) {
            throw new AuraHandledException('Clone failed: ' + e.getMessage());
        }
    }

    @AuraEnabled
    public static void renameMessageGroup(String oldName, String newName, String channelType) {
        if (String.isBlank(oldName) || String.isBlank(newName) || String.isBlank(channelType)) {
            throw new AuraHandledException('Invalid rename parameters.');
        }
        List<CC_Message_Metadata__c> rows = [
            SELECT Id, Name
            FROM CC_Message_Metadata__c
            WHERE Name = :oldName
              AND Channel_Type__c = :channelType
        ];
        for (CC_Message_Metadata__c r : rows) {
            r.Name = newName;
        }
        try {
            update rows;
        } catch (DmlException e) {
            throw new AuraHandledException('Rename failed: ' + e.getDmlMessage(0));
        }
    }

    @AuraEnabled
    public static void deleteMessage(Id recordId) {
        try {
            delete new CC_Message_Metadata__c(Id = recordId);
        } catch (DmlException e) {
            throw new AuraHandledException('Delete failed: ' + e.getDmlMessage(0));
        }
    }

    // ── Version History ───────────────────────────────────────────────────────

    public class MessageVersion {
        @AuraEnabled public String   id;
        @AuraEnabled public String   name;
        @AuraEnabled public String   status;
        @AuraEnabled public String   triggerAction;
        @AuraEnabled public String   deploymentNote;
        @AuraEnabled public String   blocksJson;
        @AuraEnabled public DateTime createdDate;
        @AuraEnabled public String   createdByName;
    }

    /**
     * Returns version snapshots for a message variant, newest first.
     * Uses dynamic SOQL so the class compiles even before CC_Message_Versions__c is deployed.
     */
    @AuraEnabled(cacheable=false)
    public static List<MessageVersion> getVersionsByMessageId(Id messageId) {
        if (messageId == null) return new List<MessageVersion>();
        try {
            List<SObject> rows = Database.query(
                'SELECT Id, Name, Status__c, Trigger_Action__c,' +
                ' Deployment_Note__c, Canvas_Blocks_JSON__c,' +
                ' CreatedDate, CreatedBy.Name' +
                ' FROM CC_Message_Versions__c' +
                ' WHERE Message_Variant__c = :messageId' +
                ' ORDER BY CreatedDate DESC LIMIT 200'
            );
            List<MessageVersion> result = new List<MessageVersion>();
            for (SObject row : rows) {
                MessageVersion v = new MessageVersion();
                v.id            = (String) row.get('Id');
                v.name          = (String) row.get('Name');
                v.status        = (String) row.get('Status__c');
                v.triggerAction = (String) row.get('Trigger_Action__c');
                v.deploymentNote = (String) row.get('Deployment_Note__c');
                v.blocksJson    = (String) row.get('Canvas_Blocks_JSON__c');
                v.createdDate   = (DateTime) row.get('CreatedDate');
                SObject user    = row.getSObject('CreatedBy');
                v.createdByName = user != null ? (String) user.get('Name') : null;
                result.add(v);
            }
            return result;
        } catch (Exception e) {
            // Object may not exist yet — return empty list gracefully
            return new List<MessageVersion>();
        }
    }
}
