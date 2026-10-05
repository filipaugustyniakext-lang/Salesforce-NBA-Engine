@IsTest
private class MarketingCloudCopySyncUpdateTest {
    @TestSetup
    static void seedExistingVariant() {
        insert new CC_Message_Metadata__c(
            Name = 'Old name',
            MessageVariantId__c = 'variant-1',
            Subject__c = 'Old subject',
            Channel_Type__c = 'Email',
            Status__c = 'Published'
        );
    }

    private class EmailMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setHeader('Content-Type', 'application/json');
            String endpoint = req.getEndpoint();
            if (endpoint.contains('/v2/token')) {
                res.setBody('{"access_token":"token","expires_in":1000}');
            } else if (endpoint.contains('/customobjects')) {
                res.setBody('{"count":1,"items":[{"id":"71647d3c-4ba1-f111-ba7f-f40343e980b0","name":"CC_Message_Metadata","rowCount":1}]}');
            } else {
                res.setBody('{"count":1,"items":[{"keys":{"messagevariantid":"variant-1"},"values":{"messagename":"EMA_PL_CashLoan","messagetype":"Email","subject":"Hello","lastmodifiedat":"9/15/2026 4:24:44 PM"}}]}');
            }
            return res;
        }
    }

    @IsTest
    static void updatesTheExistingVariant() {
        MarketingCloudCopySync.settingsOverride = new MCE_Settings__mdt(
            Subdomain__c = 'example',
            Client_Id__c = 'client-id',
            Client_Secret__c = 'client-secret',
            Account_Id__c = '536010187',
            Data_Extension_Key__c = 'CC_Message_Metadata'
        );
        Test.setMock(HttpCalloutMock.class, new EmailMock());

        Test.startTest();
        MarketingCloudCopySync.SyncResult result = MarketingCloudCopySync.syncFromMce('Email');
        Test.stopTest();

        System.assertEquals(0, result.createdCount);
        System.assertEquals(1, result.updatedCount);
        System.assertEquals(0, result.failedCount);
        System.assertEquals(1, [SELECT COUNT() FROM CC_Message_Metadata__c]);
        CC_Message_Metadata__c saved = [
            SELECT Name, Subject__c, Message_Variant_Id__c, Status__c
            FROM CC_Message_Metadata__c
            WHERE MessageVariantId__c = 'variant-1'
        ];
        System.assertEquals('EMA_PL_CashLoan', saved.Name);
        System.assertEquals('Hello', saved.Subject__c);
        System.assertEquals('variant-1', saved.Message_Variant_Id__c);
        System.assertEquals('Published', saved.Status__c);
    }
}
