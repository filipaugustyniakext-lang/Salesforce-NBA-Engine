/**
 * Blocks Marketing Dictionary deletes when NBA components still reference the dictionary Id.
 * Surfaces rename warnings when NBA processes store the dictionary label (not Id).
 */
public with sharing class MarketingDictionaryDeleteGuard {

    private static final Integer MAX_DEPENDENCY_LABELS = 12;

    public class DependencyGroup {
        @AuraEnabled public String category { get; set; }
        @AuraEnabled public List<String> recordNames { get; set; }

        public DependencyGroup() {
            this.recordNames = new List<String>();
        }

        public DependencyGroup(String category, List<String> recordNames) {
            this.category = category;
            this.recordNames = recordNames != null ? recordNames : new List<String>();
        }
    }

    public class DependencyReport {
        @AuraEnabled public String recordName { get; set; }
        @AuraEnabled public List<DependencyGroup> groups { get; set; }
        @AuraEnabled public Boolean truncated { get; set; }
        @AuraEnabled public String summaryMessage { get; set; }

        public DependencyReport() {
            this.groups = new List<DependencyGroup>();
            this.truncated = false;
        }

        public Boolean hasDependencies() {
            return groups != null && !groups.isEmpty();
        }
    }

    private class DependencyCollector {
        private Map<String, List<String>> byCategory = new Map<String, List<String>>();
        private Integer totalCount = 0;
        public Boolean truncated = false;

        void add(String category, String recordName) {
            if (totalCount >= MAX_DEPENDENCY_LABELS) {
                truncated = true;
                return;
            }
            String cat = String.isBlank(category) ? 'Related record' : category;
            String name = String.isBlank(recordName) ? 'record' : recordName;
            if (!byCategory.containsKey(cat)) {
                byCategory.put(cat, new List<String>());
            }
            byCategory.get(cat).add(name);
            totalCount++;
        }

        Boolean isEmpty() {
            return totalCount == 0;
        }

        List<String> toFlatList() {
            List<String> flat = new List<String>();
            for (String cat : sortedCategoryKeys()) {
                for (String entry : byCategory.get(cat)) {
                    flat.add(cat + ': ' + entry);
                }
            }
            return flat;
        }

        DependencyReport toReport(String recordLabel) {
            DependencyReport report = new DependencyReport();
            report.recordName = recordLabel;
            report.truncated = truncated;
            for (String cat : sortedCategoryKeys()) {
                report.groups.add(new DependencyGroup(cat, new List<String>(byCategory.get(cat))));
            }
            List<String> flat = toFlatList();
            if (!flat.isEmpty()) {
                report.summaryMessage = buildBlockedMessage(recordLabel, flat, truncated);
            }
            return report;
        }

        private List<String> sortedCategoryKeys() {
            List<String> keys = new List<String>(byCategory.keySet());
            keys.sort();
            return keys;
        }
    }

    public class RenameImpact {
        @AuraEnabled public Boolean requiresConfirmation;
        @AuraEnabled public String message;

        public RenameImpact(Boolean requiresConfirmation, String message) {
            this.requiresConfirmation = requiresConfirmation;
            this.message = message;
        }
    }

    public static List<String> collectBlockingDependencies(Marketing_Dictionary__c dictionaryRecord) {
        return collectIntoCollector(dictionaryRecord).toFlatList();
    }

    public static DependencyReport buildDictionaryDeleteReport(Marketing_Dictionary__c dictionaryRecord) {
        String label = dictionaryRecord != null ? dictionaryRecord.Name : null;
        return collectIntoCollector(dictionaryRecord).toReport(label);
    }

    @AuraEnabled
    public static DependencyReport getDictionaryDeleteDependencies(Id recordId) {
        if (recordId == null) {
            return new DependencyReport();
        }
        Marketing_Dictionary__c rec = [
            SELECT Id, Name, Dictionary_Sub_Type__c, RecordType.DeveloperName,
                   Channel_Type__c, Parameter_API_Name__c
            FROM Marketing_Dictionary__c
            WHERE Id = :recordId
            WITH SECURITY_ENFORCED
            LIMIT 1
        ];
        return buildDictionaryDeleteReport(rec);
    }

    @AuraEnabled
    public static DependencyReport getCampaignTierDeleteDependencies(Id tierId) {
        return buildCampaignTierDeleteReport(tierId);
    }

    @AuraEnabled
    public static DependencyReport getOfferReferenceValueDeleteDependencies(Id referenceValueId) {
        return buildOfferReferenceValueDeleteReport(referenceValueId);
    }

    private static DependencyCollector collectIntoCollector(Marketing_Dictionary__c dictionaryRecord) {
        DependencyCollector dependencies = new DependencyCollector();
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

    public static DependencyReport buildCampaignTierDeleteReport(Id tierId) {
        DependencyReport empty = new DependencyReport();
        if (tierId == null) {
            return empty;
        }
        Campaign_Tier__c tier = [
            SELECT Id, Name, Tier_Number__c
            FROM Campaign_Tier__c
            WHERE Id = :tierId
            LIMIT 1
        ];
        DependencyCollector dependencies = new DependencyCollector();
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
        return dependencies.toReport(tier.Name);
    }

    public static DependencyReport buildOfferReferenceValueDeleteReport(Id referenceValueId) {
        DependencyReport empty = new DependencyReport();
        if (referenceValueId == null) {
            return empty;
        }
        Offer_Reference_Value__c refVal = [
            SELECT Id, Name
            FROM Offer_Reference_Value__c
            WHERE Id = :referenceValueId
            LIMIT 1
        ];
        DependencyCollector dependencies = new DependencyCollector();
        for (Offer_Attribute_Rule__c rule : [
            SELECT Offer_Attribute__r.Name
            FROM Offer_Attribute_Rule__c
            WHERE Reference_Value__c = :referenceValueId
            ORDER BY Offer_Attribute__r.Name ASC
            LIMIT :MAX_DEPENDENCY_LABELS
        ]) {
            addDependency(dependencies, 'Offer attribute rule', rule.Offer_Attribute__r?.Name);
        }
        return dependencies.toReport(refVal.Name);
    }

    public static void assertCampaignTierDeletable(Id tierId) {
        if (tierId == null) {
            return;
        }
        throwIfBlocked(buildCampaignTierDeleteReport(tierId));
    }

    public static void assertOfferReferenceValueDeletable(Id referenceValueId) {
        if (referenceValueId == null) {
            return;
        }
        throwIfBlocked(buildOfferReferenceValueDeleteReport(referenceValueId));
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

    private static void collectCustomerTypeDependencies(Id recordId, DependencyCollector dependencies) {
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

    private static void collectAudienceTypeDependencies(Id recordId, DependencyCollector dependencies) {
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

    private static void collectProductFamilyDependencies(Id recordId, DependencyCollector dependencies) {
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

    private static void collectFamilyOfNeedsDependencies(Id recordId, DependencyCollector dependencies) {
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

    private static void collectProductTypeDependencies(Id recordId, DependencyCollector dependencies) {
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
        DependencyCollector dependencies
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

    private static void collectCampaignGroupDependencies(Id recordId, DependencyCollector dependencies) {
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

    private static void collectTopicDependencies(Id recordId, DependencyCollector dependencies) {
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

    private static void collectTopicGroupDependencies(Id recordId, DependencyCollector dependencies) {
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

    private static void collectScoringModelDependencies(Id recordId, DependencyCollector dependencies) {
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

    private static void collectScoringModelGroupDependencies(Id recordId, DependencyCollector dependencies) {
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
        DependencyCollector dependencies
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
        DependencyCollector dependencies
    ) {
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
        }
    }

    private static void collectChannelDependencies(
        Marketing_Dictionary__c channel,
        DependencyCollector dependencies
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
        DependencyCollector dependencies
    ) {
        String query = 'SELECT Id, Name, ' + campaignFieldApi + ' FROM Campaign LIMIT 5000';
        for (Campaign campaign : (List<Campaign>) Database.query(query)) {
            String raw = (String) campaign.get(campaignFieldApi);
            if (containsDictionaryId(raw, dictionaryId)) {
                addDependency(dependencies, dependencyPrefix, campaign.Name);
            }
        }
    }

    private static void collectScoringModelOfferingTokens(
        Id dictionaryId,
        String offeringType,
        DependencyCollector dependencies
    ) {
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
        }
    }

    private static void collectTierSupportedTypeReferences(String typeName, DependencyCollector dependencies) {
        if (String.isBlank(typeName)) {
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
        }
    }

    private static void collectCopyTopicTextReferences(Id topicId, DependencyCollector dependencies) {
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
        DependencyCollector dependencies
    ) {
        if (String.isBlank(channelName)) {
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
        }
    }

    private static void collectBlackoutWindowChannelReferences(
        String channelName,
        DependencyCollector dependencies
    ) {
        if (String.isBlank(channelName)) {
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
        }
    }

    private static void collectCopyChannelReferences(
        String channelName,
        String channelType,
        DependencyCollector dependencies
    ) {
        if (String.isNotBlank(channelName)) {
            for (CC_Message_Metadata__c row : [
                SELECT Name
                FROM CC_Message_Metadata__c
                WHERE Channel__c = :channelName
                ORDER BY Name ASC
                LIMIT :MAX_DEPENDENCY_LABELS
            ]) {
                addDependency(dependencies, 'Copy variant (Channel)', row.Name);
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
            }
        }
    }

    private static String buildBlockedMessage(String recordName, List<String> flat, Boolean truncated) {
        String message = (String.isBlank(recordName) ? 'This value' : 'The value ' + recordName)
            + ' has dependencies that must be removed before it can be deleted.';
        if (truncated == true) {
            message += ' (Showing the first ' + MAX_DEPENDENCY_LABELS + ' references.)';
        }
        return message;
    }

    private static void throwIfBlocked(DependencyReport report) {
        if (report == null || !report.hasDependencies()) {
            return;
        }
        String message = String.isNotBlank(report.summaryMessage)
            ? report.summaryMessage
            : buildBlockedMessage(report.recordName, new List<String>(), report.truncated);
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

    private static void addDependency(DependencyCollector dependencies, String category, String recordName) {
        if (dependencies == null) {
            return;
        }
        dependencies.add(category, recordName);
    }
}
