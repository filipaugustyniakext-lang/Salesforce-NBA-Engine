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
     * Customer type Ids are applied to each new Family of Needs row.
     * @param recordsJson JSON array of Marketing_Dictionary__c records
     * @param customerTypeIds Audience-tab Customer Type Ids, or null
     * @return Ids of the saved records
     */
    @AuraEnabled
    public static List<Id> saveProductRecordsBulk(String recordsJson, List<Id> customerTypeIds) {
        try {
            List<Marketing_Dictionary__c> records = (List<Marketing_Dictionary__c>)
                JSON.deserialize(recordsJson, List<Marketing_Dictionary__c>.class);
            Id productRecordTypeId = getRecordTypeId('Product');
            for (Marketing_Dictionary__c rec : records) {
                rec.RecordTypeId = productRecordTypeId;
            }
            upsert records;
            if (customerTypeIds != null && !customerTypeIds.isEmpty()) {
                List<FamilyOfNeeds_CustomerType__c> links = new List<FamilyOfNeeds_CustomerType__c>();
                for (Marketing_Dictionary__c rec : records) {
                    if (rec.Dictionary_Sub_Type__c != 'Family of Needs') {
                        continue;
                    }
                    for (Id customerTypeId : customerTypeIds) {
                        links.add(new FamilyOfNeeds_CustomerType__c(
                            Family_of_Needs__c = rec.Id,
                            Customer_Type__c = customerTypeId
                        ));
                    }
                }
                if (!links.isEmpty()) {
                    insert links;
                }
            }
            List<Id> savedIds = new List<Id>();
            for (Marketing_Dictionary__c rec : records) {
                savedIds.add(rec.Id);
            }
            return savedIds;
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
                SELECT Id, Name, Dictionary_Sub_Type__c, RecordType.DeveloperName
                FROM Marketing_Dictionary__c
                WHERE Id = :recordId
                WITH SECURITY_ENFORCED
                LIMIT 1
            ];
            if (rec.Dictionary_Sub_Type__c == 'Family of Needs') {
                List<String> dependencies = new List<String>();
                for (FamilyOfNeeds_CustomerType__c link : [
                    SELECT Name, Customer_Type__r.Name
                    FROM FamilyOfNeeds_CustomerType__c
                    WHERE Family_of_Needs__c = :recordId
                    ORDER BY Customer_Type__r.Name ASC
                ]) {
                    dependencies.add(
                        String.isNotBlank(link.Customer_Type__r.Name) ? link.Customer_Type__r.Name : link.Name
                    );
                }
                if (!dependencies.isEmpty()) {
                    throw dependencyDeleteException(rec.Name, 'Family of Needs Customer Types: ' + String.join(dependencies, ', '));
                }
            }
            // Product_Type_Dict__c is SetNull, so a plain delete would clear the lookup on
            // every related Product2. Block that while any product still uses the type.
            if (rec.Dictionary_Sub_Type__c == 'Product Type') {
                String productDependency = new ProductTypeUsage().describe(recordId);
                if (productDependency != null) {
                    throw dependencyDeleteException(rec.Name, productDependency);
                }
            }
            // Topic_Group_Dict__c is SetNull, so a plain delete would clear the group on
            // every related Topic. Block that while any topic still uses the group.
            if (rec.Dictionary_Sub_Type__c == 'Topic Group') {
                String topicDependency = new TopicGroupUsage().describe(recordId);
                if (topicDependency != null) {
                    throw dependencyDeleteException(rec.Name, topicDependency);
                }
            }
            if (rec.RecordType.DeveloperName == 'Channel') {
                ChannelTemplateController.deleteTemplatesForChannel(rec.Id);
            }
            delete rec;
        } catch (AuraHandledException e) {
            throw e;
        } catch (DmlException e) {
            String detail = e.getNumDml() > 0 ? e.getDmlMessage(0) : e.getMessage();
            if (detail != null && (detail.contains('DELETE_FAILED') || detail.containsIgnoreCase('associated with'))) {
                throw dependencyDeleteException(null, 'related records');
            }
            throw new AuraHandledException(detail);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    private static AuraHandledException dependencyDeleteException(String recordName, String dependency) {
        String message = (String.isBlank(recordName) ? 'This value' : 'The value ' + recordName)
            + ' has a dependency to ' + dependency
            + '. Please remove dependencies first to delete this record.';
        AuraHandledException ex = new AuraHandledException(message);
        ex.setMessage(message);
        return ex;
    }

    /**
     * Reads Product2 usage outside the caller's sharing rules so a hidden product
     * cannot be orphaned by deleting its Product Type.
     */
    private without sharing class ProductTypeUsage {
        String describe(Id recordId) {
            Integer productCount = [
                SELECT COUNT()
                FROM Product2
                WHERE Product_Type_Dict__c = :recordId
            ];
            if (productCount == 0) {
                return null;
            }
            List<String> names = new List<String>();
            for (Product2 product : [
                SELECT Name
                FROM Product2
                WHERE Product_Type_Dict__c = :recordId
                ORDER BY Name ASC
                LIMIT 10
            ]) {
                names.add(String.isBlank(product.Name) ? String.valueOf(product.Id) : product.Name);
            }
            String listed = String.join(names, ', ');
            Integer remaining = productCount - names.size();
            if (remaining > 0) {
                listed += ' and ' + remaining + ' more';
            }
            return 'Products: ' + listed;
        }
    }

    /**
     * Reads Topic assignments outside the caller's sharing rules so a hidden topic
     * cannot be detached by deleting its Topic Group.
     */
    private without sharing class TopicGroupUsage {
        String describe(Id recordId) {
            Integer topicCount = [
                SELECT COUNT()
                FROM Marketing_Dictionary__c
                WHERE Topic_Group_Dict__c = :recordId
                AND Dictionary_Sub_Type__c = 'Topic'
            ];
            if (topicCount == 0) {
                return null;
            }
            List<String> names = new List<String>();
            for (Marketing_Dictionary__c topic : [
                SELECT Name
                FROM Marketing_Dictionary__c
                WHERE Topic_Group_Dict__c = :recordId
                AND Dictionary_Sub_Type__c = 'Topic'
                ORDER BY Name ASC
                LIMIT 10
            ]) {
                names.add(String.isBlank(topic.Name) ? String.valueOf(topic.Id) : topic.Name);
            }
            String listed = String.join(names, ', ');
            Integer remaining = topicCount - names.size();
            if (remaining > 0) {
                listed += ' and ' + remaining + ' more';
            }
            return 'Topics: ' + listed;
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
                   Scoring_Model_Source_System__c, Data360_DMO__c,
                   CreatedDate, LastModifiedDate,
                   CreatedById, CreatedBy.Name,
                   LastModifiedById, LastModifiedBy.Name
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Campaign'
            ORDER BY Dictionary_Sub_Type__c ASC, Name ASC, Version__c ASC NULLS LAST
            LIMIT 2000
        ];
    }

    /**
     * Data360 DMO options for Scoring Model editor.
     * DMOs are Data Cloud objects and are not returned by EntityDefinition, so the catalogue comes from ConnectApi.CdpQuery.
     */
    @AuraEnabled
    public static List<Map<String, String>> getData360DmoOptions() {
        Map<String, Map<String, String>> byApi = new Map<String, Map<String, String>>();
        String connectError;
        try {
            collectDataCloudDmos(byApi);
        } catch (Exception e) {
            connectError = e.getMessage();
        }
        collectEntityDefinitionDmos(byApi);
        if (byApi.isEmpty() && String.isNotBlank(connectError)) {
            throw auraError('Data360 DMOs could not be loaded from Data Cloud. ' + connectError);
        }
        List<Map<String, String>> options = byApi.values();
        options.sort(new DmoOptionLabelSort());
        return options;
    }

    private static final List<String> DMO_CATEGORIES = new List<String>{
        null, 'Profile', 'Engagement', 'Related'
    };

    private static void collectDataCloudDmos(Map<String, Map<String, String>> byApi) {
        List<String> spaces = dataSpaceApiNames();
        if (spaces.isEmpty()) {
            spaces.add(null);
        }
        List<String> errors = new List<String>();
        for (String spaceName : spaces) {
            for (String category : DMO_CATEGORIES) {
                try {
                    addSerializedDmos(byApi, connectApiAsUntyped(
                        queryDataCloudMetadata('DataModelObject', category, null, spaceName)
                    ));
                    if (category == null && !byApi.isEmpty()) {
                        break;
                    }
                } catch (Exception e) {
                    errors.add(e.getMessage());
                }
            }
        }
        if (byApi.isEmpty() && !errors.isEmpty()) {
            throw auraError(errors[0]);
        }
    }

    private static ConnectApi.CdpQueryMetadataOutput queryDataCloudMetadata(
        String entityType,
        String entityCategory,
        String entityName,
        String spaceName
    ) {
        return spaceName == null
            ? ConnectApi.CdpQuery.getAllMetadata(entityType, entityCategory, entityName)
            : ConnectApi.CdpQuery.getAllMetadata(entityType, entityCategory, entityName, spaceName);
    }

    private static void addSerializedDmos(Map<String, Map<String, String>> byApi, Object raw) {
        if (!(raw instanceof Map<String, Object>)) {
            return;
        }
        Object rows = ((Map<String, Object>) raw).get('metadata');
        if (!(rows instanceof List<Object>)) {
            return;
        }
        for (Object row : (List<Object>) rows) {
            if (!(row instanceof Map<String, Object>)) {
                continue;
            }
            Map<String, Object> entity = (Map<String, Object>) row;
            String api = firstString(entity, new List<String>{ 'name', 'apiName' });
            String typeName = firstString(entity, new List<String>{ 'type' });
            if (String.isBlank(api)) {
                continue;
            }
            if (String.isNotBlank(typeName) && typeName != 'DataModelObject') {
                continue;
            }
            String label = firstString(entity, new List<String>{ 'displayName', 'label' });
            if (String.isBlank(label)) {
                label = api;
            }
            byApi.put(api.toLowerCase(), new Map<String, String>{
                'label' => label + ' (' + api + ')',
                'value' => api
            });
        }
    }

    private static List<String> dataSpaceApiNames() {
        List<String> names = new List<String>();
        Set<String> seen = new Set<String>();
        try {
            ConnectApi.DataSpaceCollectionRepresentation collection =
                ConnectApi.CdpDataSpace.getAllDataSpaces(200, 0, 'id');
            Object raw = connectApiAsUntyped(collection);
            Object rows = raw instanceof Map<String, Object>
                ? ((Map<String, Object>) raw).get('dataSpaces')
                : null;
            if (rows instanceof List<Object>) {
            for (Object row : (List<Object>) rows) {
                if (!(row instanceof Map<String, Object>)) {
                    continue;
                }
                String api = firstString(
                    (Map<String, Object>) row,
                    new List<String>{ 'name', 'apiName', 'dataSpaceName', 'developerName', 'label' }
                );
                if (String.isBlank(api) || !seen.add(api.toLowerCase())) {
                    continue;
                }
                names.add(api);
            }
            }
        } catch (Exception e) {
            names.clear();
            seen.clear();
        }
        if (!seen.contains('default')) {
            names.add(0, null);
        }
        return names;
    }

    private static void collectEntityDefinitionDmos(Map<String, Map<String, String>> byApi) {
        try {
            for (EntityDefinition ent : [
                SELECT QualifiedApiName, Label
                FROM EntityDefinition
                WHERE QualifiedApiName LIKE '%__dlm'
                LIMIT 2000
            ]) {
                if (String.isBlank(ent.QualifiedApiName) || byApi.containsKey(ent.QualifiedApiName.toLowerCase())) {
                    continue;
                }
                String label = String.isNotBlank(ent.Label) ? ent.Label : ent.QualifiedApiName;
                byApi.put(ent.QualifiedApiName.toLowerCase(), new Map<String, String>{
                    'label' => label + ' (' + ent.QualifiedApiName + ')',
                    'value' => ent.QualifiedApiName
                });
            }
        } catch (Exception e) {
            // Core entity catalogue does not list Data Cloud DMOs.
        }
    }

    private static Object connectApiAsUntyped(Object value) {
        if (value == null) {
            return null;
        }
        // JSON.serialize on a ConnectApi instance returns null. A one-item list serializes.
        String payload = JSON.serialize(new List<Object>{ value });
        if (String.isBlank(payload)) {
            throw auraError('Data Cloud returned metadata that Apex could not read.');
        }
        Object parsed = JSON.deserializeUntyped(payload);
        if (parsed instanceof List<Object>) {
            List<Object> rows = (List<Object>) parsed;
            return rows.isEmpty() ? null : rows[0];
        }
        return parsed;
    }

    private static String firstString(Map<String, Object> values, List<String> keys) {
        if (values == null) {
            return null;
        }
        for (String key : keys) {
            Object value = values.get(key);
            if (value instanceof String && String.isNotBlank((String) value)) {
                return ((String) value).trim();
            }
        }
        return null;
    }

    private static AuraHandledException auraError(String message) {
        AuraHandledException ex = new AuraHandledException(message);
        ex.setMessage(message);
        return ex;
    }

    private class ColumnApiSort implements System.Comparator<Map<String, String>> {
        public Integer compare(Map<String, String> a, Map<String, String> b) {
            String left = a == null || a.get('value') == null ? '' : a.get('value');
            String right = b == null || b.get('value') == null ? '' : b.get('value');
            return left.toLowerCase().compareTo(right.toLowerCase());
        }
    }

    private class DmoOptionLabelSort implements System.Comparator<Map<String, String>> {
        public Integer compare(Map<String, String> a, Map<String, String> b) {
            String left = a == null || a.get('label') == null ? '' : a.get('label');
            String right = b == null || b.get('label') == null ? '' : b.get('label');
            return left.toLowerCase().compareTo(right.toLowerCase());
        }
    }

    /**
     * Upserts one Scoring Model dictionary row.
     * Model ID is the next unused positive integer and does not change after create.
     * asNewMaster is retained for older clients and is not used.
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
            if (record.Is_Active__c == null) {
                record.Is_Active__c = false;
            }
            validateScoringModelForActivation(record);
            assertUniqueScoringModelName(record.Id, modelName);

            if (record.Id != null) {
                Marketing_Dictionary__c existing = [
                    SELECT Id, Model_Id__c, Version__c
                    FROM Marketing_Dictionary__c
                    WHERE Id = :record.Id
                    LIMIT 1
                ];
                record.Model_Id__c = existing.Model_Id__c;
                record.Version__c = existing.Version__c;
            } else {
                record.Model_Id__c = nextScoringModelId();
                record.Version__c = null;
            }

            upsert record;
            return record.Id;
        } catch (AuraHandledException ahe) {
            throw ahe;
        } catch (DmlException dml) {
            String msg = dml.getDmlMessage(0);
            if (msg != null && msg.toLowerCase().contains('duplicate')) {
                throw new AuraHandledException(
                    'A Scoring Model with this Model ID already exists.'
                );
            }
            throw new AuraHandledException(msg);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /** Full required-field gate used when Is_Active__c = true. */
    private static void validateScoringModelForActivation(Marketing_Dictionary__c record) {
        if (record.Scoring_Model_Group_Dict__c == null) {
            throw new AuraHandledException('Model Group is required.');
        }
        if (record.Assigned_Topic_Dict__c == null) {
            throw new AuraHandledException('Model Topic is required.');
        }

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
    }

    /** Soft normalize for draft saves — only validate fields that were provided. */
    private static void normalizeScoringModelDraftFields(Marketing_Dictionary__c record) {
        if (String.isNotBlank(record.Data360_DMO__c)) {
            record.Data360_DMO__c = record.Data360_DMO__c.trim();
        }
        if (String.isNotBlank(record.Scoring_Model_Source_System__c)
            && record.Scoring_Model_Source_System__c != 'GCP'
            && record.Scoring_Model_Source_System__c != 'Salesforce (Einstein)') {
            throw new AuraHandledException(
                'Scoring Model Source System must be GCP or Salesforce (Einstein).'
            );
        }
        if (record.Scoring_Model_Group_Dict__c != null) {
            Marketing_Dictionary__c groupRec = [
                SELECT Id, Dictionary_Sub_Type__c
                FROM Marketing_Dictionary__c
                WHERE Id = :record.Scoring_Model_Group_Dict__c
                LIMIT 1
            ];
            if (groupRec.Dictionary_Sub_Type__c != 'Scoring Model Group') {
                throw new AuraHandledException('Model Group must be a Scoring Model Group dictionary entry.');
            }
        }
        if (record.Assigned_Topic_Dict__c != null) {
            Marketing_Dictionary__c topicRec = [
                SELECT Id, Dictionary_Sub_Type__c
                FROM Marketing_Dictionary__c
                WHERE Id = :record.Assigned_Topic_Dict__c
                LIMIT 1
            ];
            if (topicRec.Dictionary_Sub_Type__c != 'Topic') {
                throw new AuraHandledException('Assigned Topic must be a Topic dictionary entry.');
            }
        }

        if (String.isBlank(record.Offering_Type__c)) {
            record.Product_Family__c = null;
            record.Family_of_Needs__c = null;
            return;
        }
        if (record.Offering_Type__c == 'Product Family') {
            if (String.isNotBlank(record.Product_Family__c)) {
                record.Product_Family__c = normalizeOfferingIds(
                    record.Product_Family__c, 'Product Family'
                );
            } else {
                record.Product_Family__c = null;
            }
            record.Family_of_Needs__c = null;
        } else if (record.Offering_Type__c == 'Family of Needs') {
            if (String.isNotBlank(record.Family_of_Needs__c)) {
                record.Family_of_Needs__c = normalizeOfferingIds(
                    record.Family_of_Needs__c, 'Family of Needs'
                );
            } else {
                record.Family_of_Needs__c = null;
            }
            record.Product_Family__c = null;
        } else {
            throw new AuraHandledException('Offering Type must be Product Family or Family of Needs.');
        }
    }

    private static void assertUniqueScoringModelName(Id recordId, String modelName) {
        List<Marketing_Dictionary__c> existing = [
            SELECT Id
            FROM Marketing_Dictionary__c
            WHERE Dictionary_Sub_Type__c = 'Scoring Model'
            AND Name = :modelName
        ];
        for (Marketing_Dictionary__c row : existing) {
            if (row.Id != recordId) {
                throw new AuraHandledException(
                    'A Scoring Model named "' + modelName + '" already exists.'
                );
            }
        }
    }

    private static String nextScoringModelId() {
        Integer maxId = 0;
        for (Marketing_Dictionary__c row : [
            SELECT Model_Id__c
            FROM Marketing_Dictionary__c
            WHERE Dictionary_Sub_Type__c = 'Scoring Model'
            AND Model_Id__c != null
        ]) {
            if (row.Model_Id__c != null && row.Model_Id__c.isNumeric()) {
                Integer value = Integer.valueOf(row.Model_Id__c);
                if (value > maxId) maxId = value;
            }
        }
        return String.valueOf(maxId + 1);
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

    /**
     * Columns on one Data360 DMO, loaded by API name.
     * getAllMetadata returns a ConnectApi object that JSON.serialize cannot read
     * in this org, so columns come from query metadata for SELECT * FROM {dmo}.
     * Every column is returned. Score columns are often text.
     */
    @AuraEnabled
    public static List<Map<String, String>> getData360DmoFields(String dmoApiName) {
        List<Map<String, String>> options = new List<Map<String, String>>();
        for (Map<String, String> field : queryDmoFieldRows(dmoApiName)) {
            String api = field.get('value');
            String label = field.get('label');
            String dataType = field.get('dataType');
            String baseLabel = label == api ? api : label + ' (' + api + ')';
            String typeSuffix = String.isBlank(dataType) ? '' : ' · ' + dataType;
            options.add(new Map<String, String>{
                'label' => baseLabel + typeSuffix,
                'value' => api,
                'dataType' => dataType,
                'numeric' => field.get('numeric'),
                'entityDisplay' => field.get('entityDisplay')
            });
        }
        return options;
    }

    @AuraEnabled(cacheable=true)
    public static List<Scoring_Model_Setting__c> getScoringModelSettings() {
        return [
            SELECT Id, Name,
                   Scoring_Model__c, Scoring_Model__r.Name, Scoring_Model__r.Model_Id__c,
                   Data360_DMO__c, Source_Model_Id_Column__c, Model_Source__c,
                   Base_Score_Column__c, Base_Score_Formula_Mode__c, Base_Score_Factor__c, Base_Score_Formula__c,
                   Calibrated_Base_Score_Column__c, Calibrated_Score_Formula_Mode__c,
                   Calibrated_Score_Factor__c, Calibrated_Score_Formula__c,
                   Model_From_Date__c, Model_To_Date__c
            FROM Scoring_Model_Setting__c
            ORDER BY Scoring_Model__r.Name ASC NULLS LAST, Name ASC
            LIMIT 2000
        ];
    }

    @AuraEnabled
    public static Id saveScoringModelSetting(Scoring_Model_Setting__c record) {
        try {
            if (record == null || record.Scoring_Model__c == null) {
                throw new AuraHandledException('Model ID is required.');
            }
            List<Marketing_Dictionary__c> models = [
                SELECT Id, Name, Dictionary_Sub_Type__c
                FROM Marketing_Dictionary__c
                WHERE Id = :record.Scoring_Model__c
                LIMIT 1
            ];
            if (models.isEmpty() || models[0].Dictionary_Sub_Type__c != 'Scoring Model') {
                throw new AuraHandledException('Select a model from Model Definitions.');
            }
            Marketing_Dictionary__c model = models[0];

            String dmo = record.Data360_DMO__c == null ? '' : record.Data360_DMO__c.trim();
            Map<String, String> canonicalByLower = new Map<String, String>();
            Map<String, String> typeByLower = new Map<String, String>();
            for (Map<String, String> field : queryDmoFieldRows(dmo)) {
                String api = field.get('value');
                if (String.isBlank(api)) {
                    continue;
                }
                canonicalByLower.put(api.toLowerCase(), api);
                typeByLower.put(api.toLowerCase(), field.get('dataType'));
            }
            if (canonicalByLower.isEmpty()) {
                throw new AuraHandledException('The selected Data360 DMO has no columns to map.');
            }

            String sourceColumn = requireDmoColumn(
                record.Source_Model_Id_Column__c, canonicalByLower, typeByLower, 'Source Model ID', false
            );
            String modelSource = record.Model_Source__c;
            if (modelSource != 'GCP' && modelSource != 'Einstein' && modelSource != 'Other') {
                throw new AuraHandledException('Model Source must be GCP, Einstein, or Other.');
            }
            String baseColumn = requireDmoColumn(
                record.Base_Score_Column__c, canonicalByLower, typeByLower, 'Base Score', false
            );
            String calibratedColumn = requireDmoColumn(
                record.Calibrated_Base_Score_Column__c, canonicalByLower, typeByLower, 'Calibrated Base Score', false
            );
            ScoreFormula baseFormula = buildScoreFormula(
                baseColumn, record.Base_Score_Formula_Mode__c, record.Base_Score_Factor__c, 'Base Score'
            );
            ScoreFormula calibratedFormula = buildScoreFormula(
                calibratedColumn,
                record.Calibrated_Score_Formula_Mode__c,
                record.Calibrated_Score_Factor__c,
                'Calibrated Base Score'
            );
            if (record.Model_From_Date__c == null) {
                throw new AuraHandledException('Model From Date is required.');
            }
            if (record.Model_To_Date__c == null) {
                throw new AuraHandledException('Model To Date is required.');
            }
            if (record.Model_From_Date__c > record.Model_To_Date__c) {
                throw new AuraHandledException('Model From Date must be on or before Model To Date.');
            }

            List<Scoring_Model_Setting__c> dupes = [
                SELECT Id
                FROM Scoring_Model_Setting__c
                WHERE Scoring_Model__c = :model.Id
                AND Id != :record.Id
                LIMIT 1
            ];
            if (!dupes.isEmpty()) {
                throw new AuraHandledException('This model already has a setting. Edit the existing configuration.');
            }

            String settingName = model.Name == null ? 'Model Setting' : model.Name.trim();
            if (settingName.length() > 80) {
                settingName = settingName.substring(0, 80);
            }
            Scoring_Model_Setting__c row = new Scoring_Model_Setting__c(
                Id = record.Id,
                Name = settingName,
                Scoring_Model__c = model.Id,
                Model_Definition_Key__c = String.valueOf(model.Id),
                Data360_DMO__c = dmo,
                Source_Model_Id_Column__c = sourceColumn,
                Model_Source__c = modelSource,
                Base_Score_Column__c = baseColumn,
                Base_Score_Formula_Mode__c = baseFormula.mode,
                Base_Score_Factor__c = baseFormula.factor,
                Base_Score_Formula__c = baseFormula.expression,
                Calibrated_Base_Score_Column__c = calibratedColumn,
                Calibrated_Score_Formula_Mode__c = calibratedFormula.mode,
                Calibrated_Score_Factor__c = calibratedFormula.factor,
                Calibrated_Score_Formula__c = calibratedFormula.expression,
                Model_From_Date__c = record.Model_From_Date__c,
                Model_To_Date__c = record.Model_To_Date__c
            );
            upsert row;
            return row.Id;
        } catch (AuraHandledException ahe) {
            throw ahe;
        } catch (DmlException dml) {
            String msg = dml.getDmlMessage(0);
            if (msg != null && msg.toLowerCase().contains('duplicate')) {
                throw new AuraHandledException('This model already has a setting. Edit the existing configuration.');
            }
            throw new AuraHandledException(msg);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void deleteScoringModelSetting(Id recordId) {
        try {
            if (recordId == null) {
                throw new AuraHandledException('Model setting is required.');
            }
            delete [
                SELECT Id
                FROM Scoring_Model_Setting__c
                WHERE Id = :recordId
                LIMIT 1
            ];
        } catch (AuraHandledException ahe) {
            throw ahe;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    private static List<Map<String, String>> queryDmoFieldRows(String dmoApiName) {
        String dmo = dmoApiName == null ? '' : dmoApiName.trim();
        if (String.isBlank(dmo) || !dmo.endsWithIgnoreCase('__dlm')) {
            throw auraError(
                'Enter a Data360 DMO API name that ends with __dlm, for example Sample_ScoringModels__dlm.'
            );
        }
        String lastError;
        List<String> spaces = new List<String>{ null };
        for (String spaceName : dataSpaceApiNames()) {
            if (spaceName != null) {
                spaces.add(spaceName);
            }
        }
        for (String spaceName : spaces) {
            try {
                List<Map<String, String>> rows = columnsFromDmoQuery(dmo, spaceName);
                if (!rows.isEmpty()) {
                    return rows;
                }
            } catch (Exception e) {
                lastError = e.getMessage();
            }
        }
        List<Map<String, String>> fromEntity = entityDefinitionFieldRows(dmo);
        if (!fromEntity.isEmpty()) {
            return fromEntity;
        }
        String detail = String.isNotBlank(lastError) ? ' ' + lastError : '';
        throw auraError('No columns were returned for ' + dmo + '.' + detail);
    }

    /**
     * Column names and types from Data Cloud query metadata.
     * CdpQueryMetadataItem exposes type as a String, so this does not depend on
     * JSON.serialize of the getAllMetadata response.
     */
    private static List<Map<String, String>> columnsFromDmoQuery(String dmoApiName, String spaceName) {
        if (!Pattern.matches('^[A-Za-z][A-Za-z0-9_]*$', dmoApiName)) {
            throw auraError('The Data360 DMO API name contains characters that cannot be queried.');
        }
        ConnectApi.CdpQueryInput input = new ConnectApi.CdpQueryInput();
        input.sql = 'SELECT * FROM ' + dmoApiName + ' LIMIT 1';
        ConnectApi.CdpQueryOutputV2 output = spaceName == null
            ? ConnectApi.CdpQuery.queryAnsiSqlV2(input)
            : ConnectApi.CdpQuery.queryAnsiSqlV2(input, spaceName);
        List<Map<String, String>> rows = new List<Map<String, String>>();
        if (output == null || output.metadata == null) {
            return rows;
        }
        for (String columnName : output.metadata.keySet()) {
            if (String.isBlank(columnName) || !isSafeColumnApi(columnName)) {
                continue;
            }
            ConnectApi.CdpQueryMetadataItem item = output.metadata.get(columnName);
            String dataType = item == null || String.isBlank(item.type) ? '' : item.type;
            rows.add(new Map<String, String>{
                'label' => columnName,
                'value' => columnName,
                'dataType' => dataType,
                'numeric' => isNumericDataType(dataType) ? 'true' : 'false',
                'entityDisplay' => dmoApiName
            });
        }
        rows.sort(new ColumnApiSort());
        return rows;
    }

    private static List<Map<String, String>> entityDefinitionFieldRows(String dmoApiName) {
        List<Map<String, String>> rows = new List<Map<String, String>>();
        try {
            for (FieldDefinition fd : [
                SELECT QualifiedApiName, Label, DataType
                FROM FieldDefinition
                WHERE EntityDefinition.QualifiedApiName = :dmoApiName
                LIMIT 2000
            ]) {
                if (String.isBlank(fd.QualifiedApiName) || !isSafeColumnApi(fd.QualifiedApiName)) {
                    continue;
                }
                rows.add(new Map<String, String>{
                    'label' => String.isNotBlank(fd.Label) ? fd.Label : fd.QualifiedApiName,
                    'value' => fd.QualifiedApiName,
                    'dataType' => fd.DataType == null ? '' : fd.DataType,
                    'numeric' => isNumericDataType(fd.DataType) ? 'true' : 'false'
                });
            }
        } catch (Exception e) {
            return rows;
        }
        return rows;
    }

    private static String requireDmoColumn(
        String raw,
        Map<String, String> canonicalByLower,
        Map<String, String> typeByLower,
        String label,
        Boolean numericOnly
    ) {
        if (String.isBlank(raw)) {
            throw new AuraHandledException(label + ' is required.');
        }
        String key = raw.trim().toLowerCase();
        if (!canonicalByLower.containsKey(key)) {
            throw new AuraHandledException(label + ' must be a column on the selected Data360 DMO.');
        }
        if (numericOnly && !isNumericDataType(typeByLower.get(key))) {
            throw new AuraHandledException(label + ' must be a number column that allows decimals.');
        }
        return canonicalByLower.get(key);
    }

    private static Boolean isNumericDataType(String dataType) {
        if (String.isBlank(dataType)) {
            return false;
        }
        String normalized = dataType.toLowerCase();
        Matcher scaled = Pattern.compile('(number|currency|percent|decimal|double)\\((\\d+),\\s*(\\d+)\\)').matcher(normalized);
        if (scaled.find()) {
            return Integer.valueOf(scaled.group(3)) > 0;
        }
        Boolean numericFamily = normalized.contains('number')
            || normalized.contains('currency')
            || normalized.contains('percent')
            || normalized.contains('double')
            || normalized.contains('decimal');
        if (normalized.contains('formula')) {
            return numericFamily;
        }
        return numericFamily;
    }

    private static Boolean isSafeColumnApi(String api) {
        return Pattern.matches('^[A-Za-z][A-Za-z0-9_]*$', api);
    }

    private static ScoreFormula buildScoreFormula(String column, String mode, Decimal factor, String label) {
        if (mode != 'AsIs' && mode != 'Multiply' && mode != 'Divide') {
            throw new AuraHandledException(label + ' formula is required.');
        }
        String token = '{' + column + '}';
        if (mode == 'AsIs') {
            return new ScoreFormula(mode, null, token);
        }
        if (factor == null || factor == 0) {
            throw new AuraHandledException(label + ' factor must be a non-zero number.');
        }
        String operator = mode == 'Multiply' ? '*' : '/';
        String factorText = factor.stripTrailingZeros().toPlainString();
        String expression = token + ' ' + operator + ' ' + factorText;
        if (expression.length() > 255) {
            throw new AuraHandledException(label + ' formula is too long.');
        }
        return new ScoreFormula(mode, factor, expression);
    }

    private class ScoreFormula {
        public String mode;
        public Decimal factor;
        public String expression;

        public ScoreFormula(String mode, Decimal factor, String expression) {
            this.mode = mode;
            this.factor = factor;
            this.expression = expression;
        }
    }
}