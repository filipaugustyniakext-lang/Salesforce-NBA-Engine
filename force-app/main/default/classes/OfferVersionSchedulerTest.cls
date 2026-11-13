@IsTest
private class OfferVersionSchedulerTest {
    @IsTest
    static void promotesAScheduledVersionAndExpiresAnOldOne() {
        Offer__c offer = new Offer__c(Country_Code__c = 'PL', Offer_Status__c = 'Active', Is_Active__c = true);
        insert offer;
        insert new List<Offer_Version__c>{
            new Offer_Version__c(
                Offer_Lookup__c = offer.Id,
                Version_Status__c = 'Active',
                Schedule_Status__c = 'Scheduled for Deactivation',
                Is_Active__c = true,
                Valid_From__c = Date.today().addDays(-10),
                Valid_To__c = Date.today().addDays(10)
            ),
            new Offer_Version__c(
                Offer_Lookup__c = offer.Id,
                Version_Status__c = 'Scheduled',
                Schedule_Status__c = 'Scheduled for Activation',
                Is_Active__c = false,
                Valid_From__c = Date.today(),
                Valid_To__c = Date.today().addDays(20)
            ),
            new Offer_Version__c(
                Offer_Lookup__c = offer.Id,
                Version_Status__c = 'Active',
                Is_Active__c = true,
                Valid_From__c = Date.today().addDays(-40),
                Valid_To__c = Date.today().addDays(-1)
            )
        };

        Test.startTest();
        new OfferVersionScheduler().execute(null);
        Test.stopTest();

        System.assertEquals(
            1,
            [SELECT COUNT() FROM Offer_Version__c WHERE Offer_Lookup__c = :offer.Id AND Version_Status__c = 'Active' AND Is_Active__c = true]
        );
        System.assertEquals('Active', [SELECT Offer_Status__c FROM Offer__c WHERE Id = :offer.Id].Offer_Status__c);
    }

    @IsTest
    static void deactivatesAnOfferThatHasNoActiveVersion() {
        insert new Offer__c(Country_Code__c = 'PL', Offer_Status__c = 'Active', Is_Active__c = true);
        Test.startTest();
        OfferVersionScheduler.run();
        Test.stopTest();
        System.assertEquals('Inactive', [SELECT Offer_Status__c FROM Offer__c LIMIT 1].Offer_Status__c);
    }
}
