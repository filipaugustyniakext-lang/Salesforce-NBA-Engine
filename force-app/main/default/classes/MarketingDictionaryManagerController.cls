/**
 * @AuraEnabled controller for the Marketing Dictionary Management app.
 * Provides CRUD operations for all Marketing_Dictionary__c record types
 * and their child records (Channel_Cooldown__c, Offer_Attribute_Rule__c).
 * Isolated from MarketingDictionaryController — zero overlap with existing wiring.
 */
public with sharing class MarketingDictionaryManagerController {

    // ─── Product RT ──────────────────────────────────────────────────────────

    /**
     * Returns all Product dictionary records (Product Family + Family of Needs).
     * @return List of Marketing_Dictionary__c with Product record type
     */
    @AuraEnabled(cacheable=true)
    public static List<Marketing_Dictionary__c> getProductRecords() {
        return [
            SELECT Id, Name, Dictionary_Sub_Type__c,
                   Related_Family_of_Needs__c, Related_Family_of_Needs__r.Name,
                   Related_Product_Type__c, Related_Product_Type__r.Name
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Product'
            ORDER BY Dictionary_Sub_Type__c ASC, Name ASC
            LIMIT 1000
        ];
    }

    /**
     * Non-cacheable Product catalogue for Scoring Model offering pickers.
     * Returns Id + Name so consumers store Ids (SSOT) and always show the current label.
     */
    @AuraEnabled
    public static List<Marketing_Dictionary__c> getProductOfferingCatalogue() {
        return [
            SELECT Id, Name, Dictionary_Sub_Type__c,
                   Related_Family_of_Needs__c, Related_Family_of_Needs__r.Name,
                   Related_Product_Type__c, Related_Product_Type__r.Name
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Product'
            AND Dictionary_Sub_Type__c IN ('Product Family', 'Family of Needs')
            ORDER BY Dictionary_Sub_Type__c ASC, Name ASC
            LIMIT 1000
        ];
    }

    /**
     * Upserts a single Product dictionary record (used for edits).
     * @param record Marketing_Dictionary__c to upsert
     * @return Saved record Id
     */
    @AuraEnabled
    public static Id saveProductRecord(Marketing_Dictionary__c record) {
        try {
            Id productRecordTypeId = getRecordTypeId('Product');
            record.RecordTypeId = productRecordTypeId;
            String oldName = null;
            if (record.Id != null) {
                List<Marketing_Dictionary__c> existing = [
                    SELECT Id, Name, Dictionary_Sub_Type__c
                    FROM Marketing_Dictionary__c
                    WHERE Id = :record.Id
                    LIMIT 1
                ];
                if (!existing.isEmpty()) {
                    oldName = existing[0].Name;
                    if (String.isBlank(record.Dictionary_Sub_Type__c)) {
                        record.Dictionary_Sub_Type__c = existing[0].Dictionary_Sub_Type__c;
                    }
                }
            }
            upsert record;
            if (record.Id != null
                && String.isNotBlank(record.Name)
                && oldName != record.Name
                && (record.Dictionary_Sub_Type__c == 'Product Family'
                    || record.Dictionary_Sub_Type__c == 'Family of Needs')) {
                CampaignOfferingLabelSync.onDictionaryRename(
                    record.Id, oldName, record.Name, record.Dictionary_Sub_Type__c
                );
            }
            return record.Id;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Inserts multiple Product dictionary records in a single DML call.
     * Used when the user defines several Family of Needs or Product Family values at once.
     * @param recordsJson JSON array of Marketing_Dictionary__c records
     */
    @AuraEnabled
    public static void saveProductRecordsBulk(String recordsJson) {
        try {
            List<Marketing_Dictionary__c> records = (List<Marketing_Dictionary__c>)
                JSON.deserialize(recordsJson, List<Marketing_Dictionary__c>.class);
            Id productRecordTypeId = getRecordTypeId('Product');
            for (Marketing_Dictionary__c rec : records) {
                rec.RecordTypeId = productRecordTypeId;
            }
            upsert records;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Deletes a Marketing_Dictionary__c record by Id.
     * @param recordId Id of the record to delete
     */
    @AuraEnabled
    public static void deleteDictionaryRecord(Id recordId) {
        try {
            Marketing_Dictionary__c rec = [
                SELECT Id FROM Marketing_Dictionary__c WHERE Id = :recordId WITH SECURITY_ENFORCED LIMIT 1
            ];
            delete rec;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    // ─── Person RT ───────────────────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static List<Marketing_Dictionary__c> getPersonRecords() {
        return [
            SELECT Id, Name, Dictionary_Sub_Type__c
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Product'
            AND Dictionary_Sub_Type__c IN ('Customer Type', 'Audience Type')
            ORDER BY Dictionary_Sub_Type__c ASC, Name ASC
            LIMIT 1000
        ];
    }

    // ─── Channel RT ──────────────────────────────────────────────────────────

    /**
     * Returns all Channel dictionary records with their cooldown child rows.
     * @return List of Marketing_Dictionary__c with Channel record type
     */
    @AuraEnabled(cacheable=true)
    public static List<Marketing_Dictionary__c> getChannelRecords() {
        return [
            SELECT Id, Name, Channel_Type__c, Channel_Icon__c, Is_Active__c,
                (SELECT Id, Audience_Type_Dict__c, Audience_Type_Dict__r.Name, Cooldown_Days__c FROM Channel_Cooldowns__r ORDER BY Audience_Type_Dict__r.Name ASC),
                (SELECT Id, Day_Of_Week__c, Is_Fully_Blocked__c, Blocked_From_Hour__c, Blocked_To_Hour__c
                 FROM Blackout_Day_Rules__r ORDER BY Day_Of_Week__c ASC),
                (SELECT Id, Name, Description__c, Image_URL__c FROM Channel_Banner_Types__r ORDER BY Name ASC),
                (SELECT Id, Name, App_Screen__c, Banner_Type__c, Banner_Type__r.Name, Position_Description__c
                 FROM Channel_Banner_Placements__r ORDER BY App_Screen__c ASC, Name ASC),
                (SELECT Id, Name FROM Channel_Banner_Intent_Targets__r ORDER BY Name ASC),
                (SELECT Id, Name, Intent_Target__c, Intent_Target__r.Name
                 FROM Channel_Banner_Intents__r ORDER BY Intent_Target__r.Name ASC, Name ASC)
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Channel'
            ORDER BY Channel_Type__c ASC, Name ASC
            LIMIT 1000
        ];
    }

    /**
     * Upserts a Channel_Banner_Type__c record.
     * @param bannerTypeJson JSON-serialized Channel_Banner_Type__c
     * @return Saved record Id
     */
    @AuraEnabled
    public static Id saveBannerType(String bannerTypeJson) {
        try {
            Channel_Banner_Type__c rec = (Channel_Banner_Type__c)
                JSON.deserialize(bannerTypeJson, Channel_Banner_Type__c.class);
            upsert rec;
            return rec.Id;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Deletes a Channel_Banner_Type__c record.
     * @param recordId Id to delete
     */
    @AuraEnabled
    public static void deleteBannerType(Id recordId) {
        try {
            Channel_Banner_Type__c rec = [SELECT Id FROM Channel_Banner_Type__c WHERE Id = :recordId LIMIT 1];
            delete rec;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Upserts a single Channel_Banner_Placement__c record.
     * @param placementJson JSON-serialized Channel_Banner_Placement__c
     * @return Saved record Id
     */
    @AuraEnabled
    public static Id saveBannerPlacement(String placementJson) {
        try {
            Channel_Banner_Placement__c rec = (Channel_Banner_Placement__c)
                JSON.deserialize(placementJson, Channel_Banner_Placement__c.class);
            upsert rec;
            return rec.Id;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Bulk-inserts multiple Channel_Banner_Placement__c records.
     * @param placementsJson JSON array of Channel_Banner_Placement__c
     */
    @AuraEnabled
    public static void saveBannerPlacementsBulk(String placementsJson) {
        try {
            List<Channel_Banner_Placement__c> recs = (List<Channel_Banner_Placement__c>)
                JSON.deserialize(placementsJson, List<Channel_Banner_Placement__c>.class);
            upsert recs;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Deletes a Channel_Banner_Placement__c record.
     * @param recordId Id to delete
     */
    @AuraEnabled
    public static void deleteBannerPlacement(Id recordId) {
        try {
            Channel_Banner_Placement__c rec = [SELECT Id FROM Channel_Banner_Placement__c WHERE Id = :recordId LIMIT 1];
            delete rec;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    // ─── Banner Intent Targets ───────────────────────────────────────────────

    @AuraEnabled
    public static Id saveIntentTarget(String intentTargetJson) {
        try {
            Channel_Banner_Intent_Target__c rec = (Channel_Banner_Intent_Target__c)
                JSON.deserialize(intentTargetJson, Channel_Banner_Intent_Target__c.class);
            upsert rec;
            return rec.Id;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void deleteIntentTarget(Id recordId) {
        try {
            Channel_Banner_Intent_Target__c rec = [SELECT Id FROM Channel_Banner_Intent_Target__c WHERE Id = :recordId LIMIT 1];
            delete rec;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    // ─── Banner Intents ──────────────────────────────────────────────────────

    @AuraEnabled
    public static Id saveBannerIntent(String intentJson) {
        try {
            Channel_Banner_Intent__c rec = (Channel_Banner_Intent__c)
                JSON.deserialize(intentJson, Channel_Banner_Intent__c.class);
            upsert rec;
            return rec.Id;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void saveBannerIntentsBulk(String intentsJson) {
        try {
            List<Channel_Banner_Intent__c> recs = (List<Channel_Banner_Intent__c>)
                JSON.deserialize(intentsJson, List<Channel_Banner_Intent__c>.class);
            upsert recs;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void deleteBannerIntent(Id recordId) {
        try {
            Channel_Banner_Intent__c rec = [SELECT Id FROM Channel_Banner_Intent__c WHERE Id = :recordId LIMIT 1];
            delete rec;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Upserts a Channel dictionary record.
     * @param record Serialized Marketing_Dictionary__c JSON
     * @return Saved record Id
     */
    @AuraEnabled
    public static Id saveChannelRecord(Marketing_Dictionary__c record) {
        try {
            Id channelRecordTypeId = getRecordTypeId('Channel');
            record.RecordTypeId = channelRecordTypeId;
            if (record.Id == null && record.Is_Active__c == null) {
                record.Is_Active__c = true;
            }
            upsert record;
            return record.Id;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Activates or deactivates a channel. Deactivated channels are added to every
     * blackout date so existing campaigns cannot send through them.
     */
    @AuraEnabled
    public static void toggleChannelActive(Id channelId, Boolean isActive) {
        if (channelId == null || isActive == null) {
            throw new AuraHandledException('Channel and active state are required.');
        }
        try {
            Marketing_Dictionary__c channel = [
                SELECT Id, Name
                FROM Marketing_Dictionary__c
                WHERE Id = :channelId
                AND RecordType.DeveloperName = 'Channel'
                LIMIT 1
            ];
            channel.Is_Active__c = isActive;
            update channel;

            if (!isActive) {
                List<Blackout_Window__c> windows = [
                    SELECT Id, Assigned_Channels__c
                    FROM Blackout_Window__c
                ];
                for (Blackout_Window__c window : windows) {
                    Set<String> assigned = new Set<String>();
                    if (String.isNotBlank(window.Assigned_Channels__c)) {
                        for (String channelName : window.Assigned_Channels__c.split(';')) {
                            if (String.isNotBlank(channelName)) assigned.add(channelName.trim());
                        }
                    }
                    assigned.add(channel.Name);
                    List<String> sortedChannels = new List<String>(assigned);
                    sortedChannels.sort();
                    window.Assigned_Channels__c = String.join(sortedChannels, ';');
                }
                if (!windows.isEmpty()) update windows;
            }
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Upserts a Channel_Cooldown__c child record from a JSON string.
     * @param cooldownJson JSON-serialized Channel_Cooldown__c
     * @return Saved record Id
     */
    @AuraEnabled
    public static Id saveCooldownRecord(String cooldownJson) {
        try {
            Channel_Cooldown__c cooldown = (Channel_Cooldown__c) JSON.deserialize(cooldownJson, Channel_Cooldown__c.class);
            upsert cooldown;
            return cooldown.Id;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Deletes a Channel_Cooldown__c record.
     * @param cooldownId Id of the cooldown record to delete
     */
    @AuraEnabled
    public static void deleteCooldownRecord(Id cooldownId) {
        try {
            Channel_Cooldown__c rec = [
                SELECT Id FROM Channel_Cooldown__c WHERE Id = :cooldownId WITH SECURITY_ENFORCED LIMIT 1
            ];
            delete rec;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    // ─── Campaign RT ─────────────────────────────────────────────────────────

    /**
     * Returns all Campaign dictionary records (Topics, Sales Process Types, Activation Paths,
     * Scoring Models, Scoring Model Groups, Campaign Types/Groups).
     * @return List of Marketing_Dictionary__c with Campaign record type
     */
    @AuraEnabled(cacheable=true)
    public static List<Marketing_Dictionary__c> getCampaignRecords() {
        return [
            SELECT Id, Name, Dictionary_Sub_Type__c, Topic_Description__c,
                   Include_In_Emergency__c, Is_Active__c, Distribution_Percent__c,
                   Topic_Group_Dict__c, Topic_Group_Dict__r.Name,
                   Define_Campaign_Groups__c,
                   Campaign_Type_Dict__c, Campaign_Type_Dict__r.Name,
                   Version__c, Model_Id__c, Model_Expiration_Date__c,
                   Scoring_Model_Group_Dict__c, Scoring_Model_Group_Dict__r.Name,
                   Assigned_Topic_Dict__c, Assigned_Topic_Dict__r.Name,
                   Offering_Type__c, Product_Family__c, Family_of_Needs__c,
                   CreatedDate, LastModifiedDate, CreatedById, CreatedBy.Name
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Campaign'
            ORDER BY Dictionary_Sub_Type__c ASC, Name ASC, Version__c ASC NULLS LAST
            LIMIT 2000
        ];
    }

    /**
     * Upserts a Scoring Model dictionary row with versioning and uniqueness rules:
     * - New master (asNewMaster=true): Version = 1; Name must not already exist
     * - New version (asNewMaster=false, no Id): Version = max(existing) + 1; Name must exist
     * - Edit (has Id): Name and Version are locked to existing values
     * - Model_Id__c = Name + '_' + Version (unique)
     */
    @AuraEnabled
    public static Id saveScoringModel(Marketing_Dictionary__c record, Boolean asNewMaster) {
        try {
            if (record == null) {
                throw new AuraHandledException('Scoring Model record is required.');
            }
            String modelName = record.Name == null ? '' : record.Name.trim();
            if (String.isBlank(modelName)) {
                throw new AuraHandledException('Model Name is required.');
            }
            record.Name = modelName;
            record.Dictionary_Sub_Type__c = 'Scoring Model';
            record.RecordTypeId = getRecordTypeId('Campaign');

            if (record.Scoring_Model_Group_Dict__c == null) {
                throw new AuraHandledException('Model Group is required.');
            }
            if (record.Assigned_Topic_Dict__c == null) {
                throw new AuraHandledException('Assigned Topic is required.');
            }

            // Lookup filters unavailable (object at Salesforce max of 5) — validate subtypes in Apex.
            Marketing_Dictionary__c groupRec = [
                SELECT Id, Dictionary_Sub_Type__c
                FROM Marketing_Dictionary__c
                WHERE Id = :record.Scoring_Model_Group_Dict__c
                LIMIT 1
            ];
            if (groupRec.Dictionary_Sub_Type__c != 'Scoring Model Group') {
                throw new AuraHandledException('Model Group must be a Scoring Model Group dictionary entry.');
            }
            Marketing_Dictionary__c topicRec = [
                SELECT Id, Dictionary_Sub_Type__c
                FROM Marketing_Dictionary__c
                WHERE Id = :record.Assigned_Topic_Dict__c
                LIMIT 1
            ];
            if (topicRec.Dictionary_Sub_Type__c != 'Topic') {
                throw new AuraHandledException('Assigned Topic must be a Topic dictionary entry.');
            }

            if (String.isBlank(record.Offering_Type__c)) {
                throw new AuraHandledException('Offering Type is required.');
            }
            if (record.Offering_Type__c == 'Product Family') {
                if (String.isBlank(record.Product_Family__c)) {
                    throw new AuraHandledException('Select at least one Product Family.');
                }
                record.Product_Family__c = normalizeOfferingIds(
                    record.Product_Family__c, 'Product Family'
                );
                record.Family_of_Needs__c = null;
            } else if (record.Offering_Type__c == 'Family of Needs') {
                if (String.isBlank(record.Family_of_Needs__c)) {
                    throw new AuraHandledException('Select at least one Family of Needs.');
                }
                record.Family_of_Needs__c = normalizeOfferingIds(
                    record.Family_of_Needs__c, 'Family of Needs'
                );
                record.Product_Family__c = null;
            } else {
                throw new AuraHandledException('Offering Type must be Product Family or Family of Needs.');
            }

            if (record.Id != null) {
                Marketing_Dictionary__c existing = [
                    SELECT Id, Name, Version__c
                    FROM Marketing_Dictionary__c
                    WHERE Id = :record.Id
                    LIMIT 1
                ];
                // Name and Version are immutable after create.
                record.Name = existing.Name;
                record.Version__c = existing.Version__c;
            } else {
                List<AggregateResult> agg = [
                    SELECT MAX(Version__c) maxVer
                    FROM Marketing_Dictionary__c
                    WHERE RecordType.DeveloperName = 'Campaign'
                    AND Dictionary_Sub_Type__c = 'Scoring Model'
                    AND Name = :modelName
                ];
                Decimal maxVer = (Decimal) agg[0].get('maxVer');
                Boolean nameExists = maxVer != null;

                if (asNewMaster == true) {
                    if (nameExists) {
                        throw new AuraHandledException(
                            'A Scoring Model named "' + modelName + '" already exists. ' +
                            'Use New Version on the existing model, or choose a unique name.'
                        );
                    }
                    record.Version__c = 1;
                } else if (nameExists) {
                    record.Version__c = maxVer + 1;
                } else {
                    // First version of this name (implicit master create)
                    record.Version__c = 1;
                }
            }

            record.Model_Id__c = modelName + '_' + String.valueOf(record.Version__c.intValue());
            if (record.Is_Active__c == null) {
                record.Is_Active__c = true;
            }

            upsert record;
            return record.Id;
        } catch (AuraHandledException ahe) {
            throw ahe;
        } catch (DmlException dml) {
            String msg = dml.getDmlMessage(0);
            if (msg != null && msg.toLowerCase().contains('duplicate')) {
                throw new AuraHandledException(
                    'A Scoring Model with this Name/Version (Model ID) already exists.'
                );
            }
            throw new AuraHandledException(msg);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Returns the next version number for a Scoring Model name (1 if none exist).
     */
    @AuraEnabled(cacheable=true)
    public static Integer getNextScoringModelVersion(String modelName) {
        if (String.isBlank(modelName)) {
            return 1;
        }
        List<AggregateResult> agg = [
            SELECT MAX(Version__c) maxVer
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Campaign'
            AND Dictionary_Sub_Type__c = 'Scoring Model'
            AND Name = :modelName.trim()
        ];
        Decimal maxVer = (Decimal) agg[0].get('maxVer');
        return maxVer == null ? 1 : maxVer.intValue() + 1;
    }

    @AuraEnabled
    public static Id saveCampaignRecord(Marketing_Dictionary__c record) {
        try {
            Id campaignRecordTypeId = getRecordTypeId('Campaign');
            record.RecordTypeId = campaignRecordTypeId;
            // Route Scoring Model saves through versioning rules.
            if (record.Dictionary_Sub_Type__c == 'Scoring Model') {
                return saveScoringModel(record, false);
            }
            String oldName = null;
            String subType = record.Dictionary_Sub_Type__c;
            if (record.Id != null) {
                List<Marketing_Dictionary__c> existing = [
                    SELECT Id, Name, Dictionary_Sub_Type__c
                    FROM Marketing_Dictionary__c
                    WHERE Id = :record.Id
                    LIMIT 1
                ];
                if (!existing.isEmpty()) {
                    oldName = existing[0].Name;
                    if (String.isBlank(subType)) {
                        subType = existing[0].Dictionary_Sub_Type__c;
                        record.Dictionary_Sub_Type__c = subType;
                    }
                }
            }
            upsert record;
            if (record.Id != null
                && subType == 'Topic'
                && String.isNotBlank(record.Name)
                && oldName != record.Name) {
                CampaignOfferingLabelSync.onDictionaryRename(
                    record.Id, oldName, record.Name, 'Topic'
                );
            }
            return record.Id;
        } catch (AuraHandledException ahe) {
            throw ahe;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void saveCampaignRecordsBulk(List<Marketing_Dictionary__c> records) {
        try {
            Id campaignRecordTypeId = getRecordTypeId('Campaign');
            for (Marketing_Dictionary__c r : records) r.RecordTypeId = campaignRecordTypeId;
            upsert records;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled(cacheable=true)
    public static List<Campaign_Tier__c> getCampaignTiers() {
        return [
            SELECT Id, Name, Tier_Number__c, Description__c, Supported_Campaign_Types__c,
                   Override_Random_Activation_Path__c, Honor_Marketing_Consents__c,
                   Includes_Control_Group__c, Honors_Channel_Cooldowns__c,
                   Honors_Product_Eligibility__c, Allows_Random_Copy_Assignment__c,
                   Excl_Manual_Suppressions__c, Excl_Deceased__c, Excl_AML_Fraud__c,
                   Excl_Debt_Collection__c, Excl_Overdue__c, Excl_KYC_Risk__c,
                   Excl_Bailiff_Seizure__c, Excl_Restricted_Client__c, Excl_Personal_Bankruptcy__c
            FROM Campaign_Tier__c
            ORDER BY Tier_Number__c ASC NULLS LAST
            LIMIT 50
        ];
    }

    @AuraEnabled
    public static Id saveCampaignTier(Campaign_Tier__c record) {
        try {
            upsert record;
            return record.Id;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void deleteCampaignTier(Id recordId) {
        try {
            delete new Campaign_Tier__c(Id = recordId);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    // ─── Offer RT ────────────────────────────────────────────────────────────

    /**
     * Returns all Offer attribute definition records with their per-family rules.
     * @return List of Marketing_Dictionary__c with Offer record type
     */
    @AuraEnabled(cacheable=true)
    public static List<Marketing_Dictionary__c> getOfferRecords() {
        return [
            SELECT Id, Name, Parameter_API_Name__c, Parameter_Type__c,
                   Is_Globally_Required__c, Is_Active__c, Display_Order__c,
                   // MERGE 2026-09-14: added Picklist_Values__c so the admin edit form can reload
                   // saved picklist options. To revert: remove Picklist_Values__c from this SELECT.
                   Parameter_Help_Text__c, Picklist_Values__c, Attribute_Description__c, Value_Source__c, Default_Value__c,
                (SELECT Id, Product_Family__c, Product_Family__r.Name,
                        Is_Required__c, Is_Visible__c, Display_Order__c,
                        Impacts_Attractiveness__c, Attractiveness_Weight__c,
                        Picklist_Power_Values__c,
                        Reference_Value__c, Reference_Value__r.Name,
                        Reference_Value__r.Product_Family__r.Name,
                        Reference_Value__r.Reference_Value__c, Reference_Value__r.Value_Type__c,
                        Reference_Value__r.Reference_Value_Pairs__c
                 FROM Offer_Attribute_Rules__r
                 ORDER BY Display_Order__c ASC NULLS LAST, Product_Family__r.Name ASC)
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Offer'
            ORDER BY Display_Order__c ASC NULLS LAST, Name ASC
            LIMIT 1000
        ];
    }

    /**
     * Upserts an Offer attribute definition record.
     * @param record Serialized Marketing_Dictionary__c JSON
     * @return Saved record Id
     */
    @AuraEnabled
    public static Id saveOfferRecord(Marketing_Dictionary__c record) {
        try {
            Id offerRecordTypeId = getRecordTypeId('Offer');
            record.RecordTypeId = offerRecordTypeId;
            if (String.isBlank(record.Parameter_API_Name__c) && String.isNotBlank(record.Name)) {
                record.Parameter_API_Name__c = record.Name.replaceAll('[^a-zA-Z0-9]', '_') + '__c';
            }
            upsert record;
            return record.Id;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Upserts an Offer_Attribute_Rule__c child record from a JSON string.
     * @param ruleJson JSON-serialized Offer_Attribute_Rule__c
     * @return Saved record Id
     */
    @AuraEnabled
    public static Id saveAttributeRule(Offer_Attribute_Rule__c rule) {
        try {
            upsert rule;
            return rule.Id;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void saveAttributeRulesBulk(List<Offer_Attribute_Rule__c> rules) {
        try {
            upsert rules;
        } catch (DmlException e) {
            throw new AuraHandledException('Failed to save: ' + e.getDmlMessage(0));
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void toggleOfferActive(Id recordId, Boolean isActive) {
        try {
            update new Marketing_Dictionary__c(Id = recordId, Is_Active__c = isActive);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Deletes an Offer_Attribute_Rule__c record.
     * @param ruleId Id of the rule record to delete
     */
    @AuraEnabled
    public static void deleteAttributeRule(Id ruleId) {
        try {
            Offer_Attribute_Rule__c rec = [
                SELECT Id FROM Offer_Attribute_Rule__c WHERE Id = :ruleId WITH SECURITY_ENFORCED LIMIT 1
            ];
            delete rec;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Returns all Product Family dictionary records for use in Offer rule lookups.
     * @return List of Marketing_Dictionary__c with Product record type and Product Family sub-type
     */
    @AuraEnabled(cacheable=true)
    public static List<Marketing_Dictionary__c> getProductFamilyOptions() {
        return [
            SELECT Id, Name
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Product'
            AND Dictionary_Sub_Type__c = 'Product Family'

            ORDER BY Name ASC
            LIMIT 500
        ];
    }

    // ─── Blackout Windows ────────────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static List<Blackout_Window__c> getBlackoutWindows() {
        return [
            SELECT Id, Name, Blackout_Date__c, Blackout_End_Date__c, Blackout_Type__c,
                   Is_Recurring_Annually__c, Description__c, Assigned_Channels__c
            FROM Blackout_Window__c
            ORDER BY Blackout_Date__c ASC NULLS LAST, Name ASC
            LIMIT 500
        ];
    }

    /**
     * Weekly day rules for one Channel (or all rules when channelId is null — legacy).
     * Sorted Monday → Sunday.
     */
    @AuraEnabled(cacheable=true)
    public static List<Blackout_Day_Rule__c> getBlackoutDayRules(Id channelId) {
        Map<String, String> dayPrefix = new Map<String, String>{
            'Monday' => '1', 'Tuesday' => '2', 'Wednesday' => '3',
            'Thursday' => '4', 'Friday' => '5', 'Saturday' => '6', 'Sunday' => '7'
        };
        List<Blackout_Day_Rule__c> rules;
        if (channelId != null) {
            rules = [
                SELECT Id, Name, Channel__c, Day_Of_Week__c, Is_Fully_Blocked__c,
                       Blocked_From_Hour__c, Blocked_To_Hour__c
                FROM Blackout_Day_Rule__c
                WHERE Channel__c = :channelId
                LIMIT 50
            ];
        } else {
            rules = [
                SELECT Id, Name, Channel__c, Day_Of_Week__c, Is_Fully_Blocked__c,
                       Blocked_From_Hour__c, Blocked_To_Hour__c
                FROM Blackout_Day_Rule__c
                LIMIT 500
            ];
        }
        Map<String, Blackout_Day_Rule__c> sorted = new Map<String, Blackout_Day_Rule__c>();
        for (Blackout_Day_Rule__c r : rules) {
            String prefix = dayPrefix.containsKey(r.Day_Of_Week__c) ? dayPrefix.get(r.Day_Of_Week__c) : '8';
            sorted.put(prefix + '_' + r.Id, r);
        }
        List<String> keys = new List<String>(sorted.keySet());
        keys.sort();
        List<Blackout_Day_Rule__c> result = new List<Blackout_Day_Rule__c>();
        for (String k : keys) result.add(sorted.get(k));
        return result;
    }

    @AuraEnabled
    public static Id saveBlackoutWindow(Blackout_Window__c record) {
        try {
            if (String.isBlank(record.Name) || record.Blackout_Date__c == null) {
                throw new AuraHandledException('Name and Start Date are required.');
            }
            Set<String> assigned = new Set<String>();
            if (String.isNotBlank(record.Assigned_Channels__c)) {
                for (String channelName : record.Assigned_Channels__c.split(';')) {
                    if (String.isNotBlank(channelName)) assigned.add(channelName.trim());
                }
            }
            for (Marketing_Dictionary__c channel : [
                SELECT Name
                FROM Marketing_Dictionary__c
                WHERE RecordType.DeveloperName = 'Channel'
                AND Is_Active__c = false
            ]) {
                assigned.add(channel.Name);
            }
            List<String> sortedChannels = new List<String>(assigned);
            sortedChannels.sort();
            record.Assigned_Channels__c = String.join(sortedChannels, ';');
            if (String.isBlank(record.Assigned_Channels__c)) {
                throw new AuraHandledException('Select at least one channel for this blackout date.');
            }
            upsert record;
            return record.Id;
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void deleteBlackoutWindow(Id recordId) {
        try {
            delete new Blackout_Window__c(Id = recordId);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static Id saveBlackoutDayRule(Blackout_Day_Rule__c record) {
        try {
            if (record.Channel__c == null) {
                throw new AuraHandledException('Channel is required for weekly restrictions.');
            }
            if (String.isBlank(record.Day_Of_Week__c)) {
                throw new AuraHandledException('Day of Week is required.');
            }
            // One rule per channel + day
            List<Blackout_Day_Rule__c> existing;
            if (record.Id == null) {
                existing = [
                    SELECT Id FROM Blackout_Day_Rule__c
                    WHERE Channel__c = :record.Channel__c
                    AND Day_Of_Week__c = :record.Day_Of_Week__c
                    LIMIT 1
                ];
            } else {
                existing = [
                    SELECT Id FROM Blackout_Day_Rule__c
                    WHERE Channel__c = :record.Channel__c
                    AND Day_Of_Week__c = :record.Day_Of_Week__c
                    AND Id != :record.Id
                    LIMIT 1
                ];
            }
            if (!existing.isEmpty()) {
                throw new AuraHandledException(
                    'A weekly restriction for ' + record.Day_Of_Week__c + ' already exists on this channel.'
                );
            }
            upsert record;
            return record.Id;
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void deleteBlackoutDayRule(Id recordId) {
        try {
            delete new Blackout_Day_Rule__c(Id = recordId);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    // ─── Offer Reference Values ──────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static List<Offer_Reference_Value__c> getReferenceValues() {
        return [
            SELECT Id, Name, Product_Family__c, Product_Family__r.Name,
                   Reference_Value__c, Value_Type__c, Reference_Value_Pairs__c,
                   Range_Key__c, Range_Bound__c,
                   Description__c, Is_Active__c
            FROM Offer_Reference_Value__c
            ORDER BY Name ASC, Product_Family__r.Name ASC
            LIMIT 1000
        ];
    }

    @AuraEnabled
    public static Id saveReferenceValue(Offer_Reference_Value__c record) {
        try {
            upsert record;
            return record.Id;
        } catch (DmlException e) {
            throw new AuraHandledException('Failed to save: ' + e.getDmlMessage(0));
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void saveReferenceValuesForFamilies(Offer_Reference_Value__c record, List<Id> familyIds) {
        try {
            List<Offer_Reference_Value__c> toUpsert = new List<Offer_Reference_Value__c>();
            for (Id familyId : familyIds) {
                toUpsert.add(new Offer_Reference_Value__c(
                    Name = record.Name,
                    Product_Family__c = familyId,
                    Reference_Value__c = record.Reference_Value__c,
                    Value_Type__c = record.Value_Type__c,
                    Reference_Value_Pairs__c = record.Reference_Value_Pairs__c,
                    Description__c = record.Description__c,
                    Is_Active__c = record.Is_Active__c
                ));
            }
            insert toUpsert;
        } catch (DmlException e) {
            throw new AuraHandledException('Failed to save: ' + e.getDmlMessage(0));
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    // Range reference value: creates two linked records (Min + Max) per family,
    // joined by a shared Range_Key__c so the UI can treat them as one range.
    @AuraEnabled
    public static void saveRangeReferenceValues(Offer_Reference_Value__c record, Decimal minValue, Decimal maxValue, List<Id> familyIds) {
        try {
            List<Offer_Reference_Value__c> toInsert = new List<Offer_Reference_Value__c>();
            for (Id familyId : familyIds) {
                String key = newRangeKey();
                toInsert.add(new Offer_Reference_Value__c(
                    Name = record.Name, Product_Family__c = familyId,
                    Reference_Value__c = minValue, Value_Type__c = 'Range',
                    Range_Key__c = key, Range_Bound__c = 'Min',
                    Description__c = record.Description__c, Is_Active__c = record.Is_Active__c
                ));
                toInsert.add(new Offer_Reference_Value__c(
                    Name = record.Name, Product_Family__c = familyId,
                    Reference_Value__c = maxValue, Value_Type__c = 'Range',
                    Range_Key__c = key, Range_Bound__c = 'Max',
                    Description__c = record.Description__c, Is_Active__c = record.Is_Active__c
                ));
            }
            insert toInsert;
        } catch (DmlException e) {
            throw new AuraHandledException('Failed to save: ' + e.getDmlMessage(0));
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    // Update the Min/Max bounds (and shared attributes) of an existing range pair.
    @AuraEnabled
    public static void updateRangeReferenceValue(Id minId, Id maxId, Decimal minValue, Decimal maxValue, String description, Boolean isActive) {
        try {
            update new List<Offer_Reference_Value__c>{
                new Offer_Reference_Value__c(Id = minId, Reference_Value__c = minValue, Description__c = description, Is_Active__c = isActive),
                new Offer_Reference_Value__c(Id = maxId, Reference_Value__c = maxValue, Description__c = description, Is_Active__c = isActive)
            };
        } catch (DmlException e) {
            throw new AuraHandledException('Failed to update: ' + e.getDmlMessage(0));
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    private static String newRangeKey() {
        return EncodingUtil.convertToHex(Crypto.generateAesKey(128));
    }

    @AuraEnabled
    public static void deleteReferenceValue(Id recordId) {
        try {
            delete new Offer_Reference_Value__c(Id = recordId);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void toggleReferenceValueActive(Id recordId, Boolean isActive) {
        try {
            update new Offer_Reference_Value__c(Id = recordId, Is_Active__c = isActive);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void updateReferenceAttributeMaster(String oldName, String newName, String newType) {
        try {
            List<Offer_Reference_Value__c> children = [
                SELECT Id FROM Offer_Reference_Value__c WHERE Name = :oldName LIMIT 2000
            ];
            for (Offer_Reference_Value__c r : children) {
                r.Name = newName;
                r.Value_Type__c = newType;
            }
            update children;
        } catch (DmlException e) {
            throw new AuraHandledException('Failed to update: ' + e.getDmlMessage(0));
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    // ─── Family of Needs → Customer Type junction ────────────────────────────

    @AuraEnabled(cacheable=true)
    public static List<FamilyOfNeeds_CustomerType__c> getFonCustomerTypes(Id fonId) {
        return [
            SELECT Id, Customer_Type__c, Customer_Type__r.Name
            FROM FamilyOfNeeds_CustomerType__c
            WHERE Family_of_Needs__c = :fonId
            ORDER BY Customer_Type__r.Name ASC
        ];
    }

    @AuraEnabled
    public static void setFonCustomerTypes(Id fonId, List<Id> customerTypeIds) {
        try {
            delete [SELECT Id FROM FamilyOfNeeds_CustomerType__c WHERE Family_of_Needs__c = :fonId];
            List<FamilyOfNeeds_CustomerType__c> toInsert = new List<FamilyOfNeeds_CustomerType__c>();
            for (Id ctId : customerTypeIds) {
                toInsert.add(new FamilyOfNeeds_CustomerType__c(
                    Family_of_Needs__c = fonId,
                    Customer_Type__c = ctId
                ));
            }
            if (!toInsert.isEmpty()) insert toInsert;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    // ─── Product Customer Type junction ──────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static List<Product_Customer_Type__c> getProductCustomerTypes(Id productId) {
        return [
            SELECT Id, Customer_Type__c, Customer_Type__r.Name
            FROM Product_Customer_Type__c
            WHERE Product__c = :productId
            ORDER BY Customer_Type__r.Name ASC
        ];
    }

    @AuraEnabled
    public static void setProductCustomerTypes(Id productId, List<Id> customerTypeIds) {
        try {
            delete [SELECT Id FROM Product_Customer_Type__c WHERE Product__c = :productId];
            List<Product_Customer_Type__c> toInsert = new List<Product_Customer_Type__c>();
            for (Id ctId : customerTypeIds) {
                toInsert.add(new Product_Customer_Type__c(
                    Product__c = productId,
                    Customer_Type__c = ctId
                ));
            }
            if (!toInsert.isEmpty()) insert toInsert;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    // ─── Product2 Manager ────────────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static List<Marketing_Dictionary__c> getDictionaryOptionsBySubtype(String subType) {
        return [
            SELECT Id, Name, Related_Family_of_Needs__c
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Product'
            AND Dictionary_Sub_Type__c = :subType
            ORDER BY Name ASC
            LIMIT 500
        ];
    }

    @AuraEnabled(cacheable=true)
    public static Map<String, Object> getProduct2ForEdit(Id productId) {
        Product2 p = [
            SELECT Id, Name, IsActive, ProductCode, Description,
                   Product_Type_Dict__c, Product_Type_Dict__r.Name,
                   Product_Family_Dict__c, Product_Family_Dict__r.Name,
                   Product_Family_Dict__r.Related_Family_of_Needs__c,
                   Family_of_Needs_Dict__c, Family_of_Needs_Dict__r.Name
            FROM Product2
            WHERE Id = :productId
            LIMIT 1
        ];
        List<Product_Customer_Type__c> ctJunctions = [
            SELECT Customer_Type__c
            FROM Product_Customer_Type__c
            WHERE Product__c = :productId
        ];
        List<Id> ctIds = new List<Id>();
        for (Product_Customer_Type__c j : ctJunctions) ctIds.add(j.Customer_Type__c);
        Map<String, Object> result = new Map<String, Object>{
            'Id'                    => p.Id,
            'Name'                  => p.Name,
            'IsActive'              => p.IsActive,
            'ProductCode'           => p.ProductCode,
            'Description'           => p.Description,
            'Product_Type_Dict__c'  => p.Product_Type_Dict__c,
            'Family_of_Needs_Dict__c' => p.Family_of_Needs_Dict__c,
            'Product_Family_Dict__c' => p.Product_Family_Dict__c,
            'customerTypeIds'       => ctIds
        };
        return result;
    }

    @AuraEnabled
    public static Id saveProduct2Record(Map<String, Object> data, List<Id> customerTypeIds) {
        try {
            Id recordId = data.containsKey('Id') && data.get('Id') != null
                ? (Id) String.valueOf(data.get('Id')) : null;
            Product2 p = recordId != null ? new Product2(Id = recordId) : new Product2();
            p.Name = String.valueOf(data.get('Name'));
            if (data.containsKey('IsActive'))              p.IsActive = (Boolean) data.get('IsActive');
            if (data.containsKey('ProductCode'))           p.ProductCode = data.get('ProductCode') != null ? String.valueOf(data.get('ProductCode')) : null;
            if (data.containsKey('Description'))           p.Description = data.get('Description') != null ? String.valueOf(data.get('Description')) : null;
            if (data.containsKey('Product_Type_Dict__c'))  p.Product_Type_Dict__c = data.get('Product_Type_Dict__c') != null ? (Id) String.valueOf(data.get('Product_Type_Dict__c')) : null;
            if (data.containsKey('Family_of_Needs_Dict__c')) p.Family_of_Needs_Dict__c = data.get('Family_of_Needs_Dict__c') != null ? (Id) String.valueOf(data.get('Family_of_Needs_Dict__c')) : null;
            if (data.containsKey('Product_Family_Dict__c'))  p.Product_Family_Dict__c = data.get('Product_Family_Dict__c') != null ? (Id) String.valueOf(data.get('Product_Family_Dict__c')) : null;
            upsert p;
            // Sync Customer Types
            List<Product_Customer_Type__c> existing = [SELECT Id FROM Product_Customer_Type__c WHERE Product__c = :p.Id];
            delete existing;
            List<Product_Customer_Type__c> newJunctions = new List<Product_Customer_Type__c>();
            if (customerTypeIds != null) {
                Set<Id> seen = new Set<Id>();
                for (Id ctId : customerTypeIds) {
                    if (ctId != null && !seen.contains(ctId)) {
                        newJunctions.add(new Product_Customer_Type__c(Product__c = p.Id, Customer_Type__c = ctId));
                        seen.add(ctId);
                    }
                }
            }
            if (!newJunctions.isEmpty()) insert newJunctions;
            return p.Id;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private static String normalizeOfferingIds(String raw, String expectedSubType) {
        List<String> tokens = new List<String>();
        for (String part : raw.split(';')) {
            String t = part == null ? '' : part.trim();
            if (String.isNotBlank(t)) tokens.add(t);
        }
        if (tokens.isEmpty()) {
            throw new AuraHandledException('Select at least one ' + expectedSubType + '.');
        }

        Set<Id> idTokens = new Set<Id>();
        Set<String> nameTokens = new Set<String>();
        for (String token : tokens) {
            if (token.length() == 15 || token.length() == 18) {
                try {
                    idTokens.add((Id) token);
                } catch (Exception e) {
                    nameTokens.add(token);
                }
            } else {
                nameTokens.add(token);
            }
        }

        Map<Id, Marketing_Dictionary__c> byId = new Map<Id, Marketing_Dictionary__c>();
        Map<String, Marketing_Dictionary__c> byName = new Map<String, Marketing_Dictionary__c>();
        for (Marketing_Dictionary__c rec : [
            SELECT Id, Name, Dictionary_Sub_Type__c
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Product'
            AND Dictionary_Sub_Type__c = :expectedSubType
            LIMIT 1000
        ]) {
            byId.put(rec.Id, rec);
            byName.put(rec.Name, rec);
        }

        List<String> resolvedIds = new List<String>();
        Set<Id> seen = new Set<Id>();
        for (String token : tokens) {
            Marketing_Dictionary__c match = null;
            if (token.length() == 15 || token.length() == 18) {
                try {
                    match = byId.get((Id) token);
                } catch (Exception e) {
                    match = null;
                }
            }
            if (match == null) {
                match = byName.get(token);
            }
            if (match == null) {
                throw new AuraHandledException(
                    'Unknown ' + expectedSubType + ': "' + token + '". Re-select offerings from the dictionary.'
                );
            }
            if (!seen.contains(match.Id)) {
                resolvedIds.add(String.valueOf(match.Id));
                seen.add(match.Id);
            }
        }
        return String.join(resolvedIds, '; ');
    }

    private static Id getRecordTypeId(String developerName) {
        return Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName()
            .get(developerName)
            ?.getRecordTypeId();
    }
}