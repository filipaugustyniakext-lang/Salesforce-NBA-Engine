@isTest
private class MarketingDictionaryControllerTest {

    @isTest
    static void getMatchingOffers_returnsMatchFieldsAndActiveOnly() {
        // Active offer with an active version in the Mortgage family + source products.
        Offer__c activeOffer = new Offer__c(
            Country_Code__c = 'PL',
            Offer_Status__c = 'Active'
        );
        // Active offer whose only version is inactive -> must be excluded.
        Offer__c inactiveVersionOffer = new Offer__c(
            Country_Code__c = 'PL',
            Offer_Status__c = 'Active'
        );
        // Inactive-status offer that still has an active matching version -> must be excluded.
        Offer__c inactiveStatusOffer = new Offer__c(
            Country_Code__c = 'PL',
            Offer_Status__c = 'Inactive'
        );
        insert new List<Offer__c>{ activeOffer, inactiveVersionOffer, inactiveStatusOffer };

        insert new List<Offer_Version__c>{
            new Offer_Version__c(
                Offer_Lookup__c = activeOffer.Id,
                Is_Active__c = true,
                Product_Family_Name__c = 'Mortgage',
                Source_Products__c = 'Fixed Rate Mortgage'
            ),
            new Offer_Version__c(
                Offer_Lookup__c = inactiveVersionOffer.Id,
                Is_Active__c = false,
                Product_Family_Name__c = 'Mortgage',
                Source_Products__c = 'Old Product'
            ),
            new Offer_Version__c(
                Offer_Lookup__c = inactiveStatusOffer.Id,
                Is_Active__c = true,
                Product_Family_Name__c = 'Mortgage',
                Source_Products__c = 'Some Product'
            )
        };

        Test.startTest();
        List<Map<String, String>> results = MarketingDictionaryController.getMatchingOffers(
            new List<String>{ 'Mortgage' }, new List<String>()
        );
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Only the active offer with an active version should match');
        Map<String, String> row = results[0];
        System.assertEquals(activeOffer.Id, row.get('id'), 'Returns the active offer id');
        System.assertEquals('Mortgage', row.get('productFamilies'), 'Exposes matched product family for the tooltip');
        System.assertEquals('Fixed Rate Mortgage', row.get('sourceProducts'), 'Exposes source products for the tooltip');
        System.assertEquals('Active', row.get('status'), 'Status still returned');
    }

    @isTest
    static void getMatchingOffers_emptySelectionReturnsEmpty() {
        Test.startTest();
        List<Map<String, String>> results = MarketingDictionaryController.getMatchingOffers(
            new List<String>(), new List<String>()
        );
        Test.stopTest();
        System.assertEquals(0, results.size(), 'No families selected returns an empty list');
    }

    @isTest
    static void getOfferSummaries_returnsActiveVersionDetailAndParameters() {
        Offer__c offer = new Offer__c(
            Country_Code__c = 'PL',
            Offer_Status__c = 'Active'
        );
        insert offer;

        insert new List<Offer_Version__c>{
            // Active version -> surfaced in the summary.
            new Offer_Version__c(
                Offer_Lookup__c = offer.Id,
                Is_Active__c = true,
                Product_Family_Name__c = 'Consolidation Loan',
                Source_Products__c = 'Cash Loan',
                Offer_Target_Audience__c = 'Retail',
                Valid_From__c = Date.today(),
                Valid_To__c = Date.today().addDays(30),
                Nominal_Interest_Rate__c = 7.5,
                RRSO__c = 8.9,
                Additional_Parameters__c = '[{"key":"Custom Rate","value":"1.25"},{"key":"Blank Param","value":""}]'
            ),
            // Inactive version on the same offer -> ignored.
            new Offer_Version__c(
                Offer_Lookup__c = offer.Id,
                Is_Active__c = false,
                Product_Family_Name__c = 'Consolidation Loan'
            )
        };

        Test.startTest();
        List<Map<String, Object>> results = MarketingDictionaryController.getOfferSummaries(
            new List<Id>{ offer.Id }
        );
        Test.stopTest();

        System.assertEquals(1, results.size(), 'One summary per offer with an active version');
        Map<String, Object> row = results[0];
        System.assertEquals(offer.Id, row.get('id'), 'Returns the offer id');
        System.assertEquals('Consolidation Loan', row.get('productFamily'), 'Exposes product family');
        System.assertEquals('Cash Loan', row.get('sourceProducts'), 'Exposes source products');
        System.assertEquals('Retail', row.get('targetAudience'), 'Exposes target audience');

        List<Map<String, String>> params = (List<Map<String, String>>) row.get('parameters');
        System.assertNotEquals(null, params, 'Parameters list is present');
        Map<String, String> paramsByLabel = new Map<String, String>();
        for (Map<String, String> p : params) {
            paramsByLabel.put(p.get('label'), p.get('value'));
        }
        System.assert(paramsByLabel.containsKey('Nominal Interest Rate'), 'Populated standard field surfaced as parameter');
        System.assert(paramsByLabel.containsKey('Custom Rate'), 'Custom Additional_Parameters entry surfaced');
        System.assert(!paramsByLabel.containsKey('Blank Param'), 'Blank custom parameter is omitted');
    }

