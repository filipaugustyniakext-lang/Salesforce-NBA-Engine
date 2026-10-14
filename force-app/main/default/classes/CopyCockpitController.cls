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
                   Product_Family__c, Product_Family__r.Name,
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
                   MessageVariantId__c,
                   MessageName__c,
                   MessageVariant__c,
                   Source_Template__c, Source_Template__r.Name,
                   Published_At__c,
                   MCE_Updated_At__c,
                   MCE_Last_Modified_By__c,
                   LastModifiedBy__c,
                   LastModifiedAt__c,
                   UpdatedAt__c,
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
    public static Marketing_Dictionary__c getProductFamilyForOffer(Id offerId) {
        if (offerId == null) return null;
        List<Offer_Version__c> versions = [
            SELECT Product_Family_Name__c
            FROM Offer_Version__c
            WHERE Offer_Lookup__c = :offerId
            AND Is_Active__c = true
            AND Product_Family_Name__c != null
            ORDER BY LastModifiedDate DESC
            LIMIT 1
        ];
        if (versions.isEmpty()) return null;
        List<Marketing_Dictionary__c> families = [
            SELECT Id, Name
            FROM Marketing_Dictionary__c
            WHERE Name = :versions[0].Product_Family_Name__c
            AND RecordType.DeveloperName = 'Product'
            AND Dictionary_Sub_Type__c = 'Product Family'
            LIMIT 1
        ];
        return families.isEmpty() ? null : families[0];
    }

    @AuraEnabled(cacheable=false)
    public static void saveMasterRowSettings(String settingsJson) {
        try {
            Map<String, Object> data = (Map<String, Object>) JSON.deserializeUntyped(settingsJson);
            String offerId = (String) data.get('offerId');
            String familyId = (String) data.get('productFamilyId');
            String sourceTemplateId = (String) data.get('sourceTemplateId');
            Id validatedTemplateId = resolveActiveValidatedTemplateId(sourceTemplateId);
            if (String.isNotBlank(sourceTemplateId) && validatedTemplateId == null) {
                throw new AuraHandledException('Select an active, validated source template.');
            }
            List<Object> variantIds = (List<Object>) data.get('variantIds');
            if (variantIds == null) {
                List<Object> variantsList = (List<Object>) data.get('variants');
                variantIds = new List<Object>();
                if (variantsList != null) {
                    for (Object varObj : variantsList) {
                        Map<String, Object> varData = (Map<String, Object>) varObj;
                        variantIds.add(varData.get('id'));
                    }
                }
            }

            List<CC_Message_Metadata__c> toUpdate = new List<CC_Message_Metadata__c>();
            for (Object idObj : variantIds) {
                if (idObj == null) {
                    continue;
                }
                CC_Message_Metadata__c rec = new CC_Message_Metadata__c();
                rec.Id = (Id) idObj;
                rec.Product_Family__c = String.isNotBlank(familyId) ? (Id) familyId : null;
                rec.Offer__c = String.isNotBlank(offerId) ? (Id) offerId : null;
                if (validatedTemplateId != null) {
                    rec.Source_Template__c = validatedTemplateId;
                }
                toUpdate.add(rec);
            }

            if (!toUpdate.isEmpty()) {
                if (validatedTemplateId != null) {
                    Set<Id> idsToValidate = new Set<Id>();
                    for (CC_Message_Metadata__c rec : toUpdate) {
                        idsToValidate.add(rec.Id);
                    }
                    assertCanAssignSourceTemplate(idsToValidate);
                }
                CopyCockpitModificationService.updateMetadata(toUpdate);
            }
        } catch (Exception e) {
            throw new AuraHandledException('Save failed: ' + e.getMessage());
        }
    }

    /**
     * Assigns one active, validated Channel Template to many message variants.
     */
    @AuraEnabled(cacheable=false)
    public static Integer updateMessageSourceTemplates(List<Id> messageIds, Id sourceTemplateId) {
        if (messageIds == null || messageIds.isEmpty()) {
            throw new AuraHandledException('Select at least one message variant.');
        }
        Id templateId = resolveActiveValidatedTemplateId(sourceTemplateId);
        if (templateId == null) {
            throw new AuraHandledException('Select an active, validated source template.');
        }

        Set<Id> uniqueIds = new Set<Id>(messageIds);
        assertCanAssignSourceTemplate(uniqueIds);
        List<CC_Message_Metadata__c> updates = new List<CC_Message_Metadata__c>();
        for (Id messageId : uniqueIds) {
            if (messageId == null) {
                continue;
            }
            updates.add(new CC_Message_Metadata__c(
                Id = messageId,
                Source_Template__c = templateId
            ));
        }
        if (updates.isEmpty()) {
            throw new AuraHandledException('Select at least one message variant.');
        }
        CopyCockpitModificationService.updateMetadata(updates);
        return updates.size();
    }

    @TestVisible
    private static void assertCanAssignSourceTemplate(Set<Id> messageIds) {
        if (messageIds == null || messageIds.isEmpty()) {
            return;
        }
        for (CC_Message_Metadata__c msg : [
            SELECT Id, Status__c
            FROM CC_Message_Metadata__c
            WHERE Id IN :messageIds
        ]) {
            if (msg.Status__c == 'Published') {
                throw new AuraHandledException(
                    'Cannot change source template for Published variants. ' +
                    'Set the variant to Inactive first, change the template, then validate and publish again.'
                );
            }
        }
    }

    private static Id resolveActiveValidatedTemplateId(String sourceTemplateId) {
        if (String.isBlank(sourceTemplateId)) {
            return null;
        }
        List<Channel_Template__c> templates = [
            SELECT Id
            FROM Channel_Template__c
            WHERE Id = :sourceTemplateId
            AND Status__c = 'Active'
            AND Validation_Status__c = 'Valid'
            LIMIT 1
        ];
        return templates.isEmpty() ? null : templates[0].Id;
    }

    /**
     * Persists manual display weight for a single variant (0–100 → Display_Probability_Manual__c).
     */
    @AuraEnabled(cacheable=false)
    public static void saveVariantDisplayWeight(Id recordId, Decimal weightPercent) {
        if (recordId == null) {
            throw new AuraHandledException('Variant Id is required.');
        }
        if (weightPercent == null) {
            throw new AuraHandledException('Weight is required.');
        }
        if (weightPercent < 0 || weightPercent > 100) {
            throw new AuraHandledException('Weight must be between 0 and 100.');
        }
        Decimal manual = (weightPercent / 100).setScale(4, System.RoundingMode.HALF_UP);
        CopyCockpitModificationService.updateMetadata(new CC_Message_Metadata__c(
            Id = recordId,
            Display_Probability_Manual__c = manual
        ));
    }

    /**
     * Taken variant numbers + shared language for a master stem within a channel type.
     */
    @AuraEnabled(cacheable=false)
    public static Map<String, Object> getStemVariantInfo(String nameStem, String channelType) {
        Map<String, Object> info = new Map<String, Object>{
            'variants' => new List<Decimal>(),
            'language' => null
        };
        if (String.isBlank(nameStem) || String.isBlank(channelType)) {
            return info;
        }
        List<CC_Message_Metadata__c> rows = queryByStem(nameStem.trim(), channelType);
        List<Decimal> variants = new List<Decimal>();
        String language = null;
        for (CC_Message_Metadata__c r : rows) {
            Decimal v = resolveVariantNumber(r, nameStem.trim());
            if (v != null) variants.add(v);
            if (language == null && String.isNotBlank(r.Language__c)) {
                language = r.Language__c;
            }
        }
        variants.sort();
        info.put('variants', variants);
        info.put('language', language);
        return info;
    }

    /**
     * Taken variant numbers for a master stem (PREFIX_Locale_MessageName) within a channel type.
     * Locale is CountryCode-LanguageCode (e.g. PL-EN).
     * Matches stem_N rows (and legacy rows whose Name equals the stem).
     */
    @AuraEnabled(cacheable=false)
    public static List<Decimal> getExistingVariants(String nameStem, String channelType) {
        Map<String, Object> info = getStemVariantInfo(nameStem, channelType);
        return (List<Decimal>) info.get('variants');
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
                   Product_Family__c, Product_Family__r.Name,
                   Campaign__c, Campaign__r.Name,
                   Source_Template__c, Source_Template__r.Name,
                   Canvas_Blocks_JSON__c,
                   MCE_Last_Modified_By__c, MCE_Updated_At__c,
                   LastModifiedBy__c, LastModifiedAt__c, UpdatedAt__c,
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
            String fullName = ((String) data.get('messageName'));
            if (String.isBlank(fullName)) {
                throw new AuraHandledException('Message name is required.');
            }
            fullName = fullName.trim();

            Decimal version = data.get('version') != null
                ? Decimal.valueOf(String.valueOf(data.get('version')))
                : 1;
            if (version == null || version < 1) version = 1;

            // Prefer client-composed full name; ensure it ends with _<version>.
            String stem = stripVariantSuffix(fullName);
            if (String.isBlank(stem)) {
                throw new AuraHandledException('Invalid message name. Expected ChannelPrefix_Locale_MessageName_Variant.');
            }
            String composed = stem + '_' + String.valueOf(version.intValue());

            String channelType = (String) data.get('channelType');
            List<CC_Message_Metadata__c> existing = queryByStem(stem, channelType);
            Set<Decimal> taken = new Set<Decimal>();
            String masterLanguage = null;
            for (CC_Message_Metadata__c r : existing) {
                Decimal v = resolveVariantNumber(r, stem);
                if (v != null) taken.add(v);
                if (masterLanguage == null && String.isNotBlank(r.Language__c)) {
                    masterLanguage = r.Language__c;
                }
            }
            if (taken.contains(version)) {
                throw new AuraHandledException(
                    'Variant ' + String.valueOf(version.intValue())
                    + ' already exists for this Message Name and Locale.'
                );
            }

            CC_Message_Metadata__c rec = new CC_Message_Metadata__c();
            rec.Name            = composed;
            rec.Version__c      = version;
            rec.Message_Variant__c = 'Variant ' + String.valueOf(version.intValue());
            // Language is master-scoped — new variants inherit existing master's language.
            rec.Language__c     = masterLanguage != null ? masterLanguage : (String) data.get('language');
            rec.Channel__c      = (String) data.get('channelName');
            rec.Channel_Type__c = channelType;
            if (String.isNotBlank((String) data.get('sourceTemplateId'))) {
                rec.Source_Template__c = (Id) data.get('sourceTemplateId');
            }
            rec.Status__c       = 'Draft';
            if (data.get('offerId') != null && String.isNotBlank((String) data.get('offerId'))) {
                rec.Offer__c = (Id) data.get('offerId');
            }
            if (data.get('productFamilyId') != null && String.isNotBlank((String) data.get('productFamilyId'))) {
                rec.Product_Family__c = (Id) data.get('productFamilyId');
            }
            if (data.get('messageSubtype') != null) {
                rec.Subject__c = (String) data.get('messageSubtype');
            }
            CopyCockpitModificationService.insertMetadata(rec);
            return rec.Id;
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException('Create failed: ' + e.getMessage());
        }
    }

    @AuraEnabled
    public static void saveMessageEditor(Id recordId, String status, String canvasJson) {
        if (recordId == null) {
            throw new AuraHandledException('Message is required.');
        }
        CC_Message_Metadata__c rec = [
            SELECT Id FROM CC_Message_Metadata__c WHERE Id = :recordId LIMIT 1
        ];
        if (String.isNotBlank(status)) {
            rec.Status__c = status;
        }
        rec.Canvas_Blocks_JSON__c = canvasJson;
        if (String.isNotBlank(canvasJson)) {
            try {
                List<Object> blocks = (List<Object>) JSON.deserializeUntyped(canvasJson);
                rec.Block_Count__c = blocks == null ? 0 : blocks.size();
            } catch (Exception ignored) {
                // Keep existing block count when canvas JSON is not a list.
            }
        }
        CopyCockpitModificationService.updateMetadata(rec);
    }

    private static final Set<String> ALLOWED_MESSAGE_STATUSES = new Set<String>{
        'Draft', 'Ready', 'Published', 'Inactive', 'Archived'
    };

    @AuraEnabled
    public static void updateMessageStatus(Id recordId, String status) {
        if (recordId == null) {
            throw new AuraHandledException('Message variant is required.');
        }
        if (String.isBlank(status) || !ALLOWED_MESSAGE_STATUSES.contains(status)) {
            throw new AuraHandledException(
                'Status must be one of: Draft, Ready, Published, Inactive, or Archived.'
            );
        }
        CC_Message_Metadata__c existing = [
            SELECT Status__c
            FROM CC_Message_Metadata__c
            WHERE Id = :recordId
            LIMIT 1
        ];
        assertAllowedStatusTransition(existing.Status__c, status);
        CopyCockpitModificationService.updateMetadata(
            new CC_Message_Metadata__c(Id = recordId, Status__c = status)
        );
    }

    @TestVisible
    private static void assertAllowedStatusTransition(String fromStatus, String toStatus) {
        String currentStatus = String.isBlank(fromStatus) ? 'Draft' : fromStatus.trim();
        String targetStatus = toStatus.trim();
        if (currentStatus == targetStatus) {
            return;
        }
        if (currentStatus == 'Published'
            && targetStatus != 'Archived'
            && targetStatus != 'Inactive') {
            throw new AuraHandledException(
                'Published messages can only be changed to Inactive or Archived.'
            );
        }
        if (currentStatus == 'Inactive'
            && targetStatus != 'Draft'
            && targetStatus != 'Ready'
            && targetStatus != 'Published'
            && targetStatus != 'Inactive') {
            throw new AuraHandledException(
                'Inactive messages can be set to Draft, Ready, or Published.'
            );
        }
        if (currentStatus == 'Archived' && targetStatus != 'Published') {
            throw new AuraHandledException(
                'Archived messages can only be restored to Published.'
            );
        }
    }

    @AuraEnabled
    public static Id cloneMessage(Id sourceId, Decimal newVersion) {
        try {
            if (newVersion == null || newVersion < 1) {
                throw new AuraHandledException('A valid variant number is required.');
            }
            CC_Message_Metadata__c src = [
                SELECT Name, Channel__c, Channel_Type__c,
                       Subject__c, Body__c, Language__c,
                       Source_Template__c, Canvas_Blocks_JSON__c,
                       Offer__c, Product_Family__c, Campaign__c,
                       Valid_From__c, Valid_To__c, Version__c
                FROM CC_Message_Metadata__c
                WHERE Id = :sourceId
                LIMIT 1
            ];
            String stem = stripVariantSuffix(src.Name);
            if (String.isBlank(stem)) {
                stem = src.Name;
            }
            List<CC_Message_Metadata__c> existing = queryByStem(stem, src.Channel_Type__c);
            for (CC_Message_Metadata__c r : existing) {
                Decimal v = resolveVariantNumber(r, stem);
                if (v == newVersion) {
                    throw new AuraHandledException(
                        'Variant ' + String.valueOf(newVersion.intValue()) + ' already exists for this message.'
                    );
                }
            }

            CC_Message_Metadata__c copy = src.clone(false, false, false, false);
            copy.Version__c = newVersion;
            copy.Name = stem + '_' + String.valueOf(newVersion.intValue());
            copy.Message_Variant__c = 'Variant ' + String.valueOf(newVersion.intValue());
            copy.Status__c  = 'Draft';
            CopyCockpitModificationService.insertMetadata(copy);
            return copy.Id;
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException('Clone failed: ' + e.getMessage());
        }
    }

    /**
     * Update master-level naming parts + language for every variant under oldStem.
     * Locale / Message Name changes rewrite each variant Name as newStem_VariantNumber.
     * Locale is CountryCode-LanguageCode. Channel prefix and variant numbers are preserved.
     */
    @AuraEnabled
    public static void updateMessageMaster(
        String oldStem,
        String countryCode,
        String messageNamePart,
        String language,
        String channelType
    ) {
        if (String.isBlank(oldStem) || String.isBlank(channelType)) {
            throw new AuraHandledException('Invalid master update parameters.');
        }
        String cc = countryCode == null ? '' : countryCode.trim().toUpperCase();
        String lang = language == null ? '' : language.trim().toUpperCase();
        String mn = messageNamePart == null ? '' : messageNamePart.trim();
        if (String.isBlank(cc) || String.isBlank(lang) || String.isBlank(mn)) {
            throw new AuraHandledException('Country Code, Language, and Message Name are required.');
        }

        ParsedName oldParsed = parseName(oldStem);
        String prefix = String.isNotBlank(oldParsed.prefix) ? oldParsed.prefix : oldStem.split('_')[0];
        String locale = cc + '-' + lang;
        String newStem = prefix + '_' + locale + '_' + mn;

        List<CC_Message_Metadata__c> rows = queryByStem(oldStem.trim(), channelType);
        if (rows.isEmpty()) {
            throw new AuraHandledException('No message variants found for this master.');
        }

        if (newStem != oldStem.trim()) {
            List<CC_Message_Metadata__c> collisions = queryByStem(newStem, channelType);
            if (!collisions.isEmpty()) {
                throw new AuraHandledException(
                    'A message with locale "' + locale + '" and Message Name "' + mn
                    + '" already exists on this channel.'
                );
            }
        }

        for (CC_Message_Metadata__c r : rows) {
            Decimal v = resolveVariantNumber(r, oldStem.trim());
            if (v == null) v = 1;
            r.Name = newStem + '_' + String.valueOf(v.intValue());
            r.Version__c = v;
            r.Message_Variant__c = 'Variant ' + String.valueOf(v.intValue());
            r.Language__c = lang;
        }
        try {
            CopyCockpitModificationService.updateMetadata(rows);
        } catch (DmlException e) {
            throw new AuraHandledException('Update failed: ' + e.getDmlMessage(0));
        }
    }

    /** @deprecated Prefer updateMessageMaster — kept for older clients. */
    @AuraEnabled
    public static void renameMessageGroup(String oldName, String newName, String channelType) {
        ParsedName parsedNew = parseName(newName);
        String stemOld = stripVariantSuffix(oldName);
        if (String.isBlank(stemOld)) stemOld = oldName;
        String cc = parsedNew.countryCode;
        String lang = parsedNew.language;
        String mn = parsedNew.messageName;
        if (String.isBlank(cc) || String.isBlank(mn)) {
            // Treat newName as a full stem PREFIX_Locale_MessageName
            ParsedName stemParts = parseName(stripVariantSuffix(newName));
            cc = stemParts.countryCode;
            lang = stemParts.language;
            mn = stemParts.messageName;
        }
        updateMessageMaster(stemOld, cc, mn, lang, channelType);
    }

    /**
     * Deletes Copy Center variants and their CC_Message_Blocks_All__c rows.
     */
    @AuraEnabled
    public static Integer deleteMessageVariants(List<Id> metadataIds) {
        if (metadataIds == null || metadataIds.isEmpty()) {
            throw new AuraHandledException('Select at least one message variant.');
        }
        Set<Id> idSet = new Set<Id>();
        for (Id metadataId : metadataIds) {
            if (metadataId != null) {
                idSet.add(metadataId);
            }
        }
        if (idSet.isEmpty()) {
            throw new AuraHandledException('Select at least one message variant.');
        }

        List<CC_Message_Metadata__c> rows = [
            SELECT Id, MessageVariantId__c, Message_Variant_Id__c,
                   MessageName__c, MessageVariant__c, Version__c
            FROM CC_Message_Metadata__c
            WHERE Id IN :idSet
        ];
        if (rows.isEmpty()) {
            throw new AuraHandledException('Message variant(s) not found.');
        }

        try {
            deleteBlocksForMetadataRows(rows);
            delete rows;
        } catch (DmlException e) {
            throw new AuraHandledException('Delete failed: ' + e.getDmlMessage(0));
        }
        return rows.size();
    }

    /** Deletes every variant in a master message group for the given channel. */
    @AuraEnabled
    public static Integer deleteMasterMessageGroup(String masterStem, String channelType) {
        if (String.isBlank(masterStem)) {
            throw new AuraHandledException('Message name is required.');
        }
        if (String.isBlank(channelType)) {
            throw new AuraHandledException('Channel type is required.');
        }
        List<CC_Message_Metadata__c> rows = queryByStem(masterStem.trim(), channelType);
        if (rows.isEmpty()) {
            throw new AuraHandledException('No variants found for this message.');
        }
        List<Id> ids = new List<Id>();
        for (CC_Message_Metadata__c row : rows) {
            ids.add(row.Id);
        }
        return deleteMessageVariants(ids);
    }

    /** @deprecated Prefer deleteMessageVariants — kept for older clients. */
    @AuraEnabled
    public static void deleteMessage(Id recordId) {
        deleteMessageVariants(new List<Id>{ recordId });
    }

    private static void deleteBlocksForMetadataRows(List<CC_Message_Metadata__c> rows) {
        if (rows == null || rows.isEmpty()) {
            return;
        }
        Set<String> variantKeys = new Set<String>();
        Set<Decimal> variantNumbers = new Set<Decimal>();
        Set<String> messageNames = new Set<String>();

        for (CC_Message_Metadata__c row : rows) {
            String variantKey = resolveExternalVariantId(row);
            if (String.isNotBlank(variantKey)) {
                variantKeys.add(variantKey.trim());
            }
            Decimal variantNum = row.MessageVariant__c != null ? row.MessageVariant__c : row.Version__c;
            if (variantNum != null) {
                variantNumbers.add(variantNum);
            }
            if (String.isNotBlank(row.MessageName__c)) {
                messageNames.add(row.MessageName__c.trim());
            }
        }

        Set<Id> blockIds = new Set<Id>();
        if (!variantKeys.isEmpty()) {
            for (CC_Message_Blocks_All__c block : [
                SELECT Id
                FROM CC_Message_Blocks_All__c
                WHERE MessageVariantId__c IN :variantKeys
            ]) {
                blockIds.add(block.Id);
            }
        }
        if (!messageNames.isEmpty() && !variantNumbers.isEmpty()) {
            for (CC_Message_Blocks_All__c block : [
                SELECT Id
                FROM CC_Message_Blocks_All__c
                WHERE MessageName__c IN :messageNames
                  AND MessageVariant__c IN :variantNumbers
            ]) {
                blockIds.add(block.Id);
            }
        }
        if (blockIds.isEmpty()) {
            return;
        }
        delete [SELECT Id FROM CC_Message_Blocks_All__c WHERE Id IN :blockIds];
    }

    private static String resolveExternalVariantId(CC_Message_Metadata__c row) {
        if (row == null) {
            return null;
        }
        if (String.isNotBlank(row.MessageVariantId__c)) {
            return row.MessageVariantId__c.trim();
        }
        if (String.isNotBlank(row.Message_Variant_Id__c)) {
            return row.Message_Variant_Id__c.trim();
        }
        return null;
    }

    // ── Naming helpers ────────────────────────────────────────────────────────

    private class ParsedName {
        public String prefix;
        public String locale;
        public String countryCode;
        public String language;
        public String messageName;
        public Decimal variant;
    }

    /** Locale token is CountryCode-LanguageCode. Legacy names may store CountryCode only. */
    private static void applyLocaleToken(ParsedName p, String token) {
        if (String.isBlank(token)) return;
        Integer dash = token.indexOf('-');
        if (dash > 0 && dash < token.length() - 1) {
            p.countryCode = token.substring(0, dash).toUpperCase();
            p.language = token.substring(dash + 1).toUpperCase();
            p.locale = p.countryCode + '-' + p.language;
        } else {
            p.countryCode = token.toUpperCase();
            p.locale = p.countryCode;
        }
    }

    private static ParsedName parseName(String fullName) {
        ParsedName p = new ParsedName();
        if (String.isBlank(fullName)) return p;
        List<String> parts = fullName.split('_');
        if (parts.isEmpty()) return p;
        p.prefix = parts[0];
        if (parts.size() >= 2) applyLocaleToken(p, parts[1]);
        if (parts.size() >= 3) {
            String last = parts[parts.size() - 1];
            Boolean lastIsVariant = last.isNumeric() && parts.size() >= 4;
            if (lastIsVariant) {
                p.variant = Decimal.valueOf(last);
                List<String> mid = new List<String>();
                for (Integer i = 2; i < parts.size() - 1; i++) mid.add(parts[i]);
                p.messageName = String.join(mid, '_');
            } else {
                List<String> mid = new List<String>();
                for (Integer i = 2; i < parts.size(); i++) mid.add(parts[i]);
                p.messageName = String.join(mid, '_');
            }
        }
        return p;
    }

    private static String stripVariantSuffix(String fullName) {
        if (String.isBlank(fullName)) return fullName;
        List<String> parts = fullName.split('_');
        if (parts.size() < 4) return fullName;
        String last = parts[parts.size() - 1];
        if (!last.isNumeric()) return fullName;
        List<String> stemParts = new List<String>();
        for (Integer i = 0; i < parts.size() - 1; i++) stemParts.add(parts[i]);
        return String.join(stemParts, '_');
    }

    private static Decimal resolveVariantNumber(String fullName, Decimal versionField, String stem) {
        if (versionField != null) {
            return versionField;
        }
        if (String.isNotBlank(fullName) && String.isNotBlank(stem) && fullName.startsWith(stem + '_')) {
            String suffix = fullName.substring(stem.length() + 1);
            if (suffix.isNumeric()) return Decimal.valueOf(suffix);
        }
        ParsedName p = parseName(fullName);
        if (p.variant != null) return p.variant;
        return versionField;
    }

    private static Decimal resolveVariantNumber(CC_Message_Metadata__c row, String stem) {
        if (row == null) return null;
        if (String.isNotBlank(row.MessageName__c) && String.isNotBlank(stem)
            && row.MessageName__c.trim().equalsIgnoreCase(stem.trim())) {
            if (row.MessageVariant__c != null) return row.MessageVariant__c;
            if (row.Version__c != null) return row.Version__c;
        }
        return resolveVariantNumber(row.Name, row.Version__c, stem);
    }

    private static List<CC_Message_Metadata__c> queryByStem(String stem, String channelType) {
        if (String.isBlank(stem) || String.isBlank(channelType)) {
            return new List<CC_Message_Metadata__c>();
        }
        String likePattern = stem + '_%';
        List<CC_Message_Metadata__c> candidates = [
            SELECT Id, Name, Version__c, Language__c, MessageName__c, MessageVariant__c,
                   MessageVariantId__c, Message_Variant_Id__c
            FROM CC_Message_Metadata__c
            WHERE Channel_Type__c = :channelType
              AND (MessageName__c = :stem OR Name = :stem OR Name LIKE :likePattern)
            LIMIT 500
        ];
        List<CC_Message_Metadata__c> matched = new List<CC_Message_Metadata__c>();
        String stemTrim = stem.trim();
        for (CC_Message_Metadata__c r : candidates) {
            if (String.isNotBlank(r.MessageName__c) && r.MessageName__c.trim() == stemTrim) {
                matched.add(r);
                continue;
            }
            if (r.Name == stem) {
                matched.add(r);
                continue;
            }
            if (r.Name != null && r.Name.startsWith(stem + '_')) {
                String suffix = r.Name.substring(stem.length() + 1);
                if (suffix.isNumeric()) matched.add(r);
            }
        }
        return matched;
    }

    /**
     * Published Copy Center variants for the campaign wizard (step 3).
     * Matches channel(s) from step 1 and product family name and/or offer from step 2.
     */
    @AuraEnabled(cacheable=false)
    public static List<CC_Message_Metadata__c> getPublishedVariantsForWizard(
        List<String> channelTypes,
        List<String> productFamilyNames,
        List<String> offerIds
    ) {
        List<String> channels = new List<String>();
        if (channelTypes != null) {
            for (String channelType : channelTypes) {
                if (String.isNotBlank(channelType)) {
                    channels.add(channelType.trim());
                }
            }
        }
        if (channels.isEmpty()) {
            return new List<CC_Message_Metadata__c>();
        }

        Set<String> familyNames = new Set<String>();
        if (productFamilyNames != null) {
            for (String familyName : productFamilyNames) {
                if (String.isNotBlank(familyName)) {
                    familyNames.add(familyName.trim());
                }
            }
        }

        Set<Id> offerIdSet = new Set<Id>();
        if (offerIds != null) {
            for (String offerId : offerIds) {
                if (String.isNotBlank(offerId)) {
                    offerIdSet.add((Id) offerId);
                }
            }
        }

        if (familyNames.isEmpty() && offerIdSet.isEmpty()) {
            return new List<CC_Message_Metadata__c>();
        }

        List<String> offeringFilters = new List<String>();
        if (!familyNames.isEmpty()) {
            offeringFilters.add('Product_Family__r.Name IN :familyNames');
        }
        if (!offerIdSet.isEmpty()) {
            offeringFilters.add('Offer__c IN :offerIdSet');
        }

        String offeringClause = String.join(offeringFilters, ' OR ');
        String soql =
            'SELECT Id, Name, Channel_Type__c, Status__c, Language__c,' +
            ' Offer__c, Offer__r.Name, Product_Family__c, Product_Family__r.Name,' +
            ' MessageName__c, MessageVariant__c, MessageType__c,' +
            ' Message_Variant_Id__c, Message_Variant__c, Message_Type__c, Version__c,' +
            ' Display_Probability__c, Display_Probability_Manual__c' +
            ' FROM CC_Message_Metadata__c' +
            ' WHERE Status__c = \'Published\'' +
            ' AND Channel_Type__c IN :channels' +
            ' AND (' + offeringClause + ')' +
            ' ORDER BY Name ASC, Version__c ASC NULLS LAST' +
            ' LIMIT 2000';

        return Database.query(soql);
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