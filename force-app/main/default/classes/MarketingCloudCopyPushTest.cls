@IsTest
private class MarketingCloudCopyPushTest {
    private class PushMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setHeader('Content-Type', 'application/json');
            if (req.getEndpoint().contains('/v2/token')) {
                res.setBody('{"access_token":"token","expires_in":1000}');
            } else if (req.getEndpoint().contains('/async/dataextensions/key:CC_Message_Metadata/rows')) {
                System.assertEquals('PUT', req.getMethod());
                Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(req.getBody());
                List<Object> items = (List<Object>) body.get('items');
                System.assertEquals(1, items.size());
                Map<String, Object> item = (Map<String, Object>) items[0];
                System.assertEquals('variant-push-1', item.get('MessageVariantId'));
                System.assertEquals(UserInfo.getName(), item.get('LastModifiedBy'));
                res.setBody('{"requestId":"req-1"}');
            } else {
                res.setBody('{}');
            }
            return res;
        }
    }

    @IsTest
    static void saveChange_schedulesMetadataPushWithAuditFields() {
        CC_Message_Metadata__c row = new CC_Message_Metadata__c(
            Name = 'EMA_PL_Push_1',
            Channel_Type__c = 'Email',
            MessageVariantId__c = 'variant-push-1',
            Status__c = 'Draft'
        );
        insert row;

        MarketingCloudCopySync.settingsOverride = new MCE_Settings__mdt(
            Subdomain__c = 'example',
            Client_Id__c = 'client-id',
            Client_Secret__c = 'client-secret',
            Account_Id__c = '536010187',
            Data_Extension_Key__c = 'CC_Message_Metadata'
        );
        Test.setMock(HttpCalloutMock.class, new PushMock());

        Test.startTest();
        CopyCockpitController.saveVariantDisplayWeight(row.Id, 55);
        Test.stopTest();
    }
}