    @isTest
    static void getOfferSummaries_emptyInputReturnsEmpty() {
        Test.startTest();
        List<Map<String, Object>> nullResult = MarketingDictionaryController.getOfferSummaries(null);
        List<Map<String, Object>> emptyResult = MarketingDictionaryController.getOfferSummaries(new List<Id>());
        Test.stopTest();
        System.assertEquals(0, nullResult.size(), 'Null input returns an empty list');
        System.assertEquals(0, emptyResult.size(), 'Empty input returns an empty list');
    }

    @IsTest
    static void getCampaignConfigurationView_returnsWizardPayload() {
        Campaign camp = new Campaign(Name = 'Config View Camp', Status = 'Planned', IsActive = false);
        insert camp;

        Test.startTest();
        Map<String, Object> payload = MarketingDictionaryController.getCampaignConfigurationView(camp.Id);
        Test.stopTest();

        System.assertNotEquals(null, payload.get('campaign'));
        System.assertNotEquals(null, payload.get('offers'));
        System.assertNotEquals(null, payload.get('copyVariants'));
    }

    @IsTest
    static void saveCampaignCopyVariants_persistsOnlyPublishedRows() {
        Campaign camp = new Campaign(Name = 'Copy Camp', Status = 'Planned', IsActive = false);
        insert camp;

        CC_Message_Metadata__c published = new CC_Message_Metadata__c(
            Name = 'EMA_PL_CC_1',
            Channel_Type__c = 'Email',
            Status__c = 'Published'
        );
        CC_Message_Metadata__c draft = new CC_Message_Metadata__c(
            Name = 'EMA_PL_CC_2',
            Channel_Type__c = 'Email',
            Status__c = 'Draft'
        );
        insert new List<CC_Message_Metadata__c>{ published, draft };

        Test.startTest();
        MarketingDictionaryController.saveCampaignCopyVariants(
            camp.Id,
            new List<Id>{ published.Id, draft.Id }
        );
        Test.stopTest();

        List<Campaign_Copy_Variant__c> rows = [
            SELECT Message_Variant__c
            FROM Campaign_Copy_Variant__c
            WHERE Campaign__c = :camp.Id
        ];
        System.assertEquals(1, rows.size(), 'Only published variant is persisted');
        System.assertEquals(published.Id, rows[0].Message_Variant__c);

        List<Map<String, String>> loaded = MarketingDictionaryController.getCampaignCopyVariants(camp.Id);
        System.assertEquals(1, loaded.size());
        System.assertEquals(published.Id, loaded[0].get('id'));
    }

    @isTest
    static void searchSuppressionReports_returnsReportsWithFormat() {
        Test.startTest();
        List<Map<String, String>> allReports = MarketingDictionaryController.searchSuppressionReports('');
        List<Map<String, String>> filtered = MarketingDictionaryController.searchSuppressionReports('ZZZ_NO_MATCH_');
        Test.stopTest();

        System.assertNotEquals(null, allReports);
        System.assertEquals(0, filtered.size(), 'Non-matching search returns empty list');
    }

    @isTest
    static void searchSuppressionCampaigns_returnsActiveWithStatus() {
        insert new List<Campaign>{
            new Campaign(Name = 'Alpha Active', IsActive = true, Status = 'In Progress'),
            new Campaign(Name = 'Solo Active', IsActive = true, Status = 'Completed'),
            new Campaign(Name = 'Inactive Campaign', IsActive = false, Status = 'Completed')
        };

        Test.startTest();
        List<Map<String, String>> allActive = MarketingDictionaryController.searchSuppressionCampaigns('');
        List<Map<String, String>> filtered = MarketingDictionaryController.searchSuppressionCampaigns('Solo');
        Test.stopTest();

        System.assert(allActive.size() >= 2, 'Active campaigns are returned');
        System.assertEquals('In Progress', allActive[0].get('status'));
        System.assertEquals(1, filtered.size());
        System.assertEquals('Solo Active', filtered[0].get('name'));
    }
}