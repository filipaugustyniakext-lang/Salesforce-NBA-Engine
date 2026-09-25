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
            Decimal v = resolveVariantNumber(r.Name, r.Version__c, nameStem.trim());
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
                Decimal v = resolveVariantNumber(r.Name, r.Version__c, stem);
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
            rec.Status__c       = 'Draft';
            if (data.get('offerId') != null && String.isNotBlank((String) data.get('offerId'))) {
                rec.Offer__c = (Id) data.get('offerId');
            }
            if (data.get('messageSubtype') != null) {
                rec.Subject__c = (String) data.get('messageSubtype');
            }
            insert rec;
            return rec.Id;
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException('Create failed: ' + e.getMessage());
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
                       Offer__c, Campaign__c,
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
                Decimal v = resolveVariantNumber(r.Name, r.Version__c, stem);
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
            insert copy;
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
            Decimal v = resolveVariantNumber(r.Name, r.Version__c, oldStem.trim());
            if (v == null) v = 1;
            r.Name = newStem + '_' + String.valueOf(v.intValue());
            r.Version__c = v;
            r.Message_Variant__c = 'Variant ' + String.valueOf(v.intValue());
            r.Language__c = lang;
        }
        try {
            update rows;
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

    @AuraEnabled
    public static void deleteMessage(Id recordId) {
        try {
            delete new CC_Message_Metadata__c(Id = recordId);
        } catch (DmlException e) {
            throw new AuraHandledException('Delete failed: ' + e.getDmlMessage(0));
        }
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
        if (String.isNotBlank(fullName) && String.isNotBlank(stem) && fullName.startsWith(stem + '_')) {
            String suffix = fullName.substring(stem.length() + 1);
            if (suffix.isNumeric()) return Decimal.valueOf(suffix);
        }
        ParsedName p = parseName(fullName);
        if (p.variant != null) return p.variant;
        return versionField;
    }

    private static List<CC_Message_Metadata__c> queryByStem(String stem, String channelType) {
        if (String.isBlank(stem) || String.isBlank(channelType)) {
            return new List<CC_Message_Metadata__c>();
        }
        String likePattern = stem + '_%';
        List<CC_Message_Metadata__c> candidates = [
            SELECT Id, Name, Version__c, Language__c
            FROM CC_Message_Metadata__c
            WHERE Channel_Type__c = :channelType
              AND (Name = :stem OR Name LIKE :likePattern)
            LIMIT 500
        ];
        List<CC_Message_Metadata__c> matched = new List<CC_Message_Metadata__c>();
        for (CC_Message_Metadata__c r : candidates) {
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