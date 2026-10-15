/**
 * Blocks Marketing Dictionary deletes when NBA components still reference the dictionary Id.
 * Surfaces rename warnings when NBA processes store the dictionary label (not Id).
 */
public with sharing class MarketingDictionaryDeleteGuard {

    private static final Integer MAX_DEPENDENCY_LABELS = 12;

    public class RenameImpact {
        @AuraEnabled public Boolean requiresConfirmation;
        @AuraEnabled public String message;

        public RenameImpact(Boolean requiresConfirmation, String message) {
            this.requiresConfirmation = requiresConfirmation;
            this.message = message;
        }
    }

    public static List<String> collectBlockingDependencies(Marketing_Dictionary__c dictionaryRecord) {
        List<String> dependencies = new List<String>();
        if (dictionaryRecord == null || dictionaryRecord.Id == null) {
            return dependencies;
        }
        String subType = dictionaryRecord.Dictionary_Sub_Type__c;
        Id recordId = dictionaryRecord.Id;
        String rtDevName = dictionaryRecord.RecordType != null
            ? dictionaryRecord.RecordType.DeveloperName
            : null;

        if (subType == 'Customer Type') {
            collectCustomerTypeDependencies(recordId, dependencies);
        } else if (subType == 'Audience Type') {
            collectAudienceTypeDependencies(recordId, dependencies);
        } else if (subType == 'Product Family') {
            collectProductFamilyDependencies(recordId, dependencies);
        } else if (subType == 'Family of Needs') {
            collectFamilyOfNeedsDependencies(recordId, dependencies);
        } else if (subType == 'Product Type') {
            collectProductTypeDependencies(recordId, dependencies);
        } else if (subType == 'Campaign Type') {
            collectCampaignTypeDependencies(recordId, dictionaryRecord.Name, dependencies);
        } else if (subType == 'Campaign Group') {
            collectCampaignGroupDependencies(recordId, dependencies);
        } else if (subType == 'Topic') {
            collectTopicDependencies(recordId, dependencies);
        } else if (subType == 'Topic Group') {
            collectTopicGroupDependencies(recordId, dependencies);
        } else if (subType == 'Scoring Model') {
            collectScoringModelDependencies(recordId, dependencies);
        } else if (subType == 'Scoring Model Group') {
            collectScoringModelGroupDependencies(recordId, dependencies);
        } else if (rtDevName == 'Offer') {
            collectOfferAttributeDependencies(dictionaryRecord, dependencies);
        } else if (rtDevName == 'Channel') {
            collectChannelDependencies(dictionaryRecord, dependencies);
        }
        return dependencies;
    }

    public static void assertCampaignTierDeletable(Id tierId) {
        if (tierId == null) {
            return;
        }
        Campaign_Tier__c tier = [
            SELECT Id, Name, Tier_Number__c
            FROM Campaign_Tier__c
            WHERE Id = :tierId
            LIMIT 1
        ];
        List<String> dependencies = new List<String>();
        String tierLabel = tierLabelForNumber(tier.Tier_Number__c);
        if (String.isNotBlank(tierLabel)) {
            for (Campaign camp : [
                SELECT Name
                FROM Campaign
                WHERE Priority_Tier__c = :tierLabel
                ORDER BY Name ASC
                LIMIT :MAX_DEPENDENCY_LABELS
            ]) {
                addDependency(dependencies, 'Campaign (Priority Tier)', camp.Name);
            }
        }
        throwIfBlocked(tier.Name, dependencies);
    }

    public static void assertOfferReferenceValueDeletable(Id referenceValueId) {
        if (referenceValueId == null) {
            return;
        }
        Offer_Reference_Value__c refVal = [
            SELECT Id, Name
            FROM Offer_Reference_Value__c
            WHERE Id = :referenceValueId
            LIMIT 1
        ];
        List<String> dependencies = new List<String>();
        for (Offer_Attribute_Rule__c rule : [
            SELECT Offer_Attribute__r.Name, Product_Family__r.Name
            FROM Offer_Attribute_Rule__c
            WHERE Reference_Value__c = :referenceValueId
            ORDER BY Offer_Attribute__r.Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Offer attribute rule', rule.Offer_Attribute__r?.Name);
        }
        throwIfBlocked(refVal.Name, dependencies);
    }

    @AuraEnabled
    public static RenameImpact getRenameImpact(Id recordId, String proposedName) {
        if (recordId == null || String.isBlank(proposedName)) {
            return new RenameImpact(false, null);
        }
        Marketing_Dictionary__c rec = [
            SELECT Id, Name, Dictionary_Sub_Type__c, Channel_Type__c, RecordType.DeveloperName
            FROM Marketing_Dictionary__c
            WHERE Id = :recordId
            LIMIT 1
        ];
        String oldName = rec.Name;
        String newName = proposedName.trim();
        if (String.isBlank(oldName) || oldName.trim() == newName) {
            return new RenameImpact(false, null);
        }

        List<String> reasons = new List<String>();
        String subType = rec.Dictionary_Sub_Type__c;
        String rtDevName = rec.RecordType != null ? rec.RecordType.DeveloperName : null;

        if (subType == 'Campaign Type') {
            collectCampaignTypeLabelImpact(oldName, reasons);
        } else if (rtDevName == 'Channel') {
            collectChannelLabelImpact(rec, oldName, reasons);
        }

        if (reasons.isEmpty()) {
            return new RenameImpact(false, null);
        }
        String detail = String.join(reasons, ' ');
        String message =
            'Some NBA processes store this dictionary label directly (not the record Id). '
            + 'Renaming "' + oldName + '" to "' + newName + '" may change how those processes match this value. '
            + detail
            + ' Continue with the rename?';
        return new RenameImpact(true, message);
    }

    // ─── Customer / Audience / Product sub-types ───────────────────────────

    private static void collectCustomerTypeDependencies(Id recordId, List<String> dependencies) {
        for (Product_Customer_Type__c link : [
            SELECT Product__r.Name
            FROM Product_Customer_Type__c
            WHERE Customer_Type__c = :recordId
            ORDER BY Product__r.Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Product', link.Product__r?.Name);
        }
        for (FamilyOfNeeds_CustomerType__c link : [
            SELECT Family_of_Needs__r.Name
            FROM FamilyOfNeeds_CustomerType__c
            WHERE Customer_Type__c = :recordId
            ORDER BY Family_of_Needs__r.Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Family of Needs dictionary', link.Family_of_Needs__r?.Name);
        }
        for (Offer_Version_Customer_Type__c link : [
            SELECT Offer_Version__r.Name
            FROM Offer_Version_Customer_Type__c
            WHERE Customer_Type__c = :recordId
            ORDER BY Offer_Version__r.Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Offer Version', link.Offer_Version__r?.Name);
        }
    }

    private static void collectAudienceTypeDependencies(Id recordId, List<String> dependencies) {
        for (Channel_Cooldown__c cooldown : [
            SELECT Name, Channel__r.Name
            FROM Channel_Cooldown__c
            WHERE Audience_Type_Dict__c = :recordId
            ORDER BY Channel__r.Name ASC, Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            String channelName = cooldown.Channel__r?.Name;
            String label = String.isNotBlank(channelName)
                ? 'Channel cooldown (' + channelName + ')'
                : 'Channel cooldown rule';
            addDependency(dependencies, label, cooldown.Name);
        }
    }

    private static void collectProductFamilyDependencies(Id recordId, List<String> dependencies) {
        for (Product2 product : [
            SELECT Name
            FROM Product2
            WHERE Product_Family_Dict__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Product', product.Name);
        }
        collectCampaignIdListReferences(
            recordId,
            'Product_Family_Ids__c',
            'Campaign (Product Family)',
            dependencies
        );
        for (Campaign_Scoring_Apriori_State__c state : [
            SELECT Name
            FROM Campaign_Scoring_Apriori_State__c
            WHERE Product_Family_Dict__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Apriori scoring state', state.Name);
        }
        for (Offer_Attribute_Rule__c rule : [
            SELECT Offer_Attribute__r.Name
            FROM Offer_Attribute_Rule__c
            WHERE Product_Family__c = :recordId
            ORDER BY Offer_Attribute__r.Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Offer attribute rule', rule.Offer_Attribute__r?.Name);
        }
        for (Offer_Reference_Value__c refVal : [
            SELECT Name
            FROM Offer_Reference_Value__c
            WHERE Product_Family__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Offer reference value', refVal.Name);
        }
        for (CC_Message_Metadata__c variant : [
            SELECT Name
            FROM CC_Message_Metadata__c
            WHERE Product_Family__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Copy variant', variant.Name);
        }
        collectScoringModelOfferingTokens(recordId, 'Product Family', dependencies);
    }

    private static void collectFamilyOfNeedsDependencies(Id recordId, List<String> dependencies) {
        for (Product2 product : [
            SELECT Name
            FROM Product2
            WHERE Family_of_Needs_Dict__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Product', product.Name);
        }
        collectCampaignIdListReferences(
            recordId,
            'Family_of_Needs_Ids__c',
            'Campaign (Family of Needs)',
            dependencies
        );
        for (Marketing_Dictionary__c pf : [
            SELECT Name
            FROM Marketing_Dictionary__c
            WHERE Related_Family_of_Needs__c = :recordId
            AND Dictionary_Sub_Type__c = 'Product Family'
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Product Family dictionary', pf.Name);
        }
        collectScoringModelOfferingTokens(recordId, 'Family of Needs', dependencies);
    }

    private static void collectProductTypeDependencies(Id recordId, List<String> dependencies) {
        for (Product2 product : [
            SELECT Name
            FROM Product2
            WHERE Product_Type_Dict__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Product', product.Name);
        }
        for (Marketing_Dictionary__c pf : [
            SELECT Name
            FROM Marketing_Dictionary__c
            WHERE Related_Product_Type__c = :recordId
            AND Dictionary_Sub_Type__c = 'Product Family'
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Product Family dictionary', pf.Name);
        }
    }

    // ─── Campaign dictionary sub-types ─────────────────────────────────────

    private static void collectCampaignTypeDependencies(
        Id recordId,
        String typeName,
        List<String> dependencies
    ) {
        if (String.isNotBlank(typeName)) {
            for (Campaign camp : [
                SELECT Name
                FROM Campaign
                WHERE Activation_Type__c = :typeName
                ORDER BY Name ASC
                LIMIT :MAX_DEPENDENCY_LABELS
            ]) {
                addDependency(dependencies, 'Campaign (Activation Type)', camp.Name);
            }
            collectTierSupportedTypeReferences(typeName, dependencies);
        }
        for (Marketing_Dictionary__c grp : [
            SELECT Name
            FROM Marketing_Dictionary__c
            WHERE Dictionary_Sub_Type__c = 'Campaign Group'
            AND Campaign_Type_Dict__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Campaign Group dictionary', grp.Name);
        }
    }

    private static void collectCampaignGroupDependencies(Id recordId, List<String> dependencies) {
        for (Campaign camp : [
            SELECT Name
            FROM Campaign
            WHERE Campaign_Group_Dict__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Campaign', camp.Name);
        }
    }

    private static void collectTopicDependencies(Id recordId, List<String> dependencies) {
        for (Campaign camp : [
            SELECT Name
            FROM Campaign
            WHERE Topic_Dict__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Campaign (Topic)', camp.Name);
        }
        for (Marketing_Dictionary__c model : [
            SELECT Name
            FROM Marketing_Dictionary__c
            WHERE Dictionary_Sub_Type__c = 'Scoring Model'
            AND Assigned_Topic_Dict__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Scoring Model', model.Name);
        }
        for (Campaign_Scoring_Apriori_State__c state : [
            SELECT Name
            FROM Campaign_Scoring_Apriori_State__c
            WHERE Topic_Dict__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Apriori scoring state', state.Name);
        }
        for (Campaign_Scoring_Apriori_History__c hist : [
            SELECT Name
            FROM Campaign_Scoring_Apriori_History__c
            WHERE Topic_Dict__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Apriori scoring history', hist.Name);
        }
        collectCopyTopicTextReferences(recordId, dependencies);
    }

    private static void collectTopicGroupDependencies(Id recordId, List<String> dependencies) {
        for (Marketing_Dictionary__c topic : [
            SELECT Name
            FROM Marketing_Dictionary__c
            WHERE Dictionary_Sub_Type__c = 'Topic'
            AND Topic_Group_Dict__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Topic dictionary', topic.Name);
        }
    }

    private static void collectScoringModelDependencies(Id recordId, List<String> dependencies) {
        for (Campaign camp : [
            SELECT Name
            FROM Campaign
            WHERE Scoring_Model_Dict__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Campaign (Scoring Model)', camp.Name);
        }
        for (Scoring_Model_Setting__c setting : [
            SELECT Name
            FROM Scoring_Model_Setting__c
            WHERE Scoring_Model__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Scoring Model setting', setting.Name);
        }
    }

    private static void collectScoringModelGroupDependencies(Id recordId, List<String> dependencies) {
        for (Marketing_Dictionary__c model : [
            SELECT Name
            FROM Marketing_Dictionary__c
            WHERE Dictionary_Sub_Type__c = 'Scoring Model'
            AND Scoring_Model_Group_Dict__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Scoring Model', model.Name);
        }
    }

    // ─── Offer attribute & Channel ───────────────────────────────────────────

    private static void collectOfferAttributeDependencies(
        Marketing_Dictionary__c attribute,
        List<String> dependencies
    ) {
        Id recordId = attribute.Id;
        for (Offer_Attribute_Rule__c rule : [
            SELECT Product_Family__r.Name
            FROM Offer_Attribute_Rule__c
            WHERE Offer_Attribute__c = :recordId
            ORDER BY Product_Family__r.Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Offer attribute rule', rule.Product_Family__r?.Name);
        }
        collectOfferVersionFieldPopulation(attribute, dependencies);
    }

    private static void collectOfferVersionFieldPopulation(
        Marketing_Dictionary__c attribute,
        List<String> dependencies
    ) {
        if (dependencies.size() >= MAX_DEPENDENCY_LABELS) {
            return;
        }
        String apiName = attribute.Parameter_API_Name__c;
        if (String.isBlank(apiName)) {
            return;
        }
        Map<String, Schema.SObjectField> fieldMap = Schema.SObjectType.Offer_Version__c.fields.getMap();
        if (!fieldMap.containsKey(apiName.toLowerCase())) {
            return;
        }
        String query =
            'SELECT Offer_Lookup__r.Name FROM Offer_Version__c WHERE '
            + apiName
            + ' != null ORDER BY Offer_Lookup__r.Name ASC LIMIT '
            + MAX_DEPENDENCY_LABELS;
        for (Offer_Version__c ver : (List<Offer_Version__c>) Database.query(query)) {
            addDependency(dependencies, 'Offer', ver.Offer_Lookup__r?.Name);
            if (dependencies.size() >= MAX_DEPENDENCY_LABELS) {
                return;
            }
        }
    }

    private static void collectChannelDependencies(
        Marketing_Dictionary__c channel,
        List<String> dependencies
    ) {
        Id recordId = channel.Id;
        String channelName = channel.Name;
        String channelType = channel.Channel_Type__c;

        for (Channel_Cooldown__c cooldown : [
            SELECT Name
            FROM Channel_Cooldown__c
            WHERE Channel__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Channel cooldown rule', cooldown.Name);
        }
        for (Blackout_Day_Rule__c rule : [
            SELECT Name
            FROM Blackout_Day_Rule__c
            WHERE Channel__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Blackout day rule', rule.Name);
        }
        for (Channel_Template__c tmpl : [
            SELECT Name
            FROM Channel_Template__c
            WHERE Channel__c = :recordId
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Channel template', tmpl.Name);
        }
        collectCampaignAssignedChannelReferences(channelName, dependencies);
        collectBlackoutWindowChannelReferences(channelName, dependencies);
        collectCopyChannelReferences(channelName, channelType, dependencies);
    }

    // ─── Rename label impact (not Id-based) ──────────────────────────────────

    private static void collectCampaignTypeLabelImpact(String oldName, List<String> reasons) {
        Integer campCount = [
            SELECT COUNT()
            FROM Campaign
            WHERE Activation_Type__c = :oldName
        ];
        if (campCount > 0) {
            reasons.add(
                campCount + ' campaign(s) store Activation Type "' + oldName + '".'
            );
        }
        Integer tierHits = 0;
        for (Campaign_Tier__c tier : [
            SELECT Supported_Campaign_Types__c
            FROM Campaign_Tier__c
            LIMIT 500
        ]) {
            if (supportedTypesContain(tier.Supported_Campaign_Types__c, oldName)) {
                tierHits++;
            }
        }
        if (tierHits > 0) {
            reasons.add(
                tierHits + ' tier definition(s) list "' + oldName + '" in Supported Campaign Types.'
            );
        }
    }

    private static void collectChannelLabelImpact(
        Marketing_Dictionary__c channel,
        String oldName,
        List<String> reasons
    ) {
        Integer campHits = 0;
        for (Campaign camp : [
            SELECT Assigned_Channels__c
            FROM Campaign
            LIMIT 5000
        ]) {
            if (semicolonListContainsLabel(camp.Assigned_Channels__c, oldName)) {
                campHits++;
            }
        }
        if (campHits > 0) {
            reasons.add(campHits + ' campaign(s) include channel name "' + oldName + '".');
        }
        Integer windowHits = 0;
        for (Blackout_Window__c window : [
            SELECT Assigned_Channels__c
            FROM Blackout_Window__c
            LIMIT 5000
        ]) {
            if (semicolonListContainsLabel(window.Assigned_Channels__c, oldName)) {
                windowHits++;
            }
        }
        if (windowHits > 0) {
            reasons.add(windowHits + ' blackout window(s) include channel name "' + oldName + '".');
        }
        if (String.isNotBlank(oldName)) {
            Integer copyNameHits = [
                SELECT COUNT()
                FROM CC_Message_Metadata__c
                WHERE Channel__c = :oldName
            ];
            if (copyNameHits > 0) {
                reasons.add(copyNameHits + ' Copy Center message(s) use Channel "' + oldName + '".');
            }
        }
        if (String.isNotBlank(channel.Channel_Type__c)) {
            Integer copyTypeHits = [
                SELECT COUNT()
                FROM CC_Message_Metadata__c
                WHERE Channel_Type__c = :channel.Channel_Type__c
            ];
            if (copyTypeHits > 0) {
                reasons.add(
                    copyTypeHits + ' Copy Center message(s) use Channel Type "'
                    + channel.Channel_Type__c + '".'
                );
            }
        }
    }

    // ─── Shared scanners ─────────────────────────────────────────────────────

    private static void collectCampaignIdListReferences(
        Id dictionaryId,
        String campaignFieldApi,
        String dependencyPrefix,
        List<String> dependencies
    ) {
        if (dependencies.size() >= MAX_DEPENDENCY_LABELS) {
            return;
        }
        String query = 'SELECT Id, Name, ' + campaignFieldApi + ' FROM Campaign LIMIT 5000';
        for (Campaign campaign : (List<Campaign>) Database.query(query)) {
            String raw = (String) campaign.get(campaignFieldApi);
            if (containsDictionaryId(raw, dictionaryId)) {
                addDependency(dependencies, dependencyPrefix, campaign.Name);
            }
            if (dependencies.size() >= MAX_DEPENDENCY_LABELS) {
                return;
            }
        }
    }

    private static void collectScoringModelOfferingTokens(
        Id dictionaryId,
        String offeringType,
        List<String> dependencies
    ) {
        if (dependencies.size() >= MAX_DEPENDENCY_LABELS) {
            return;
        }
        for (Marketing_Dictionary__c model : [
            SELECT Name, Product_Family__c, Family_of_Needs__c, Offering_Type__c
            FROM Marketing_Dictionary__c
            WHERE Dictionary_Sub_Type__c = 'Scoring Model'
            AND Offering_Type__c = :offeringType
            LIMIT 500
        ]) {
            String raw = offeringType == 'Product Family'
                ? model.Product_Family__c
                : model.Family_of_Needs__c;
            if (String.isBlank(raw)) {
                continue;
            }
            if (containsDictionaryId(raw, dictionaryId)) {
                addDependency(dependencies, 'Scoring Model', model.Name);
            }
            if (dependencies.size() >= MAX_DEPENDENCY_LABELS) {
                return;
            }
        }
    }

    private static void collectTierSupportedTypeReferences(String typeName, List<String> dependencies) {
        if (dependencies.size() >= MAX_DEPENDENCY_LABELS || String.isBlank(typeName)) {
            return;
        }
        for (Campaign_Tier__c tier : [
            SELECT Name, Supported_Campaign_Types__c
            FROM Campaign_Tier__c
            ORDER BY Tier_Number__c ASC NULLS LAST
            LIMIT 500
        ]) {
            if (supportedTypesContain(tier.Supported_Campaign_Types__c, typeName)) {
                addDependency(dependencies, 'Tier definition', tier.Name);
            }
            if (dependencies.size() >= MAX_DEPENDENCY_LABELS) {
                return;
            }
        }
    }

    private static void collectCopyTopicTextReferences(Id topicId, List<String> dependencies) {
        if (dependencies.size() >= MAX_DEPENDENCY_LABELS) {
            return;
        }
        String id18 = String.valueOf(topicId);
        String id15 = id18.length() == 18 ? id18.substring(0, 15) : id18;
        for (CC_Message_Metadata__c row : [
            SELECT Name, TopicGoalId__c, Topic_Goal_Id__c
            FROM CC_Message_Metadata__c
            WHERE TopicGoalId__c = :id18
               OR TopicGoalId__c = :id15
               OR Topic_Goal_Id__c = :id18
               OR Topic_Goal_Id__c = :id15
            ORDER BY Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Copy variant (Topic)', row.Name);
        }
    }

    private static void collectCampaignAssignedChannelReferences(
        String channelName,
        List<String> dependencies
    ) {
        if (dependencies.size() >= MAX_DEPENDENCY_LABELS || String.isBlank(channelName)) {
            return;
        }
        for (Campaign camp : [
            SELECT Name, Assigned_Channels__c
            FROM Campaign
            LIMIT 5000
        ]) {
            if (semicolonListContainsLabel(camp.Assigned_Channels__c, channelName)) {
                addDependency(dependencies, 'Campaign (Assigned Channels)', camp.Name);
            }
            if (dependencies.size() >= MAX_DEPENDENCY_LABELS) {
                return;
            }
        }
    }

    private static void collectBlackoutWindowChannelReferences(
        String channelName,
        List<String> dependencies
    ) {
        if (dependencies.size() >= MAX_DEPENDENCY_LABELS || String.isBlank(channelName)) {
            return;
        }
        for (Blackout_Window__c window : [
            SELECT Name, Assigned_Channels__c
            FROM Blackout_Window__c
            LIMIT 5000
        ]) {
            if (semicolonListContainsLabel(window.Assigned_Channels__c, channelName)) {
                addDependency(dependencies, 'Blackout window', window.Name);
            }
            if (dependencies.size() >= MAX_DEPENDENCY_LABELS) {
                return;
            }
        }
    }

    private static void collectCopyChannelReferences(
        String channelName,
        String channelType,
        List<String> dependencies
    ) {
        if (dependencies.size() >= MAX_DEPENDENCY_LABELS) {
            return;
        }
        if (String.isNotBlank(channelName)) {
            for (CC_Message_Metadata__c row : [
                SELECT Name
                FROM CC_Message_Metadata__c
                WHERE Channel__c = :channelName
                ORDER BY Name ASC
                LIMIT :MAX_DEPENDENCY_LABELS
            ]) {
                addDependency(dependencies, 'Copy variant (Channel)', row.Name);
                if (dependencies.size() >= MAX_DEPENDENCY_LABELS) {
                    return;
                }
            }
        }
        if (String.isNotBlank(channelType)) {
            for (CC_Message_Metadata__c row : [
                SELECT Name
                FROM CC_Message_Metadata__c
                WHERE Channel_Type__c = :channelType
                ORDER BY Name ASC
                LIMIT :MAX_DEPENDENCY_LABELS
            ]) {
                addDependency(dependencies, 'Copy variant (Channel Type)', row.Name);
                if (dependencies.size() >= MAX_DEPENDENCY_LABELS) {
                    return;
                }
            }
        }
    }

    private static void throwIfBlocked(String recordName, List<String> dependencies) {
        if (dependencies == null || dependencies.isEmpty()) {
            return;
        }
        String message = (String.isBlank(recordName) ? 'This value' : 'The value ' + recordName)
            + ' has a dependency to ' + String.join(dependencies, '; ')
            + '. Please remove dependencies first to delete this record.';
        AuraHandledException ex = new AuraHandledException(message);
        ex.setMessage(message);
        throw ex;
    }

    @TestVisible
    private static Boolean containsDictionaryId(String rawValue, Id dictionaryId) {
        if (String.isBlank(rawValue) || dictionaryId == null) {
            return false;
        }
        Set<String> tokens = tokenizeIdList(rawValue);
        String id18 = String.valueOf(dictionaryId);
        if (tokens.contains(id18)) {
            return true;
        }
        if (id18.length() == 18) {
            return tokens.contains(id18.substring(0, 15));
        }
        return false;
    }

    @TestVisible
    private static Set<String> tokenizeIdList(String rawValue) {
        Set<String> tokens = new Set<String>();
        for (String part : rawValue.split(';')) {
            String trimmed = part != null ? part.trim() : '';
            if (!String.isBlank(trimmed)) {
                tokens.add(trimmed);
            }
        }
        return tokens;
    }

    @TestVisible
    private static Boolean semicolonListContainsLabel(String rawValue, String label) {
        if (String.isBlank(rawValue) || String.isBlank(label)) {
            return false;
        }
        String target = label.trim().toLowerCase();
        for (String part : rawValue.split(';')) {
            if (part != null && part.trim().toLowerCase() == target) {
                return true;
            }
        }
        return false;
    }

    @TestVisible
    private static Boolean supportedTypesContain(String rawValue, String typeName) {
        if (String.isBlank(rawValue) || String.isBlank(typeName)) {
            return false;
        }
        String target = typeName.trim().toLowerCase();
        for (String part : rawValue.split(',')) {
            if (part != null && part.trim().toLowerCase() == target) {
                return true;
            }
        }
        return false;
    }

    private static String tierLabelForNumber(Decimal tierNumber) {
        if (tierNumber == null) {
            return null;
        }
        return 'Tier ' + tierNumber.intValue();
    }

    private static void addDependency(List<String> dependencies, String category, String recordName) {
        if (dependencies.size() >= MAX_DEPENDENCY_LABELS) {
            return;
        }
        String name = String.isBlank(recordName) ? 'record' : recordName;
        dependencies.add(category + ': ' + name);
    }
}
