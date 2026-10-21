@IsTest
private class CampaignRuntimeCatalogServiceTest {

    @IsTest
    static void resolveEligibleOffers_requiresActiveOfferAndInDateVersion() {
        Campaign camp = new Campaign(Name = 'Runtime Offer Camp', Status = 'Planned', IsActive = false);
        insert camp;

        Offer__c activeOffer = new Offer__c(
            Country_Code__c = 'PL',
            Offer_Status__c = 'Active'
        );
        Offer__c inactiveOffer = new Offer__c(
            Country_Code__c = 'PL',
            Offer_Status__c = 'Inactive'
        );
        insert new List<Offer__c>{ activeOffer, inactiveOffer };

        insert new Offer_Version__c(
            Offer_Lookup__c = activeOffer.Id,
            Is_Active__c = true,
            Product_Family_Name__c = 'Mortgage',
            Valid_From__c = Date.today().addDays(-1),
            Valid_To__c = Date.today().addDays(30)
        );
        insert new Offer_Version__c(
            Offer_Lookup__c = inactiveOffer.Id,
            Is_Active__c = true,
            Product_Family_Name__c = 'Mortgage',
            Valid_From__c = Date.today().addDays(-1),
            Valid_To__c = Date.today().addDays(30)
        );

        insert new List<Campaign_Offer__c>{
            new Campaign_Offer__c(Campaign__c = camp.Id, Offer__c = activeOffer.Id),
            new Campaign_Offer__c(Campaign__c = camp.Id, Offer__c = inactiveOffer.Id)
        };

        Test.startTest();
        List<Map<String, String>> eligible = CampaignRuntimeCatalogService.resolveEligibleOffersForCampaign(camp.Id);
        Test.stopTest();

        System.assertEquals(1, eligible.size(), 'Only active offer with valid version');
        System.assertEquals(activeOffer.Id, eligible[0].get('id'));
        System.assertNotEquals(null, eligible[0].get('activeVersionId'));
    }

    @IsTest
    static void resolveEligibleOffers_dropsExpiredVersion() {
        Campaign camp = new Campaign(Name = 'Expired Version Camp', Status = 'Planned', IsActive = false);
        insert camp;

        Offer__c offer = new Offer__c(Country_Code__c = 'PL', Offer_Status__c = 'Active');
        insert offer;

        insert new Offer_Version__c(
            Offer_Lookup__c = offer.Id,
            Is_Active__c = true,
            Product_Family_Name__c = 'Mortgage',
            Valid_From__c = Date.today().addDays(-60),
            Valid_To__c = Date.today().addDays(-1)
        );
        insert new Campaign_Offer__c(Campaign__c = camp.Id, Offer__c = offer.Id);

        Test.startTest();
        List<Map<String, String>> eligible = CampaignRuntimeCatalogService.resolveEligibleOffersForCampaign(camp.Id);
        Test.stopTest();

        System.assertEquals(0, eligible.size(), 'Expired version must not resolve at runtime');
    }

    @IsTest
    static void resolveEligibleCopyVariants_usesLivePublishedStatus() {
        Campaign camp = new Campaign(Name = 'Runtime Copy Camp', Status = 'Planned', IsActive = false);
        insert camp;

        CC_Message_Metadata__c published = new CC_Message_Metadata__c(
            Name = 'EMA_PL_RT_1',
            Channel_Type__c = 'Email',
            Status__c = 'Published'
        );
        CC_Message_Metadata__c archived = new CC_Message_Metadata__c(
            Name = 'EMA_PL_RT_2',
            Channel_Type__c = 'Email',
            Status__c = 'Archived'
        );
        insert new List<CC_Message_Metadata__c>{ published, archived };

        insert new List<Campaign_Copy_Variant__c>{
            new Campaign_Copy_Variant__c(
                Campaign__c = camp.Id,
                Message_Variant__c = published.Id,
                Is_Eligible__c = true
            ),
            new Campaign_Copy_Variant__c(
                Campaign__c = camp.Id,
                Message_Variant__c = archived.Id,
                Is_Eligible__c = true
            )
        };

        Test.startTest();
        List<Map<String, String>> eligible = CampaignRuntimeCatalogService.resolveEligibleCopyVariantsForCampaign(camp.Id);
        Test.stopTest();

        System.assertEquals(1, eligible.size());
        System.assertEquals(published.Id, eligible[0].get('id'));
        System.assertEquals('Email', eligible[0].get('channelType'));
    }

    @IsTest
    static void resolveEligibleCopyVariants_includesRepublishedWhenJunctionStillIneligible() {
        Campaign camp = new Campaign(Name = 'Republish Copy Camp', Status = 'Planned', IsActive = false);
        insert camp;

        CC_Message_Metadata__c message = new CC_Message_Metadata__c(
            Name = 'EMA_PL_RT_3',
            Channel_Type__c = 'Email',
            Status__c = 'Published'
        );
        insert message;

        insert new Campaign_Copy_Variant__c(
            Campaign__c = camp.Id,
            Message_Variant__c = message.Id,
            Is_Eligible__c = false
        );

        Test.startTest();
        List<Map<String, String>> eligible = CampaignRuntimeCatalogService.resolveEligibleCopyVariantsForCampaign(camp.Id);
        Test.stopTest();

        System.assertEquals(
            1,
            eligible.size(),
            'Runtime resolver must follow CC_Message_Metadata__c.Status__c, not junction Is_Eligible__c alone'
        );
    }
}
