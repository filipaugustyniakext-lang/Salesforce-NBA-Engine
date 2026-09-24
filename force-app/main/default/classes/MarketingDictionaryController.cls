public with sharing class MarketingDictionaryController {

    // Ordered label map for the campaign summary "Attractiveness & Properties" section.
    // Only populated fields are surfaced; ordering is preserved for a stable UI.
    private static final List<Map<String, String>> PARAM_LABELS = new List<Map<String, String>>{
        new Map<String, String>{ 'field' => 'Base_Interest_Rate__c',        'label' => 'Base Interest Rate' },
        new Map<String, String>{ 'field' => 'Nominal_Interest_Rate__c',     'label' => 'Nominal Interest Rate' },
        new Map<String, String>{ 'field' => 'Promotional_Interest_Rate__c', 'label' => 'Promotional Interest Rate' },
        new Map<String, String>{ 'field' => 'RRSO__c',                      'label' => 'RRSO' },
        new Map<String, String>{ 'field' => 'Interest_Type__c',             'label' => 'Interest Type' },
        new Map<String, String>{ 'field' => 'Interest_Capitalization__c',   'label' => 'Interest Capitalization' },
        new Map<String, String>{ 'field' => 'Minimal_Amount__c',            'label' => 'Minimum Amount' },
        new Map<String, String>{ 'field' => 'Maximum_Amount__c',            'label' => 'Maximum Amount' },
        new Map<String, String>{ 'field' => 'Maximum_Promotional_Amount__c','label' => 'Maximum Promotional Amount' },
        new Map<String, String>{ 'field' => 'Maximum_Tenure__c',            'label' => 'Maximum Tenure' },
        new Map<String, String>{ 'field' => 'Duration_Days__c',             'label' => 'Duration (Days)' },
        new Map<String, String>{ 'field' => 'Grace_Period_Days__c',         'label' => 'Grace Period (Days)' },
        new Map<String, String>{ 'field' => 'Deposit_Duration_Months__c',   'label' => 'Deposit Duration (Months)' },
        new Map<String, String>{ 'field' => 'Card_Fee__c',                  'label' => 'Card Fee' },
        new Map<String, String>{ 'field' => 'Commission_Percentage__c',     'label' => 'Commission %' },
        new Map<String, String>{ 'field' => 'Commission_Amount_Flat_Fee__c','label' => 'Commission Flat Fee' },
        new Map<String, String>{ 'field' => 'Earlier_Repayment_Fee__c',     'label' => 'Earlier Repayment Fee' },
        new Map<String, String>{ 'field' => 'Own_Input_Percentage__c',      'label' => 'Own Input %' },
        new Map<String, String>{ 'field' => 'Max_Owned_Products_Limit__c',  'label' => 'Max Owned Products Limit' },
        new Map<String, String>{ 'field' => 'Sales_Process__c',             'label' => 'Sales Process' },
        new Map<String, String>{ 'field' => 'NO_Fees_Conditions_Simplicity__c', 'label' => 'No Fees / Conditions Simplicity' },
        new Map<String, String>{ 'field' => 'Additional_VAS__c',            'label' => 'Additional VAS' },
        new Map<String, String>{ 'field' => 'Representative_Example__c',    'label' => 'Representative Example' },
        new Map<String, String>{ 'field' => 'Offer_Description__c',         'label' => 'Offer Description' }
    };

    @AuraEnabled(cacheable=false)
    public static Campaign getCampaignById(Id campaignId) {
        if (campaignId == null) return null;
        List<Campaign> campaigns = [
            SELECT Id, Name, Campaign_Group_Dict__c, Campaign_Group_Dict__r.Name,
                   Type, Topic_Name__c, Topic_Dict__c, Topic_Dict__r.Name,
                   Priority_Tier__c, Activation_Type__c,
                   Timing_From__c, Timing_To__c, Validity_Days__c, Duration_Days__c,
                   Scoring_Method__c, Offering_Type__c, Status, IsActive,
                   Overall_Score__c, Fallback_Score__c,
                   Scoring_Model_Dict__c, Scoring_Model_Dict__r.Name,
                   Assigned_Channels__c,
                   Product_Family__c, Product_Family_Ids__c,
                   Family_of_Needs__c, Family_of_Needs_Ids__c,
                   Exclude_Onboarding__c
            FROM Campaign
            WHERE Id = :campaignId
            LIMIT 1
        ];
        return campaigns.isEmpty() ? null : campaigns[0];
    }

    /**
     * One-shot heal: move any Ids left in Campaign display fields into the Id SSOT
     * fields and refresh display labels from the Marketing Dictionary.
     */
    @AuraEnabled
    public static Integer healCampaignOfferingLabels() {
        return CampaignOfferingLabelSync.healCampaigns(500);
    }

    @AuraEnabled(cacheable=true)
    public static List<Marketing_Dictionary__c> getScoringModels() {
        return [
            SELECT Id, Name, Topic_Description__c, Is_Active__c,
                   Version__c, Model_Id__c,
                   Scoring_Model_Group_Dict__c, Scoring_Model_Group_Dict__r.Name,
                   Assigned_Topic_Dict__c, Assigned_Topic_Dict__r.Name,
                   Offering_Type__c, Product_Family__c, Family_of_Needs__c,
                   Model_Expiration_Date__c
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Campaign'
            AND Dictionary_Sub_Type__c = 'Scoring Model'
            AND Is_Active__c = true
            ORDER BY Name ASC, Version__c DESC NULLS LAST
            LIMIT 500
        ];
    }

    @AuraEnabled(cacheable=true)
    public static List<String> getActiveChannels() {
        List<String> channelOptions = new List<String>();
        Schema.DescribeFieldResult fieldResult = Marketing_Dictionary__c.Channels__c.getDescribe();
        List<Schema.PicklistEntry> picklistValues = fieldResult.getPicklistValues();
        for (Schema.PicklistEntry entry : picklistValues) {
            if (entry.isActive()) {
                channelOptions.add(entry.getLabel());
            }
        }
        return channelOptions;
    }

    @AuraEnabled(cacheable=true)
    public static List<String> getTopicGoalValues() {
        List<String> options = new List<String>();
        for (Marketing_Dictionary__c rec : [
            SELECT Name
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Campaign'
            AND Dictionary_Sub_Type__c = 'Topic'
            ORDER BY Name ASC
            LIMIT 500
        ]) {
            options.add(rec.Name);
        }
        return options;
    }

    /**
     * Topic catalogue with Ids for Id-based SSOT consumers (Campaign Wizard).
     * Non-cacheable so renames are visible without waiting on cache.
     */
    @AuraEnabled
    public static List<Marketing_Dictionary__c> getTopicDictionaryRecords() {
        return [
            SELECT Id, Name, Topic_Group_Dict__c, Topic_Group_Dict__r.Name, Topic_Description__c
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Campaign'
            AND Dictionary_Sub_Type__c = 'Topic'
            ORDER BY Name ASC
            LIMIT 500
        ];
    }

    @AuraEnabled(cacheable=true)
    public static List<String> getProductFamilyValues() {
        List<String> options = new List<String>();
        for (Marketing_Dictionary__c rec : [
            SELECT Name
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Product'
            AND Dictionary_Sub_Type__c = 'Product Family'
            ORDER BY Name ASC
            LIMIT 500
        ]) {
            options.add(rec.Name);
        }
        return options;
    }

    @AuraEnabled(cacheable=true)
    public static List<String> getFamilyOfNeedsValues() {
        List<String> options = new List<String>();
        for (Marketing_Dictionary__c rec : [
            SELECT Name
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Product'
            AND Dictionary_Sub_Type__c = 'Family of Needs'
            ORDER BY Name ASC
            LIMIT 500
        ]) {
            options.add(rec.Name);
        }
        return options;
    }

    @AuraEnabled(cacheable=true)
    public static Map<String, List<String>> getFamilyOfNeedsCustomerTypes() {
        Map<String, Set<String>> fonToTypes = new Map<String, Set<String>>();
        for (FamilyOfNeeds_CustomerType__c jct : [
            SELECT Family_of_Needs__r.Name, Customer_Type__r.Name
            FROM FamilyOfNeeds_CustomerType__c
            WHERE Family_of_Needs__c != null AND Customer_Type__c != null
        ]) {
            String fon = jct.Family_of_Needs__r.Name;
            String ct = jct.Customer_Type__r.Name;
            if (!fonToTypes.containsKey(fon)) fonToTypes.put(fon, new Set<String>());
            fonToTypes.get(fon).add(ct);
        }
        Map<String, List<String>> result = new Map<String, List<String>>();
        for (String fon : fonToTypes.keySet()) {
            List<String> sorted = new List<String>(fonToTypes.get(fon));
            sorted.sort();
            result.put(fon, sorted);
        }
        return result;
    }

    @AuraEnabled(cacheable=true)
    public static Map<String, List<String>> getProductFamilyDependencies() {
        Map<String, List<String>> dependencyMap = new Map<String, List<String>>();
        for (Marketing_Dictionary__c rec : [
            SELECT Name, Related_Family_of_Needs__r.Name
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Product'
            AND Dictionary_Sub_Type__c = 'Product Family'
            AND Related_Family_of_Needs__c != null
            ORDER BY Name ASC
            LIMIT 500
        ]) {
            String pf = rec.Name;
            String fon = rec.Related_Family_of_Needs__r.Name;
            if (!dependencyMap.containsKey(pf)) dependencyMap.put(pf, new List<String>());
            if (!dependencyMap.get(pf).contains(fon)) dependencyMap.get(pf).add(fon);
        }
        return dependencyMap;
    }

    @AuraEnabled(cacheable=true)
    public static Map<String, List<String>> getProductFamilyByRecordType() {
        Map<String, List<String>> rtToFamilies = new Map<String, List<String>>();
        for (Product2 p : [
            SELECT Product_Type_Dict__r.Name, Product_Family_Dict__r.Name
            FROM Product2
            WHERE Product_Family_Dict__c != null AND Product_Type_Dict__c != null AND IsActive = true
        ]) {
            String rtName = p.Product_Type_Dict__r.Name;
            String family = p.Product_Family_Dict__r.Name;
            if (!rtToFamilies.containsKey(rtName)) rtToFamilies.put(rtName, new List<String>());
            if (!rtToFamilies.get(rtName).contains(family)) rtToFamilies.get(rtName).add(family);
        }
        return rtToFamilies;
    }

    @AuraEnabled(cacheable=true)
    public static Map<String, List<String>> getProductFamilyCustomerTypes() {
        Map<String, Set<String>> familyToTypes = new Map<String, Set<String>>();
        for (Product_Customer_Type__c jct : [
            SELECT Product__r.Product_Family_Dict__r.Name, Customer_Type__r.Name
            FROM Product_Customer_Type__c
            WHERE Product__c != null
            AND Product__r.IsActive = true
            AND Product__r.Product_Family_Dict__c != null
        ]) {
            String family = jct.Product__r.Product_Family_Dict__r.Name;
            String ct = jct.Customer_Type__r.Name;
            if (!familyToTypes.containsKey(family)) familyToTypes.put(family, new Set<String>());
            familyToTypes.get(family).add(ct);
        }
        Map<String, List<String>> result = new Map<String, List<String>>();
        for (String family : familyToTypes.keySet()) {
            List<String> sorted = new List<String>(familyToTypes.get(family));
            sorted.sort();
            result.put(family, sorted);
        }
        return result;
    }

    @AuraEnabled(cacheable=true)
    public static List<Marketing_Dictionary__c> getCampaignTypes() {
        return [
            SELECT Id, Name, Channel_Icon__c, Include_In_Emergency__c, Define_Campaign_Groups__c,
                   (SELECT Id, Name
                    FROM Campaign_Groups_by_Type__r
                    WHERE Dictionary_Sub_Type__c = 'Campaign Group'
                    AND Is_Active__c = true
                    ORDER BY Name ASC)
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Campaign'
            AND Dictionary_Sub_Type__c = 'Campaign Type'
            AND Is_Active__c = true
            ORDER BY Name ASC
            LIMIT 50
        ];
    }

    @AuraEnabled(cacheable=true)
    public static List<Marketing_Dictionary__c> getChannelDictionaryRecords() {
        return [
            SELECT Id, Name, Channel_Type__c, Channel_Icon__c
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Channel'
            ORDER BY Channel_Type__c ASC, Name ASC
            LIMIT 500
        ];
    }

    // --- TIERS ---

    @AuraEnabled(cacheable=false)
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
            ORDER BY Tier_Number__c ASC NULLS LAST, Name ASC
            LIMIT 50
        ];
    }

    @AuraEnabled(cacheable=false)
    public static List<Map<String, String>> searchSuppressionCampaigns(String searchTerm) {
        String q = '%' + String.escapeSingleQuotes(searchTerm) + '%';
        List<Map<String, String>> results = new List<Map<String, String>>();
        for (Campaign c : [
            SELECT Id, Name FROM Campaign
            WHERE Name LIKE :q AND IsActive = true
            ORDER BY Name ASC LIMIT 20
        ]) {
            results.add(new Map<String, String>{ 'id' => c.Id, 'name' => c.Name });
        }
        return results;
    }

    @AuraEnabled(cacheable=false)
    public static List<Map<String, String>> searchSuppressionReports(String searchTerm) {
        String q = '%' + String.escapeSingleQuotes(searchTerm) + '%';
        List<Map<String, String>> results = new List<Map<String, String>>();
        for (Report r : [
            SELECT Id, Name FROM Report
            WHERE Name LIKE :q
            ORDER BY Name ASC LIMIT 20
        ]) {
            results.add(new Map<String, String>{ 'id' => r.Id, 'name' => r.Name });
        }
        return results;
    }

    // --- OFFER MATCHING ---

    @AuraEnabled(cacheable=false)
    public static List<Map<String, String>> getMatchingOffers(List<String> productFamilies, List<String> familyOfNeeds) {
        return new OfferQuery().fetchMatchingOffers(productFamilies, familyOfNeeds);
    }

    @AuraEnabled(cacheable=false)
    public static List<Map<String, String>> getCampaignOffers(Id campaignId) {
        return new OfferQuery().fetchCampaignOffers(campaignId);
    }

    @AuraEnabled
    public static void saveCampaignOffers(Id campaignId, List<Id> offerIds) {
        new OfferQuery().replaceCampaignOffers(campaignId, offerIds);
    }

    /**
     * Returns a summary of each offer's active version for display in the Campaign
     * wizard summary step. One entry per offer that has an active version, keyed by
     * offer Id, including key header fields plus a flat `parameters` list (populated
     * standard version fields + custom Additional_Parameters__c entries).
     *
     * @param offerIds Offer__c ids selected during the campaign offering step
     * @return List of maps, one per offer with an active version
     */
    @AuraEnabled(cacheable=false)
    public static List<Map<String, Object>> getOfferSummaries(List<Id> offerIds) {
        return new OfferQuery().fetchOfferSummaries(offerIds);
    }

    private without sharing class OfferQuery {
        List<Map<String, String>> fetchMatchingOffers(List<String> productFamilies, List<String> familyOfNeeds) {
            Set<String> allFamilies = new Set<String>();
            if (productFamilies != null) allFamilies.addAll(productFamilies);
            if (familyOfNeeds  != null) allFamilies.addAll(familyOfNeeds);

            if (allFamilies.isEmpty()) return new List<Map<String, String>>();

            Map<Id, Set<String>> offerToFamilies = new Map<Id, Set<String>>();
            Map<Id, Set<String>> offerToProducts = new Map<Id, Set<String>>();
            for (Offer_Version__c v : [
                SELECT Offer_Lookup__c, Product_Family_Name__c, Source_Products__c
                FROM Offer_Version__c
                WHERE Is_Active__c = true
                AND Product_Family_Name__c IN :allFamilies
            ]) {
                Id offerId = v.Offer_Lookup__c;
                if (!offerToFamilies.containsKey(offerId)) {
                    offerToFamilies.put(offerId, new Set<String>());
                    offerToProducts.put(offerId, new Set<String>());
                }
                if (String.isNotBlank(v.Product_Family_Name__c)) {
                    offerToFamilies.get(offerId).add(v.Product_Family_Name__c);
                }
                if (String.isNotBlank(v.Source_Products__c)) {
                    offerToProducts.get(offerId).add(v.Source_Products__c);
                }
            }

            if (offerToFamilies.isEmpty()) return new List<Map<String, String>>();

            List<Map<String, String>> results = new List<Map<String, String>>();
            for (Offer__c o : [
                SELECT Id, Name, Offer_Status__c
                FROM Offer__c
                WHERE Id IN :offerToFamilies.keySet()
                AND Offer_Status__c = 'Active'
                ORDER BY Name ASC
                LIMIT 200
            ]) {
                List<String> families = new List<String>(offerToFamilies.get(o.Id));
                families.sort();
                List<String> products = new List<String>(offerToProducts.get(o.Id));
                products.sort();
                results.add(new Map<String, String>{
                    'id'             => o.Id,
                    'name'           => o.Name,
                    'status'         => o.Offer_Status__c,
                    'productFamilies'=> String.join(families, ';'),
                    'sourceProducts' => String.join(products, ';')
                });
            }
            return results;
        }

        List<Map<String, String>> fetchCampaignOffers(Id campaignId) {
            if (campaignId == null) return new List<Map<String, String>>();

            Set<Id> savedOfferIds = new Set<Id>();
            for (Campaign_Offer__c co : [
                SELECT Offer__c
                FROM Campaign_Offer__c
                WHERE Campaign__c = :campaignId
            ]) {
                savedOfferIds.add(co.Offer__c);
            }

            if (savedOfferIds.isEmpty()) return new List<Map<String, String>>();

            List<Map<String, String>> results = new List<Map<String, String>>();
            for (Offer__c o : [
                SELECT Id, Name, Offer_Status__c
                FROM Offer__c
                WHERE Id IN :savedOfferIds
                AND Offer_Status__c = 'Active'
                ORDER BY Name ASC
                LIMIT 200
            ]) {
                results.add(new Map<String, String>{
                    'id'     => o.Id,
                    'name'   => o.Name,
                    'status' => o.Offer_Status__c
                });
            }
            return results;
        }

        void replaceCampaignOffers(Id campaignId, List<Id> offerIds) {
            if (campaignId == null) return;

            delete [SELECT Id FROM Campaign_Offer__c WHERE Campaign__c = :campaignId];

            if (offerIds == null || offerIds.isEmpty()) return;

            Set<Id> uniqueOfferIds = new Set<Id>(offerIds);
            List<Campaign_Offer__c> toInsert = new List<Campaign_Offer__c>();
            for (Id offerId : uniqueOfferIds) {
                toInsert.add(new Campaign_Offer__c(Campaign__c = campaignId, Offer__c = offerId));
            }
            insert toInsert;
        }

        // Semicolon-delimited Customer Type audience names from the junction rows, matching
        // the previous copy-by-value string shape so downstream summary rendering is unchanged.
        String joinCustomerTypeNames(Offer_Version__c v) {
            if (v.Customer_Types__r == null || v.Customer_Types__r.isEmpty()) return null;
            List<String> names = new List<String>();
            for (Offer_Version_Customer_Type__c ct : v.Customer_Types__r) {
                if (ct.Customer_Type__r != null && ct.Customer_Type__r.Name != null) {
                    names.add(ct.Customer_Type__r.Name);
                }
            }
            return names.isEmpty() ? null : String.join(names, ';');
        }

        List<Map<String, Object>> fetchOfferSummaries(List<Id> offerIds) {
            List<Map<String, Object>> results = new List<Map<String, Object>>();
            if (offerIds == null || offerIds.isEmpty()) return results;

            Set<Id> uniqueOfferIds = new Set<Id>(offerIds);

            // Active version per offer. Offers can have exactly one active version;
            // if more than one is returned we keep the first (most recent) deterministically.
            Map<Id, Offer_Version__c> versionByOffer = new Map<Id, Offer_Version__c>();
            for (Offer_Version__c v : [
                SELECT Id, Name, Offer_Lookup__c, Version_Number__c, Version_Status__c,
                       Product_Family_Name__c, Source_Products__c,
                       (SELECT Customer_Type__r.Name FROM Customer_Types__r),
                       Valid_From__c, Valid_To__c, Is_Promo__c,
                       Country_Code__c, Currency_Code__c, CurrencyIsoCode,
                       Attractiveness_Score__c, Additional_Parameters__c,
                       Base_Interest_Rate__c, Nominal_Interest_Rate__c, Promotional_Interest_Rate__c,
                       RRSO__c, Interest_Type__c, Interest_Capitalization__c,
                       Minimal_Amount__c, Maximum_Amount__c, Maximum_Promotional_Amount__c,
                       Maximum_Tenure__c, Duration_Days__c, Grace_Period_Days__c,
                       Deposit_Duration_Months__c, Card_Fee__c, Commission_Percentage__c,
                       Commission_Amount_Flat_Fee__c, Earlier_Repayment_Fee__c, Own_Input_Percentage__c,
                       Max_Owned_Products_Limit__c, Sales_Process__c, NO_Fees_Conditions_Simplicity__c,
                       Additional_VAS__c, Representative_Example__c, Offer_Description__c
                FROM Offer_Version__c
                WHERE Offer_Lookup__c IN :uniqueOfferIds
                AND Is_Active__c = true
                ORDER BY CreatedDate DESC
            ]) {
                if (!versionByOffer.containsKey(v.Offer_Lookup__c)) {
                    versionByOffer.put(v.Offer_Lookup__c, v);
                }
            }

            if (versionByOffer.isEmpty()) return results;

            Map<Id, Offer__c> offerById = new Map<Id, Offer__c>([
                SELECT Id, Name, Offer_Status__c
                FROM Offer__c
                WHERE Id IN :versionByOffer.keySet()
                ORDER BY Name ASC
            ]);

            for (Id offerId : offerById.keySet()) {
                Offer__c offer = offerById.get(offerId);
                Offer_Version__c v = versionByOffer.get(offerId);

                results.add(new Map<String, Object>{
                    'id'                 => offer.Id,
                    'name'               => offer.Name,
                    'status'             => offer.Offer_Status__c,
                    'versionNumber'      => v.Version_Number__c,
                    'productFamily'      => v.Product_Family_Name__c,
                    'sourceProducts'     => v.Source_Products__c,
                    'targetAudience'     => joinCustomerTypeNames(v),
                    'validFrom'          => v.Valid_From__c == null ? null : String.valueOf(v.Valid_From__c),
                    'validTo'            => v.Valid_To__c == null ? null : String.valueOf(v.Valid_To__c),
                    'isPromo'            => v.Is_Promo__c == true,
                    'countryCode'        => v.Country_Code__c,
                    'currencyCode'       => String.isNotBlank(v.Currency_Code__c) ? v.Currency_Code__c : v.CurrencyIsoCode,
                    'attractivenessScore'=> v.Attractiveness_Score__c == null ? null : String.valueOf(v.Attractiveness_Score__c),
                    'parameters'         => buildParameters(v)
                });
            }
            return results;
        }

        // Flattens populated standard version fields (in PARAM_LABELS order) followed by
        // custom Additional_Parameters__c JSON entries into a [{label, value}] list.
        List<Map<String, String>> buildParameters(Offer_Version__c v) {
            List<Map<String, String>> params = new List<Map<String, String>>();
            for (Map<String, String> def : PARAM_LABELS) {
                Object raw = v.get(def.get('field'));
                if (raw == null) continue;
                String value = String.valueOf(raw);
                if (String.isBlank(value)) continue;
                params.add(new Map<String, String>{ 'label' => def.get('label'), 'value' => value });
            }

            if (String.isNotBlank(v.Additional_Parameters__c)) {
                try {
                    Object parsed = JSON.deserializeUntyped(v.Additional_Parameters__c);
                    if (parsed instanceof List<Object>) {
                        for (Object item : (List<Object>) parsed) {
                            if (!(item instanceof Map<String, Object>)) continue;
                            Map<String, Object> entry = (Map<String, Object>) item;
                            Object keyObj = entry.get('key');
                            Object valObj = entry.get('value');
                            if (keyObj == null || valObj == null) continue;
                            String value = String.valueOf(valObj);
                            if (String.isBlank(value)) continue;
                            params.add(new Map<String, String>{
                                'label' => String.valueOf(keyObj),
                                'value' => value
                            });
                        }
                    }
                } catch (Exception e) {
                    // Malformed custom-parameter JSON should not break the summary.
                }
            }
            return params;
        }
    }

    // --- DICTIONARY MANAGEMENT HUB METHODS ---

    @AuraEnabled(cacheable=true)
    public static List<Marketing_Dictionary__c> getDictionaryRecords(String recordTypeDeveloperName) {
        return [
            SELECT Id, Name, Channels__c, Sales_Process_Type__c, 
                   Topic_Goal__c, Topic_Group__c, Topic_Description__c, Dictionary_Category__c,
                   RecordType.Name, RecordType.DeveloperName
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = :recordTypeDeveloperName
            ORDER BY Name ASC
            LIMIT 1000
        ];
    }

    @AuraEnabled(cacheable=true)
    public static Map<String, Id> getDictionaryRecordTypes() {
        Map<String, Id> rtMap = new Map<String, Id>();
        for (Schema.RecordTypeInfo info : Schema.SObjectType.Marketing_Dictionary__c.getRecordTypeInfos()) {
            if (info.isActive() && !info.isMaster()) {
                rtMap.put(info.getDeveloperName(), info.getRecordTypeId());
            }
        }
        return rtMap;
    }
}