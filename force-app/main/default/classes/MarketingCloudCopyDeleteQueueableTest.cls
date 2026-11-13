@IsTest
private class MarketingCloudCopyDeleteQueueableTest {
    @IsTest
    static void logsAnEmptyJobWithoutCallingMarketingCloud() {
        Test.startTest();
        System.enqueueJob(new MarketingCloudCopyDeleteQueueable(null));
        Test.stopTest();
        System.assertEquals(
            1,
            [SELECT COUNT() FROM MCE_Delete_Log__c WHERE Status__c = 'Failed']
        );
    }
}
