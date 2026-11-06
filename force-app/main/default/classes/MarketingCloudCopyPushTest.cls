@IsTest
private class MarketingCloudCopyPushTest {
    private static List<String> calls = new List<String>();

    private class PushMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            calls.add(req.getMethod() + ' ' + req.getEndpoint());
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            res.setStatusCode(200);
            String endpoint = req.getEndpoint();
            if (req.getMethod() == 'DELETE') {
                res.setStatusCode(204);
                res.setBody('');
            } else if (endpoint.contains('/async/dataextensions/')) {
                res.setStatusCode(202);
                res.setBody('{"requestId":"req-1"}');
            } else if (endpoint.contains('$search=CC_Message_Blocks_All')) {
                res.setBody('{"count":1,"items":[{"id":"blocks-de-id","name":"CC_Message_Blocks_All"}]}');
            } else if (endpoint.contains('/customobjects')) {
                res.setBody('{"count":1,"items":[{"id":"meta-de-id","name":"CC_Message_Metadata"}]}');
            } else if (endpoint.contains('blocks-de-id')) {
                res.setBody('{"count":1,"page":1,"pageSize":2500,"items":[{"keys":{"messagevariantid":"push-variant-1","contentblockorder":"1"},"values":{"messagename":"EMA_PL_Push","messagetype":"Email","blocktype":"Content","contentjson":"{}","updatedat":"9/15/2026 4:24:44 PM"}}]}');
            } else {
                res.setBody('{"count":1,"page":1,"pageSize":2500,"items":[{"keys":{"messagevariantid":"push-variant-1"},"values":{"messagename":"EMA_PL_Push","messagetype":"Email","messagevariant":"2","lastmodifiedat":"9/15/2026 4:24:44 PM"}}]}');
            }
            return res;
        }
    }

    @IsTest
    static void pushesMetadataAndBlocksThroughTheNamedCredential() {
        CC_Message_Metadata__c variant = new CC_Message_Metadata__c(
            Name = 'EMA_PL_Push_1',
            MessageName__c = 'EMA_PL_Push',
            MessageVariantId__c = 'push-variant-1',
            MessageVariant__c = 1,
            Version__c = 1,
            Subject__c = 'Hello'
        );
        insert variant;
        CC_Message_Blocks_All__c block = new CC_Message_Blocks_All__c(
            Name = 'push-variant-1-1',
            MessageVariantId__c = 'push-variant-1',
            ContentBlockOrder__c = 1,
            MessageName__c = 'EMA_PL_Push',
            BlockType__c = 'Content'
        );
        insert block;
        calls.clear();
        Test.setMock(HttpCalloutMock.class, new PushMock());

        Test.startTest();
        MarketingCloudCopySync.pushMetadataToMceFuture(JSON.serialize(new List<Id>{ variant.Id }));
        MarketingCloudCopySync.pushBlocksToMceFuture(JSON.serialize(new Map<String, Object>{
            'ids' => new List<Id>{ block.Id },
            'kind' => 'Update',
            'source' => MceDeleteLogService.SOURCE_COPY_CENTER
        }));
        Test.stopTest();

        String metadataPush = 'PUT ' + MarketingCloudApi.REST + '/data/v1/async/dataextensions/key:CC_Message_Metadata/rows';
        String blockPush = 'PUT ' + MarketingCloudApi.REST + '/data/v1/async/dataextensions/key:CC_Message_Blocks_All/rows';
        System.assert(calls.contains(metadataPush), String.join(calls, '\n'));
        System.assert(calls.contains(blockPush), String.join(calls, '\n'));
    }

    @IsTest
    static void deletesMetadataRowsThroughTheNamedCredential() {
        calls.clear();
        Test.setMock(HttpCalloutMock.class, new PushMock());

        Test.startTest();
        MarketingCloudCopySync.deleteVariantsFromMCE(new List<String>{ 'push-variant-1' });
        MarketingCloudCopySync.deleteVariantsFromMCEAsync(new List<String>{ 'push-variant-2' });
        Test.stopTest();

        String rowPath = 'DELETE ' + MarketingCloudApi.REST + '/data/v1/customobjectdata/key/CC_Message_Metadata/row/MessageVariantId:';
        System.assert(calls.contains(rowPath + 'push-variant-1'), String.join(calls, '\n'));
        System.assert(calls.contains(rowPath + 'push-variant-2'), String.join(calls, '\n'));
    }

    @IsTest
    static void scheduledSyncPullsMetadataAndBlocks() {
        calls.clear();
        Test.setMock(HttpCalloutMock.class, new PushMock());

        Test.startTest();
        MarketingCloudCopySync.SyncResult result = MarketingCloudCopySync.syncAllWithMCE(null);
        MarketingCloudCopySync.syncBlocksForVariantsAsync(new List<String>{ 'push-variant-1' });
        Test.stopTest();

        System.assertEquals(1, result.fetchedCount);
        CC_Message_Metadata__c saved = [
            SELECT Name FROM CC_Message_Metadata__c WHERE MessageVariantId__c = 'push-variant-1'
        ];
        System.assertEquals('EMA_PL_Push_2', saved.Name);
        System.assertEquals(1, [SELECT COUNT() FROM CC_Message_Blocks_All__c WHERE MessageVariantId__c = 'push-variant-1']);
        for (String call : calls) {
            System.assert(call.contains(MarketingCloudApi.REST + '/'), call);
        }
    }
}
