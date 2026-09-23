public with sharing class OfferController {

    // ─── READ ────────────────────────────────────────────────────────────────

    @AuraEnabled(cacheable=false)
    public static Offer__c getOfferById(Id offerId) {
        if (offerId == null) throw new AuraHandledException('Offer Id is required.');
        List<Offer__c> rows = [
            SELECT Id, Name, Offer_Status__c, Is_Active__c, Offer_Version_Id__c,
                   Country_Code__c, Attractiveness_Score__c, CurrencyIsoCode,
                   CreatedDate, LastModifiedDate
            FROM Offer__c
            WHERE Id = :offerId
            LIMIT 1
        ];
        return rows.isEmpty() ? null : rows[0];
    }

    @AuraEnabled(cacheable=false)
    public static Offer_Version__c getVersionById(Id versionId) {
        if (versionId == null) throw new AuraHandledException('Version Id is required.');
        List<Offer_Version__c> rows = [
            SELECT Id, Name, Version_Status__c, Schedule_Status__c, Schedule_Date__c, Version_Number__c, Is_Active__c,
                   Offer_Lookup__c, Offer_Version_Id__c,
                   Country_Code__c, Currency_Code__c, Product_Family_Name__c,
                   Source_Products__c,
                   (SELECT Customer_Type__c, Customer_Type__r.Name FROM Customer_Types__r),
                   Valid_From__c, Valid_To__c, Is_Promo__c,
                   Base_Interest_Rate__c, Card_Fee__c, Commission_Amount_Flat_Fee__c,
                   Commission_Percentage__c, CTA_DURL__c, CTA_URL__c, Currency__c,
                   CurrencyIsoCode, Deposit_Duration_Months__c, Duration_Days__c,
                   Grace_Period_Days__c, Interest_Capitalization__c,
                   Max_Owned_Products_Limit__c, Maximum_Amount__c, Maximum_Tenure__c,
                   Minimal_Amount__c, Nominal_Interest_Rate__c, Offer_Description__c,
                   Promotional_Interest_Rate__c, Representative_Example__c, RRSO__c,
                   Statute_URL__c, Maximum_Promotional_Amount__c, Earlier_Repayment_Fee__c,
                   Interest_Type__c, Sales_Process__c, NO_Fees_Conditions_Simplicity__c,
                   Additional_VAS__c, Own_Input_Percentage__c, Product_Id__c,
                   Attractiveness_Score__c, Additional_Parameters__c,
                   Product_Family__c,
                   CTA_Intent__c, REG_URL__c,
                   CreatedDate, LastModifiedDate
            FROM Offer_Version__c
            WHERE Id = :versionId
            LIMIT 1
        ];
        return rows.isEmpty() ? null : rows[0];
    }

    @AuraEnabled(cacheable=true)
    public static List<Offer_Version__c> getOfferVersions(Id offerId) {
        if (offerId == null) throw new AuraHandledException('Offer Id is required.');
        return [
            SELECT Id, Name, Version_Status__c, Schedule_Status__c, Schedule_Date__c, Version_Number__c, Is_Active__c,
                   Offer_Lookup__c, Offer_Version_Id__c,
                   Country_Code__c, Currency_Code__c, Product_Family_Name__c,
                   Source_Products__c,
                   (SELECT Customer_Type__c, Customer_Type__r.Name FROM Customer_Types__r),
                   Valid_From__c, Valid_To__c, Is_Promo__c,
                   Base_Interest_Rate__c, Card_Fee__c, Commission_Amount_Flat_Fee__c,
                   Commission_Percentage__c, CTA_DURL__c, CTA_URL__c, Currency__c,
                   CurrencyIsoCode, Deposit_Duration_Months__c, Duration_Days__c,
                   Grace_Period_Days__c, Interest_Capitalization__c,
                   Max_Owned_Products_Limit__c, Maximum_Amount__c, Maximum_Tenure__c,
                   Minimal_Amount__c, Nominal_Interest_Rate__c, Offer_Description__c,
                   Promotional_Interest_Rate__c, Representative_Example__c, RRSO__c,
                   Statute_URL__c, Maximum_Promotional_Amount__c, Earlier_Repayment_Fee__c,
                   Interest_Type__c, Sales_Process__c, NO_Fees_Conditions_Simplicity__c,
                   Additional_VAS__c, Own_Input_Percentage__c, Product_Id__c,
                   Attractiveness_Score__c, Additional_Parameters__c,
                   Product_Family__c, CTA_Intent__c, REG_URL__c,
                   CreatedDate, LastModifiedDate
            FROM Offer_Version__c
            WHERE Offer_Lookup__c = :offerId
            ORDER BY CreatedDate DESC
        ];
    }

    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> getActiveProducts() {
        List<Product2> products = [
            SELECT Id, Name, Product_Family_Dict__r.Name, Family_of_Needs_Dict__r.Name, IsActive, Product_Type_Dict__r.Name,
                   (SELECT Customer_Type__r.Name FROM Customer_Types__r)
            FROM Product2
            WHERE IsActive = true
            AND Product_Type_Dict__r.Name = 'Product'
            ORDER BY Name ASC
        ];
        List<Map<String, Object>> result = new List<Map<String, Object>>();
        for (Product2 p : products) {
            List<String> ctNames = new List<String>();
            for (Product_Customer_Type__c j : p.Customer_Types__r) {
                if (j.Customer_Type__r != null && j.Customer_Type__r.Name != null) {
                    ctNames.add(j.Customer_Type__r.Name);
                }
            }
            result.add(new Map<String, Object>{
                'Id'           => p.Id,
                'Name'         => p.Name,
                'Family'       => p.Product_Family_Dict__r != null ? p.Product_Family_Dict__r.Name : null,
                'Family_of_Needs__c' => p.Family_of_Needs_Dict__r != null ? p.Family_of_Needs_Dict__r.Name : null,
                'IsActive'     => p.IsActive,
                'productTypeName' => p.Product_Type_Dict__r != null ? p.Product_Type_Dict__r.Name : null,
                'customerType' => String.join(ctNames, ';')
            });
        }
        return result;
    }

    /**
     * Customer-type audience options sourced from the Marketing Dictionary (Product record type,
     * Customer Type sub-type). Returned as Id/name pairs so the offer wizard binds by Id — new
     * dictionary entries surface automatically and renames stay a single source of truth.
     */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> getCustomerTypeOptions() {
        List<Map<String, Object>> options = new List<Map<String, Object>>();
        for (Marketing_Dictionary__c d : [
            SELECT Id, Name FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Product'
              AND Dictionary_Sub_Type__c = 'Customer Type'
            ORDER BY Name ASC
        ]) {
            options.add(new Map<String, Object>{ 'id' => d.Id, 'name' => d.Name });
        }
        return options;
    }

    /**
     * Returns dynamic offer attributes configured for the given product family (by name).
     * Each entry includes the attribute definition fields and the per-family rule settings.
     * Value_Source__c values: 'Operator Defined' = user input, 'Apriori' = pre-set (read-only display),
     * 'Autopopulate' = auto-filled from Reference_Value__c.
     */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> getOfferAttributesForFamily(String productFamilyName) {
        if (String.isBlank(productFamilyName)) return new List<Map<String, Object>>();

        // Resolve the product family Marketing_Dictionary__c Id by name
        List<Marketing_Dictionary__c> families = [
            SELECT Id FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Product'
            AND Dictionary_Sub_Type__c = 'Product Family'
            AND Name = :productFamilyName
            LIMIT 1
        ];
        if (families.isEmpty()) return new List<Map<String, Object>>();
        Id familyId = families[0].Id;

        // Fetch all active attribute rules for this family, with parent attribute details
        List<Offer_Attribute_Rule__c> rules = [
            SELECT Id,
                   Offer_Attribute__c,
                   Offer_Attribute__r.Name,
                   Offer_Attribute__r.Parameter_API_Name__c,
                   Offer_Attribute__r.Parameter_Type__c,
                   Offer_Attribute__r.Value_Source__c,
                   Offer_Attribute__r.Parameter_Help_Text__c,
                   Offer_Attribute__r.Attribute_Description__c,
                   Offer_Attribute__r.Default_Value__c,
                   Offer_Attribute__r.Is_Globally_Required__c,
                   Offer_Attribute__r.Is_Active__c,
                   Is_Visible__c,
                   Is_Required__c,
                   Display_Order__c,
                   Impacts_Attractiveness__c,
                   Attractiveness_Weight__c,
                   Reference_Value__c,
                   Reference_Value__r.Reference_Value__c,
                   Reference_Value__r.Value_Type__c
            FROM Offer_Attribute_Rule__c
            WHERE Product_Family__c = :familyId
            AND Is_Visible__c = true
            AND Offer_Attribute__r.Is_Active__c = true
            ORDER BY Display_Order__c ASC NULLS LAST, Offer_Attribute__r.Name ASC
        ];

        List<Map<String, Object>> result = new List<Map<String, Object>>();
        for (Offer_Attribute_Rule__c r : rules) {
            String helpText = r.Offer_Attribute__r.Parameter_Help_Text__c;
            String paramType = r.Offer_Attribute__r.Parameter_Type__c;
            String valueSource = r.Offer_Attribute__r.Value_Source__c;

            // For Picklist type, picklist options are stored in Parameter_Help_Text__c (newline-separated)
            List<String> picklistOptions = new List<String>();
            if (paramType == 'Picklist' && String.isNotBlank(helpText)) {
                for (String line : helpText.split('\n')) {
                    String trimmed = line.trim();
                    if (String.isNotBlank(trimmed)) picklistOptions.add(trimmed);
                }
            }

            Object autoValue = null;
            if (valueSource == 'Autopopulate' && r.Reference_Value__c != null && r.Reference_Value__r != null) {
                autoValue = r.Reference_Value__r.Reference_Value__c;
            }

            result.add(new Map<String, Object>{
                'ruleId'              => r.Id,
                'attrId'              => r.Offer_Attribute__c,
                'name'                => r.Offer_Attribute__r.Name,
                'field'               => r.Offer_Attribute__r.Parameter_API_Name__c,
                'type'                => paramType,
                'valueSource'         => valueSource,
                'helpText'            => r.Offer_Attribute__r.Parameter_Help_Text__c,
                'description'         => r.Offer_Attribute__r.Attribute_Description__c,
                'defaultValue'        => r.Offer_Attribute__r.Default_Value__c,
                'isRequired'          => r.Is_Required__c || r.Offer_Attribute__r.Is_Globally_Required__c,
                'impactsAttractiveness' => r.Impacts_Attractiveness__c,
                'attractivenessWeight'  => r.Attractiveness_Weight__c,
                'picklistOptions'     => picklistOptions,
                'autoValue'           => autoValue
            });
        }
        return result;
    }

    @AuraEnabled(cacheable=true)
    public static List<String> getProductFamilyValues() {
        List<String> opts = new List<String>();
        for (Marketing_Dictionary__c rec : [
            SELECT Name
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Product'
            AND Dictionary_Sub_Type__c = 'Product Family'
            ORDER BY Name ASC
            LIMIT 500
        ]) {
            opts.add(rec.Name);
        }
        return opts;
    }

    // ─── CREATE ──────────────────────────────────────────────────────────────

    @AuraEnabled
    public static Id saveNewOffer(Map<String, Object> offerData, Boolean activateImmediately, Boolean saveAsReady) {
        if (offerData == null || offerData.isEmpty()) throw new AuraHandledException('Offer data is required.');

        String offerName = offerData.containsKey('Name') ? String.valueOf(offerData.get('Name')) : 'Offer';
        Decimal score = computeScore(offerData);

        Date startDate = offerData.containsKey('Valid_From__c') && offerData.get('Valid_From__c') != null
            ? Date.valueOf(String.valueOf(offerData.get('Valid_From__c'))) : null;
        Boolean isFuture = (activateImmediately == true && startDate != null && startDate > Date.today());

        // Determine the initial offer and version status
        String versionStatus = 'Draft';
        Boolean versionActive = false;
        String offerStatus = 'Draft';
        Boolean offerActive = false;

        if (activateImmediately == true && !isFuture) {
            versionStatus = 'Active';
            versionActive = true;
            offerStatus = 'Active';
            offerActive = true;
        } else if (activateImmediately == true && isFuture) {
            versionStatus = 'Scheduled';
        } else if (saveAsReady == true) {
            versionStatus = 'Ready';
        }

        Offer__c offer = new Offer__c();
        if (offerData.containsKey('Name')) offer.Name = offerName;
        if (offerData.containsKey('Country_Code__c')) offer.Country_Code__c = offerData.get('Country_Code__c') != null ? normaliseCountryCodeForOffer(String.valueOf(offerData.get('Country_Code__c'))) : null;
        if (offerData.containsKey('Currency_Code__c') && offerData.get('Currency_Code__c') != null) offer.CurrencyIsoCode = String.valueOf(offerData.get('Currency_Code__c'));
        offer.Offer_Status__c = offerStatus;
        offer.Is_Active__c = offerActive;
        offer.Attractiveness_Score__c = score;

        try {
            insert offer;
        } catch (DmlException e) {
            throw new AuraHandledException('Failed to create Offer: ' + e.getDmlMessage(0));
        }

        Offer_Version__c version = new Offer_Version__c();
        version.Offer_Lookup__c = offer.Id;
        populateVersionFields(version, offerData);
        // Bug 2 fix: version Name = OfferName_v1
        version.Name = offerName + '_v1';
        version.Version_Status__c = versionStatus;
        version.Is_Active__c = versionActive;
        version.Version_Number__c = 1;
        version.Offer_Version_Id__c = generateVersionId();
        version.Attractiveness_Score__c = score;

        if (isFuture) {
            version.Schedule_Status__c = 'Scheduled for Activation';
            version.Schedule_Date__c = startDate;
        } else if (versionStatus == 'Active') {
            version.Schedule_Status__c = null;
            version.Schedule_Date__c = null;
            offer.Offer_Version_Id__c = version.Offer_Version_Id__c;
        }

        try {
            insert version;
        } catch (DmlException e) {
            delete offer;
            throw new AuraHandledException('Failed to create Offer Version: ' + e.getDmlMessage(0));
        }

        // Sync version UUID back to offer when activated immediately
        if (versionStatus == 'Active') {
            offer.Offer_Version_Id__c = version.Offer_Version_Id__c;
            try { update offer; } catch (DmlException e) { /* non-critical */ }
        }

        syncVersionCustomerTypes(version.Id, offerData);

        return offer.Id;
    }

    // ─── VERSION LIFECYCLE ───────────────────────────────────────────────────

    /**
     * Save a new draft version on an existing offer.
     * If activateImmediately=true, activates the new version immediately.
     * The currently In-Use version (if any) is moved back to Ready.
     */
    @AuraEnabled
    public static Id createNewVersion(Id offerId, Map<String, Object> versionData, Boolean activateImmediately, Boolean saveAsReady) {
        if (offerId == null) throw new AuraHandledException('Offer Id is required.');
        if (versionData == null || versionData.isEmpty()) throw new AuraHandledException('Version data is required.');

        Offer__c offer = [
            SELECT Id, Name, Offer_Status__c
            FROM Offer__c
            WHERE Id = :offerId
            LIMIT 1
        ];

        if (offer.Offer_Status__c == 'Decommissioned') {
            throw new AuraHandledException('Cannot create a new version for a decommissioned offer.');
        }

        Decimal score = computeScore(versionData);
        String newVersionId = generateVersionId();
        Decimal versionNum = nextVersionNumber(offerId);

        // Bug 2 fix: version Name = OfferName_vN
        String offerName = offer.Name;

        Offer_Version__c newVersion = new Offer_Version__c();
        newVersion.Offer_Lookup__c = offerId;
        populateVersionFields(newVersion, versionData);
        newVersion.Name = offerName + '_v' + versionNum.intValue();
        newVersion.Offer_Version_Id__c = newVersionId;
        newVersion.Version_Number__c = versionNum;
        newVersion.Attractiveness_Score__c = score;

        if (activateImmediately == true) {
            Date startDate = versionData.containsKey('Valid_From__c') && versionData.get('Valid_From__c') != null
                ? Date.valueOf(String.valueOf(versionData.get('Valid_From__c'))) : null;
            Boolean isFuture = (startDate != null && startDate > Date.today());

            if (isFuture) {
                // New version scheduled — mark it as Scheduled for Activation
                newVersion.Version_Status__c = 'Scheduled';
                newVersion.Schedule_Status__c = 'Scheduled for Activation';
                newVersion.Schedule_Date__c = startDate;
                newVersion.Is_Active__c = false;
                try {
                    insert newVersion;
                } catch (DmlException e) {
                    throw new AuraHandledException('Failed to create version: ' + e.getDmlMessage(0));
                }
                // Update the deactivation schedule on the currently Active version
                // using the earliest Valid_From among all scheduled versions for this offer
                refreshDeactivationSchedule(offerId);
                // Offer master status unchanged — scheduler will flip it
            } else {
                // Immediate activation: deactivate existing In-Use / Scheduled versions
                List<Offer_Version__c> toDeactivate = [
                    SELECT Id FROM Offer_Version__c
                    WHERE Offer_Lookup__c = :offerId
                      AND Version_Status__c IN ('Active', 'Scheduled')
                ];
                for (Offer_Version__c v : toDeactivate) {
                    v.Version_Status__c = 'Deactivated';
                    v.Schedule_Status__c = null;
                    v.Schedule_Date__c = null;
                    v.Is_Active__c = false;
                }
                if (!toDeactivate.isEmpty()) update toDeactivate;

                newVersion.Version_Status__c = 'Active';
                newVersion.Schedule_Status__c = null;
                newVersion.Schedule_Date__c = null;
                newVersion.Is_Active__c = true;
                try {
                    insert newVersion;
                } catch (DmlException e) {
                    throw new AuraHandledException('Failed to create version: ' + e.getDmlMessage(0));
                }

                offer.Offer_Status__c = 'Active';
                offer.Is_Active__c = true;
                offer.Offer_Version_Id__c = newVersionId;
                offer.Attractiveness_Score__c = score;
                if (versionData.containsKey('Currency_Code__c') && versionData.get('Currency_Code__c') != null) {
                    offer.CurrencyIsoCode = String.valueOf(versionData.get('Currency_Code__c'));
                }
                try {
                    update offer;
                } catch (DmlException e) {
                    throw new AuraHandledException('Failed to update Offer: ' + e.getDmlMessage(0));
                }
            }
        } else {
            newVersion.Version_Status__c = (saveAsReady == true) ? 'Ready' : 'Draft';
            newVersion.Is_Active__c = false;
            try {
                insert newVersion;
            } catch (DmlException e) {
                throw new AuraHandledException('Failed to create version: ' + e.getDmlMessage(0));
            }
        }

        syncVersionCustomerTypes(newVersion.Id, versionData);

        return newVersion.Id;
    }

    /**
     * Update an existing Draft version in-place (edit mode).
     * Only Draft versions may be updated this way.
     */
    @AuraEnabled
    public static void updateVersion(Id versionId, Map<String, Object> versionData) {
        if (versionId == null) throw new AuraHandledException('Version Id is required.');
        if (versionData == null || versionData.isEmpty()) throw new AuraHandledException('Version data is required.');

        Offer_Version__c v = [
            SELECT Id, Version_Status__c FROM Offer_Version__c WHERE Id = :versionId LIMIT 1
        ];
        if (v.Version_Status__c == 'Deactivated') {
            throw new AuraHandledException('Deactivated versions cannot be edited. Clone it to create a new version.');
        }
        if (v.Version_Status__c == 'Scheduled') {
            throw new AuraHandledException('Scheduled versions cannot be edited directly. Create a new version instead.');
        }
        if (v.Version_Status__c != 'Draft') {
            throw new AuraHandledException('This offer version is marked as \'Ready\'. Revert it to \'Draft\' first or create a new version.');
        }

        populateVersionFields(v, versionData);
        v.Attractiveness_Score__c = computeScore(versionData);
        try {
            update v;
        } catch (DmlException e) {
            throw new AuraHandledException('Failed to update version: ' + e.getDmlMessage(0));
        }

        syncVersionCustomerTypes(v.Id, versionData);
    }

    /**
     * Update validity dates and CTA/REG URLs on any non-Deactivated version.
     * All parameters are optional — only non-null values are written.
     */
    @AuraEnabled
    public static void updateVersionDatesAndUrls(Id versionId, String validFrom, String validTo,
                                                  String ctaUrl, String ctaDurl, String ctaIntent, String regUrl) {
        if (versionId == null) throw new AuraHandledException('Version Id is required.');

        Offer_Version__c v = [
            SELECT Id, Version_Status__c FROM Offer_Version__c WHERE Id = :versionId LIMIT 1
        ];
        if (v.Version_Status__c == 'Deactivated') {
            throw new AuraHandledException('Deactivated versions cannot be edited. Clone it to create a new version.');
        }

        if (validFrom  != null) v.Valid_From__c  = Date.valueOf(validFrom);
        if (validTo    != null) v.Valid_To__c    = Date.valueOf(validTo);
        if (ctaUrl     != null) v.CTA_URL__c     = ctaUrl;
        if (ctaDurl    != null) v.CTA_DURL__c    = ctaDurl;
        if (ctaIntent  != null) v.CTA_Intent__c  = ctaIntent;
        if (regUrl     != null) v.REG_URL__c     = regUrl;

        try {
            update v;
        } catch (DmlException e) {
            throw new AuraHandledException('Failed to update version: ' + e.getDmlMessage(0));
        }
    }

    /**
     * Update only CTA/REG URL fields on a Draft or Ready version.
     * This does not create a new version — it patches in-place.
     */
    @AuraEnabled
    public static void updateVersionCtaFields(Id versionId, String ctaUrl, String ctaDurl, String ctaIntent, String regUrl) {
        if (versionId == null) throw new AuraHandledException('Version Id is required.');

        Offer_Version__c v = [
            SELECT Id, Version_Status__c FROM Offer_Version__c WHERE Id = :versionId LIMIT 1
        ];
        if (v.Version_Status__c == 'Deactivated') {
            throw new AuraHandledException('Deactivated versions cannot be edited. Clone it to create a new version.');
        }
        if (v.Version_Status__c != 'Draft' && v.Version_Status__c != 'Ready') {
            throw new AuraHandledException('CTA fields can only be updated on Draft or Ready versions.');
        }

        v.CTA_URL__c    = ctaUrl;
        v.CTA_DURL__c   = ctaDurl;
        v.CTA_Intent__c = ctaIntent;
        v.REG_URL__c    = regUrl;
        try {
            update v;
        } catch (DmlException e) {
            throw new AuraHandledException('Failed to update CTA fields: ' + e.getDmlMessage(0));
        }
    }

    /**
     * Update the master Offer__c name, country code, and currency ISO code.
     * Also propagates name/country/currency to all non-decommissioned versions.
     */
    @AuraEnabled
    public static void updateMasterOffer(Id offerId, String offerName, String countryCode, String currencyCode) {
        if (offerId == null) throw new AuraHandledException('Offer Id is required.');

        Offer__c offer = [SELECT Id, Name, Country_Code__c, CurrencyIsoCode FROM Offer__c WHERE Id = :offerId LIMIT 1];
        if (String.isNotBlank(offerName))   offer.Name = offerName;
        if (String.isNotBlank(countryCode)) offer.Country_Code__c = normaliseCountryCodeForOffer(countryCode);
        if (String.isNotBlank(currencyCode)) offer.CurrencyIsoCode = currencyCode;
        try {
            update offer;
        } catch (DmlException e) {
            throw new AuraHandledException('Failed to update Offer: ' + e.getDmlMessage(0));
        }

        // Propagate to all versions
        List<Offer_Version__c> versions = [
            SELECT Id, Name, Country_Code__c, Currency_Code__c, CurrencyIsoCode
            FROM Offer_Version__c
            WHERE Offer_Lookup__c = :offerId
        ];
        for (Offer_Version__c v : versions) {
            if (String.isNotBlank(offerName))   v.Name = offerName;
            if (String.isNotBlank(countryCode)) v.Country_Code__c = normaliseCountryCodeForVersion(countryCode);
            if (String.isNotBlank(currencyCode)) { v.Currency_Code__c = currencyCode; v.CurrencyIsoCode = currencyCode; }
        }
        if (!versions.isEmpty()) {
            try {
                update versions;
            } catch (DmlException e) {
                throw new AuraHandledException('Failed to propagate changes to versions: ' + e.getDmlMessage(0));
            }
        }
    }

    /**
     * Delete an offer version. In-Use versions cannot be deleted.
     */
    @AuraEnabled
    public static void deleteVersion(Id versionId) {
        if (versionId == null) throw new AuraHandledException('Version Id is required.');
        Offer_Version__c v = [
            SELECT Id, Version_Status__c FROM Offer_Version__c WHERE Id = :versionId LIMIT 1
        ];
        if (v.Version_Status__c == 'Active' || v.Version_Status__c == 'Scheduled') {
            throw new AuraHandledException('Cannot delete a version that is currently In Use or Scheduled.');
        }
        try {
            delete v;
        } catch (DmlException e) {
            throw new AuraHandledException('Failed to delete version: ' + e.getDmlMessage(0));
        }
    }

    /**
     * Mark a Draft version as Ready.
     * Once Ready, the version's attributes are locked until it is activated
     * or the user explicitly reverts it to Draft.
     */
    @AuraEnabled
    public static void markVersionReady(Id versionId) {
        if (versionId == null) throw new AuraHandledException('Version Id is required.');
        Offer_Version__c v = [
            SELECT Id, Version_Status__c
            FROM Offer_Version__c
            WHERE Id = :versionId
            LIMIT 1
        ];
        if (v.Version_Status__c == 'Deactivated') {
            throw new AuraHandledException('Deactivated versions cannot be modified.');
        }
        if (v.Version_Status__c != 'Draft') {
            throw new AuraHandledException('Only Draft versions can be marked as Ready.');
        }
        v.Version_Status__c = 'Ready';
        update v;
    }

    /**
     * Revert a Ready version back to Draft so its attributes can be edited again.
     */
    @AuraEnabled
    public static void revertVersionToDraft(Id versionId) {
        if (versionId == null) throw new AuraHandledException('Version Id is required.');
        Offer_Version__c v = [
            SELECT Id, Version_Status__c
            FROM Offer_Version__c
            WHERE Id = :versionId
            LIMIT 1
        ];
        if (v.Version_Status__c == 'Deactivated') {
            throw new AuraHandledException('Deactivated versions cannot be modified.');
        }
        if (v.Version_Status__c != 'Ready') {
            throw new AuraHandledException('Only Ready versions can be reverted to Draft.');
        }
        v.Version_Status__c = 'Draft';
        update v;
    }

    /**
     * Activate a specific version by its Salesforce Id.
     *
     * - If Valid_From is today or in the past  → immediate activation (In Use).
     *   The currently In-Use / Scheduled-for-Deactivation version is moved to Deactivated.
     * - If Valid_From is in the future          → scheduled activation.
     *   New version → Scheduled for Activation.
     *   Existing In-Use version → Scheduled for Deactivation (still treated as active until the
     *   daily scheduler fires on the target date).
     */
    @AuraEnabled
    public static void activateVersion(Id offerId, Id versionId) {
        if (offerId == null || versionId == null) throw new AuraHandledException('Offer Id and Version Id are required.');

        Offer_Version__c version = [
            SELECT Id, Name, Version_Status__c, Valid_From__c,
                   Offer_Version_Id__c, Attractiveness_Score__c,
                   Country_Code__c, Currency_Code__c
            FROM Offer_Version__c
            WHERE Id = :versionId
            LIMIT 1
        ];

        if (version.Version_Status__c == 'Active') {
            throw new AuraHandledException('This version is already In Use.');
        }
        if (version.Version_Status__c == 'Scheduled') {
            throw new AuraHandledException('This version is already scheduled for activation.');
        }
        if (version.Version_Status__c == 'Deactivated') {
            throw new AuraHandledException('A Deactivated version cannot be reactivated. Clone it to create a new version.');
        }

        Date startDate = version.Valid_From__c;
        Boolean isFuture = (startDate != null && startDate > Date.today());

        if (isFuture) {
            // ── Scheduled path ────────────────────────────────────────────────
            // Mark this version as Scheduled for Activation (Active version stays Active)
            version.Version_Status__c = 'Scheduled';
            version.Schedule_Status__c = 'Scheduled for Activation';
            version.Schedule_Date__c = startDate;
            version.Is_Active__c = false;
            try {
                update version;
            } catch (DmlException e) {
                throw new AuraHandledException('Failed to schedule version: ' + e.getDmlMessage(0));
            }
            // Recalculate the earliest scheduled activation and update the Active version's deactivation date
            refreshDeactivationSchedule(offerId);
            // Offer master stays in its current status — the scheduler will flip it to Active
        } else {
            // ── Immediate path ────────────────────────────────────────────────
            // Deactivate any In-Use (including those tagged for deactivation) and Scheduled versions
            List<Offer_Version__c> toDeactivate = [
                SELECT Id FROM Offer_Version__c
                WHERE Offer_Lookup__c = :offerId
                  AND Version_Status__c IN ('Active', 'Scheduled')
            ];
            for (Offer_Version__c v : toDeactivate) {
                v.Version_Status__c = 'Deactivated';
                v.Schedule_Status__c = null;
                v.Schedule_Date__c = null;
                v.Is_Active__c = false;
            }
            if (!toDeactivate.isEmpty()) update toDeactivate;

            version.Version_Status__c = 'Active';
            version.Schedule_Status__c = null;
            version.Schedule_Date__c = null;
            version.Is_Active__c = true;
            try {
                update version;
            } catch (DmlException e) {
                throw new AuraHandledException('Failed to activate version: ' + e.getDmlMessage(0));
            }

            Offer__c offer = [SELECT Id, Country_Code__c, CurrencyIsoCode FROM Offer__c WHERE Id = :offerId LIMIT 1];
            offer.Is_Active__c = true;
            offer.Offer_Status__c = 'Active';
            offer.Offer_Version_Id__c = version.Offer_Version_Id__c;
            offer.Attractiveness_Score__c = version.Attractiveness_Score__c;
            if (String.isNotBlank(version.Country_Code__c)) {
                offer.Country_Code__c = normaliseCountryCodeForOffer(version.Country_Code__c);
            }
            if (String.isNotBlank(version.Currency_Code__c)) {
                offer.CurrencyIsoCode = version.Currency_Code__c;
            }
            try {
                update offer;
            } catch (DmlException e) {
                throw new AuraHandledException('Failed to sync Offer: ' + e.getDmlMessage(0));
            }
        }
    }

    /**
     * Withdraw the activation schedule from a Scheduled version.
     * - The Scheduled version reverts to Ready (and its Schedule_Status is cleared).
     * - Any In-Use version that was tagged with Schedule_Status = 'Scheduled for Deactivation'
     *   for this offer has that flag removed, restoring it to plain In Use.
     */
    @AuraEnabled
    public static void withdrawSchedule(Id versionId) {
        if (versionId == null) throw new AuraHandledException('Version Id is required.');

        Offer_Version__c v = [
            SELECT Id, Version_Status__c, Schedule_Status__c, Offer_Lookup__c
            FROM Offer_Version__c
            WHERE Id = :versionId
            LIMIT 1
        ];

        if (v.Version_Status__c != 'Scheduled') {
            throw new AuraHandledException('Only Scheduled versions can have their schedule withdrawn.');
        }

        Id offerId = v.Offer_Lookup__c;
        v.Version_Status__c = 'Ready';
        v.Schedule_Status__c = null;
        v.Schedule_Date__c = null;
        v.Is_Active__c = false;
        update v;

        // Recalculate deactivation schedule on the Active version
        // (may clear it if no other scheduled versions remain)
        refreshDeactivationSchedule(offerId);
    }

    /** Convenience overload — look up version by UUID then delegate. */
    @AuraEnabled
    public static void activateOfferVersion(Id offerId, String versionUuid) {
        if (offerId == null || String.isBlank(versionUuid)) throw new AuraHandledException('Offer Id and Version UUID are required.');
        List<Offer_Version__c> rows = [
            SELECT Id FROM Offer_Version__c
            WHERE Offer_Lookup__c = :offerId AND Offer_Version_Id__c = :versionUuid
            LIMIT 1
        ];
        if (rows.isEmpty()) throw new AuraHandledException('Version not found.');
        activateVersion(offerId, rows[0].Id);
    }

    // ─── OFFER STATUS TRANSITIONS ────────────────────────────────────────────

    /**
     * Deactivate the offer (Inactive).
     * The In-Use version is moved to Ready so it can be reactivated later.
     * Offer can be reactivated by activating any Ready/Draft version.
     */
    @AuraEnabled
    public static void deactivateOffer(Id offerId) {
        if (offerId == null) throw new AuraHandledException('Offer Id is required.');

        Offer__c offer = [SELECT Id FROM Offer__c WHERE Id = :offerId LIMIT 1];
        offer.Offer_Status__c = 'Inactive';
        offer.Is_Active__c = false;
        update offer;

        List<Offer_Version__c> toDeactivate = [
            SELECT Id FROM Offer_Version__c
            WHERE Offer_Lookup__c = :offerId
              AND Version_Status__c IN ('Active', 'Scheduled')
        ];
        for (Offer_Version__c v : toDeactivate) {
            v.Version_Status__c = 'Deactivated';
            v.Schedule_Status__c = null;
            v.Schedule_Date__c = null;
            v.Is_Active__c = false;
        }
        if (!toDeactivate.isEmpty()) update toDeactivate;
    }

    /**
     * Decommission the offer — irreversible.
     * All versions lose their active flag. Offer cannot be activated again.
     */
    @AuraEnabled
    public static void decommissionOffer(Id offerId) {
        if (offerId == null) throw new AuraHandledException('Offer Id is required.');

        Offer__c offer = [SELECT Id FROM Offer__c WHERE Id = :offerId LIMIT 1];
        offer.Offer_Status__c = 'Decommissioned';
        offer.Is_Active__c = false;
        update offer;

        List<Offer_Version__c> active = [
            SELECT Id, Version_Status__c FROM Offer_Version__c
            WHERE Offer_Lookup__c = :offerId AND Is_Active__c = true
        ];
        for (Offer_Version__c v : active) {
            v.Is_Active__c = false;
        }
        if (!active.isEmpty()) update active;
    }

    // ─── DATE OVERLAP UTILITIES ──────────────────────────────────────────────

    @AuraEnabled
    public static Map<String, Object> checkDateOverlap(Id offerId, Date newValidFrom, Date newValidTo) {
        Map<String, Object> result = new Map<String, Object>{
            'hasOverlap' => false, 'currentValidFrom' => null, 'currentValidTo' => null
        };
        if (offerId == null || newValidFrom == null || newValidTo == null) return result;

        List<Offer_Version__c> inUse = [
            SELECT Valid_From__c, Valid_To__c FROM Offer_Version__c
            WHERE Offer_Lookup__c = :offerId AND Version_Status__c = 'Active'
            LIMIT 1
        ];
        if (inUse.isEmpty()) return result;

        Date cFrom = inUse[0].Valid_From__c;
        Date cTo   = inUse[0].Valid_To__c;
        result.put('currentValidFrom', cFrom);
        result.put('currentValidTo', cTo);
        if (cFrom != null && cTo != null) {
            result.put('hasOverlap', newValidFrom <= cTo && newValidTo >= cFrom);
        }
        return result;
    }

    @AuraEnabled
    public static void resolveDateOverlap(Id offerId, Date newValidFrom) {
        if (offerId == null || newValidFrom == null) throw new AuraHandledException('Offer Id and new valid from date are required.');
        Date adjustedTo = newValidFrom.addDays(-1);

        List<Offer_Version__c> inUse = [
            SELECT Id FROM Offer_Version__c
            WHERE Offer_Lookup__c = :offerId AND Version_Status__c = 'Active'
        ];
        for (Offer_Version__c v : inUse) v.Valid_To__c = adjustedTo;
        if (!inUse.isEmpty()) update inUse;
    }

    // ─── PRIVATE HELPERS ─────────────────────────────────────────────────────

    /**
     * Recalculate the deactivation schedule on the currently Active version.
     *
     * Rules:
     *  - Find all Scheduled versions for this offer (Scheduled for Activation).
     *  - If any exist, the Active version receives Schedule_Status = 'Scheduled for Deactivation'
     *    and Schedule_Date = the earliest Valid_From among all scheduled versions
     *    (unless the Active version's own Valid_To is even earlier, in which case the
     *    scheduler will expire it naturally — we still set the schedule date so the badge shows).
     *  - If NO scheduled versions remain, clear Schedule_Status and Schedule_Date from the Active version.
     */
    public static void refreshDeactivationSchedulePublic(Id offerId) {
        refreshDeactivationSchedule(offerId);
    }

    private static void refreshDeactivationSchedule(Id offerId) {
        List<Offer_Version__c> scheduled = [
            SELECT Id, Valid_From__c FROM Offer_Version__c
            WHERE Offer_Lookup__c = :offerId
              AND Version_Status__c = 'Scheduled'
              AND Schedule_Status__c = 'Scheduled for Activation'
            ORDER BY Valid_From__c ASC NULLS LAST
        ];

        List<Offer_Version__c> activeVersions = [
            SELECT Id, Schedule_Status__c, Schedule_Date__c, Valid_From__c, Valid_To__c FROM Offer_Version__c
            WHERE Offer_Lookup__c = :offerId AND Version_Status__c = 'Active'
        ];
        if (activeVersions.isEmpty()) return;

        for (Offer_Version__c av : activeVersions) {
            if (scheduled.isEmpty()) {
                // No more scheduled versions — clear the deactivation schedule
                av.Schedule_Status__c = null;
                av.Schedule_Date__c = null;
            } else {
                Date incomingFrom = scheduled[0].Valid_From__c;
                av.Schedule_Status__c = 'Scheduled for Deactivation';
                // Trim Valid_To to the day before the incoming version activates,
                // but never earlier than Valid_From (would create an invalid date range).
                if (incomingFrom != null) {
                    Date trimmedTo = incomingFrom.addDays(-1);
                    if (av.Valid_From__c == null || trimmedTo >= av.Valid_From__c) {
                        av.Valid_To__c = trimmedTo;
                        av.Schedule_Date__c = trimmedTo;
                    } else {
                        av.Schedule_Date__c = incomingFrom;
                    }
                } else {
                    av.Schedule_Date__c = incomingFrom;
                }
            }
        }
        update activeVersions;
    }

    private static Decimal computeScore(Map<String, Object> data) {
        String family = data.containsKey('Product_Family_Name__c') && data.get('Product_Family_Name__c') != null
            ? String.valueOf(data.get('Product_Family_Name__c')) : null;
        return OfferAttractivenessCalculator.calculate(family, data);
    }

    private static Decimal nextVersionNumber(Id offerId) {
        List<Offer_Version__c> latest = [
            SELECT Version_Number__c FROM Offer_Version__c
            WHERE Offer_Lookup__c = :offerId AND Version_Number__c != null
            ORDER BY Version_Number__c DESC LIMIT 1
        ];
        return (latest.isEmpty() || latest[0].Version_Number__c == null) ? 1 : latest[0].Version_Number__c + 1;
    }

    private static String generateVersionId() {
        String hex = EncodingUtil.convertToHex(Crypto.generateAesKey(128));
        return hex.substring(0,8)+'-'+hex.substring(8,12)+'-'+hex.substring(12,16)+'-'+hex.substring(16,20)+'-'+hex.substring(20,32);
    }

    private static void populateOfferFields(Offer__c o, Map<String, Object> d) {
        if (d.containsKey('Name'))             o.Name = String.valueOf(d.get('Name'));
        if (d.containsKey('Country_Code__c'))  o.Country_Code__c = d.get('Country_Code__c') != null ? normaliseCountryCodeForOffer(String.valueOf(d.get('Country_Code__c'))) : null;
        if (d.containsKey('Currency_Code__c')) o.CurrencyIsoCode = String.valueOf(d.get('Currency_Code__c'));
    }

    private static void populateVersionFields(Offer_Version__c v, Map<String, Object> d) {
        if (d.containsKey('Name'))                         v.Name = String.valueOf(d.get('Name'));
        if (d.containsKey('Country_Code__c'))              v.Country_Code__c = d.get('Country_Code__c') != null ? normaliseCountryCodeForVersion(String.valueOf(d.get('Country_Code__c'))) : null;
        if (d.containsKey('Currency_Code__c'))             { v.Currency_Code__c = String.valueOf(d.get('Currency_Code__c')); v.CurrencyIsoCode = String.valueOf(d.get('Currency_Code__c')); }
        if (d.containsKey('Product_Family_Name__c'))       v.Product_Family_Name__c = d.get('Product_Family_Name__c') != null ? String.valueOf(d.get('Product_Family_Name__c')) : null;
        if (d.containsKey('Source_Products__c'))           v.Source_Products__c = String.valueOf(d.get('Source_Products__c'));
        if (d.containsKey('Valid_From__c'))                v.Valid_From__c = d.get('Valid_From__c') != null ? Date.valueOf(String.valueOf(d.get('Valid_From__c'))) : null;
        if (d.containsKey('Valid_To__c'))                  v.Valid_To__c = d.get('Valid_To__c') != null ? Date.valueOf(String.valueOf(d.get('Valid_To__c'))) : null;
        if (d.containsKey('Is_Promo__c'))                  v.Is_Promo__c = Boolean.valueOf(d.get('Is_Promo__c'));
        if (d.containsKey('Additional_Parameters__c'))     v.Additional_Parameters__c = d.get('Additional_Parameters__c') != null ? String.valueOf(d.get('Additional_Parameters__c')) : null;
        if (d.containsKey('Base_Interest_Rate__c'))        v.Base_Interest_Rate__c = toDecimal(d.get('Base_Interest_Rate__c'));
        if (d.containsKey('Card_Fee__c'))                  v.Card_Fee__c = Boolean.valueOf(d.get('Card_Fee__c'));
        if (d.containsKey('Commission_Amount_Flat_Fee__c')) v.Commission_Amount_Flat_Fee__c = toDecimal(d.get('Commission_Amount_Flat_Fee__c'));
        if (d.containsKey('Commission_Percentage__c'))     v.Commission_Percentage__c = toDecimal(d.get('Commission_Percentage__c'));
        if (d.containsKey('CTA_DURL__c'))                  v.CTA_DURL__c = String.valueOf(d.get('CTA_DURL__c'));
        if (d.containsKey('CTA_URL__c'))                   v.CTA_URL__c = String.valueOf(d.get('CTA_URL__c'));
        if (d.containsKey('Currency__c'))                  v.Currency__c = toDecimal(d.get('Currency__c'));
        if (d.containsKey('Deposit_Duration_Months__c'))   v.Deposit_Duration_Months__c = toDecimal(d.get('Deposit_Duration_Months__c'));
        if (d.containsKey('Duration_Days__c'))             v.Duration_Days__c = toDecimal(d.get('Duration_Days__c'));
        if (d.containsKey('Grace_Period_Days__c'))         v.Grace_Period_Days__c = d.get('Grace_Period_Days__c') != null ? String.valueOf(d.get('Grace_Period_Days__c')) : null;
        if (d.containsKey('Interest_Capitalization__c'))   v.Interest_Capitalization__c = String.valueOf(d.get('Interest_Capitalization__c'));
        if (d.containsKey('Max_Owned_Products_Limit__c'))  v.Max_Owned_Products_Limit__c = toDecimal(d.get('Max_Owned_Products_Limit__c'));
        if (d.containsKey('Maximum_Amount__c'))            v.Maximum_Amount__c = toDecimal(d.get('Maximum_Amount__c'));
        if (d.containsKey('Maximum_Tenure__c'))            v.Maximum_Tenure__c = toDecimal(d.get('Maximum_Tenure__c'));
        if (d.containsKey('Minimal_Amount__c'))            v.Minimal_Amount__c = toDecimal(d.get('Minimal_Amount__c'));
        if (d.containsKey('Nominal_Interest_Rate__c'))     v.Nominal_Interest_Rate__c = toDecimal(d.get('Nominal_Interest_Rate__c'));
        if (d.containsKey('Offer_Description__c'))         v.Offer_Description__c = String.valueOf(d.get('Offer_Description__c'));
        if (d.containsKey('Promotional_Interest_Rate__c')) v.Promotional_Interest_Rate__c = toDecimal(d.get('Promotional_Interest_Rate__c'));
        if (d.containsKey('Representative_Example__c'))    v.Representative_Example__c = String.valueOf(d.get('Representative_Example__c'));
        if (d.containsKey('RRSO__c'))                      v.RRSO__c = toDecimal(d.get('RRSO__c'));
        if (d.containsKey('Statute_URL__c'))               v.Statute_URL__c = String.valueOf(d.get('Statute_URL__c'));
        if (d.containsKey('Maximum_Promotional_Amount__c')) v.Maximum_Promotional_Amount__c = toDecimal(d.get('Maximum_Promotional_Amount__c'));
        if (d.containsKey('Earlier_Repayment_Fee__c'))     v.Earlier_Repayment_Fee__c = String.valueOf(d.get('Earlier_Repayment_Fee__c'));
        if (d.containsKey('Interest_Type__c'))             v.Interest_Type__c = String.valueOf(d.get('Interest_Type__c'));
        if (d.containsKey('Sales_Process__c'))             v.Sales_Process__c = String.valueOf(d.get('Sales_Process__c'));
        if (d.containsKey('NO_Fees_Conditions_Simplicity__c')) v.NO_Fees_Conditions_Simplicity__c = String.valueOf(d.get('NO_Fees_Conditions_Simplicity__c'));
        if (d.containsKey('Additional_VAS__c'))            v.Additional_VAS__c = String.valueOf(d.get('Additional_VAS__c'));
        if (d.containsKey('Own_Input_Percentage__c'))      v.Own_Input_Percentage__c = String.valueOf(d.get('Own_Input_Percentage__c'));
        if (d.containsKey('Product_Id__c'))                v.Product_Id__c = d.get('Product_Id__c') != null ? String.valueOf(d.get('Product_Id__c')) : null;
        if (d.containsKey('Product_Family__c'))            v.Product_Family__c = d.get('Product_Family__c') != null ? String.valueOf(d.get('Product_Family__c')) : null;
        if (d.containsKey('CTA_Intent__c'))                v.CTA_Intent__c = d.get('CTA_Intent__c') != null ? String.valueOf(d.get('CTA_Intent__c')) : null;
        if (d.containsKey('REG_URL__c'))                   v.REG_URL__c = d.get('REG_URL__c') != null ? String.valueOf(d.get('REG_URL__c')) : null;
    }

    private static Decimal toDecimal(Object val) {
        return val != null ? Decimal.valueOf(String.valueOf(val)) : null;
    }

    /**
     * Replaces the customer-type audience junction rows for a version with the supplied
     * Marketing_Dictionary__c Ids. Only runs when the caller included the audience in the
     * save payload — a partial save (e.g. date/URL edit) that omits the key leaves the
     * existing junction rows untouched.
     */
    private static void syncVersionCustomerTypes(Id versionId, Map<String, Object> d) {
        if (versionId == null || !d.containsKey('Customer_Type_Ids')) return;

        delete [SELECT Id FROM Offer_Version_Customer_Type__c WHERE Offer_Version__c = :versionId];

        Object raw = d.get('Customer_Type_Ids');
        if (!(raw instanceof List<Object>)) return;

        Set<Id> ctIds = new Set<Id>();
        for (Object o : (List<Object>) raw) {
            if (o == null) continue;
            try { ctIds.add(Id.valueOf(String.valueOf(o))); } catch (Exception ignore) { /* skip malformed Id */ }
        }
        if (ctIds.isEmpty()) return;

        List<Offer_Version_Customer_Type__c> rows = new List<Offer_Version_Customer_Type__c>();
        for (Id ctId : ctIds) {
            rows.add(new Offer_Version_Customer_Type__c(Offer_Version__c = versionId, Customer_Type__c = ctId));
        }
        insert rows;
    }

    /** Offer__c.Country_Code__c has malformed values (e.g. "PL," instead of "PL").
     *  Match the incoming clean code against the actual picklist and return the stored value. */
    private static String normaliseCountryCodeForOffer(String code) {
        if (code == null) return null;
        String clean = code.removeEnd(',');
        for (Schema.PicklistEntry e : Offer__c.Country_Code__c.getDescribe().getPicklistValues()) {
            String v = e.getValue();
            if (v == code || v == clean || v == clean + ',') return v;
        }
        return code;
    }

    /** Offer_Version__c.Country_Code__c has clean values (e.g. "PL").
     *  Strip any trailing comma before writing. */
    private static String normaliseCountryCodeForVersion(String code) {
        if (code == null) return null;
        return code.removeEnd(',');
    }
}
