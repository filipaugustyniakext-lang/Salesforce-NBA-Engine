@IsTest
private class MarketingCloudCopySyncTest {
    private static List<String> endpoints = new List<String>();

    private class SuccessMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            endpoints.add(req.getEndpoint());
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setHeader('Content-Type', 'application/json');
            String endpoint = req.getEndpoint();
            if (endpoint.contains('/v2/token')) {
                res.setBody('{"access_token":"token","expires_in":1000}');
            } else if (endpoint.contains('/customobjects')) {
                res.setBody('{"count":1,"items":[{"id":"71647d3c-4ba1-f111-ba7f-f40343e980b0","name":"CC_Message_Metadata","rowCount":2}]}');
            } else if (endpoint.contains('MessageType%20eq%20%27Email%27')) {
                res.setBody('{"count":1,"page":1,"pageSize":2500,"items":[{"keys":{"messagevariantid":"variant-1"},"values":{"messagename":"EMA_PL_CashLoan","messagetype":"Email","lastmodifiedat":"9/15/2026 4:24:44 PM","subject":"Hello","isactive":"true","blockcount":"3","language":"PL","messagepropertiesjson":"blocks"}}]}');
            } else {
                res.setBody('{"count":3,"page":1,"pageSize":2500,"items":[{"keys":{"messagevariantid":"a"},"values":{"messagename":"SMS_PL_SMS_1","messagetype":"SMS","lastmodifiedat":"7/24/2026 1:38:22 PM"}},{"keys":{"messagevariantid":"b"},"values":{"messagename":"APP_PL_Banner","messagetype":"In-App","lastmodifiedat":"9/15/2026 4:24:44 PM"}},{"keys":{},"values":{"messagename":"Missing Key","messagetype":"In-App"}}]}');
            }
            return res;
        }
    }

    private class FailureMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(401);
            res.setBody('{"message":"unauthorized"}');
            return res;
        }
    }

    @IsTest
    static void fetchesDataExtensionRowsInOrder() {
        endpoints.clear();
        MarketingCloudCopySync.settingsOverride = settings();
        Test.setMock(HttpCalloutMock.class, new SuccessMock());

        Test.startTest();
        MarketingCloudCopySync.SyncResult result = MarketingCloudCopySync.syncFromMce('Email');
        Test.stopTest();

        System.assertEquals('71647d3c-4ba1-f111-ba7f-f40343e980b0', result.dataExtensionId);
        System.assertEquals('CC_Message_Metadata', result.dataExtensionName);
        System.assertEquals('Email', result.channel);
        System.assertEquals(1, result.rowCount);
        System.assertEquals(1, result.fetchedCount);
        System.assertEquals(1, result.createdCount);
        System.assertEquals(0, result.updatedCount);
        System.assertEquals('EMA_PL_CashLoan', result.latestMessageName);
        CC_Message_Metadata__c saved = [
            SELECT Name, MessageVariantId__c, Message_Variant_Id__c, Channel_Type__c,
                   Subject__c, Is_Active__c, Block_Count__c, Language__c, LastModifiedAt__c,
                   Message_Properties_JSON__c
            FROM CC_Message_Metadata__c
            WHERE MessageVariantId__c = 'variant-1'
        ];
        System.assertEquals('EMA_PL_CashLoan', saved.Name);
        System.assertEquals('variant-1', saved.Message_Variant_Id__c);
        System.assertEquals('Email', saved.Channel_Type__c);
        System.assertEquals('Hello', saved.Subject__c);
        System.assertEquals(true, saved.Is_Active__c);
        System.assertEquals(3, saved.Block_Count__c);
        System.assertEquals('PL', saved.Language__c);
        System.assertEquals(Datetime.newInstanceGmt(2026, 9, 15, 16, 24, 44), saved.LastModifiedAt__c);
        System.assertEquals('blocks', saved.Message_Properties_JSON__c);
        System.assertEquals(3, endpoints.size());
        System.assert(endpoints[1].contains('$search=CC_Message_Metadata'));
        System.assert(endpoints[2].contains('/customobjectdata/71647d3c-4ba1-f111-ba7f-f40343e980b0/rowset'));
        System.assert(endpoints[2].contains('$filter=MessageType%20eq%20%27Email%27'));
        System.assert(endpoints[2].contains('$orderBy=LastModifiedAt%20DESC'));
    }

    @IsTest
    static void filtersTheActiveChannelType() {
        endpoints.clear();
        MarketingCloudCopySync.settingsOverride = settings();
        Test.setMock(HttpCalloutMock.class, new SuccessMock());

        Test.startTest();
        MarketingCloudCopySync.syncFromMce('In-App');
        Test.stopTest();

        System.assert(endpoints[2].contains('$filter=MessageType%20eq%20%27In-App%27'));
        System.assertEquals(2, [SELECT COUNT() FROM CC_Message_Metadata__c]);
        System.assertEquals(0, [SELECT COUNT() FROM CC_Message_Metadata__c WHERE Name = 'Missing Key']);
    }

    @IsTest
    static void requiresAChannel() {
        MarketingCloudCopySync.settingsOverride = settings();
        try {
            MarketingCloudCopySync.syncFromMce(' ');
            System.assert(false, 'Expected a missing channel to be rejected.');
        } catch (AuraHandledException ex) {
            System.assert(ex.getMessage().contains('channel'));
        }
    }

    @IsTest
    static void reportsAFailedMarketingCloudCall() {
        MarketingCloudCopySync.settingsOverride = settings();
        Test.setMock(HttpCalloutMock.class, new FailureMock());

        try {
            MarketingCloudCopySync.syncFromMce('SMS');
            System.assert(false, 'Expected the callout failure to be reported.');
        } catch (AuraHandledException ex) {
            System.assert(ex.getMessage().contains('401'));
        }
    }

    private static MCE_Settings__mdt settings() {
        return new MCE_Settings__mdt(
            Subdomain__c = 'example',
            Client_Id__c = 'client-id',
            Client_Secret__c = 'client-secret',
            Account_Id__c = '536010187',
            Data_Extension_Key__c = 'CC_Message_Metadata'
        );
    }
}
