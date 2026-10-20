@IsTest
private class MarketingCloudCopyDeleteTest {
    private class DeleteMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', req.getEndpoint().contains('Service.asmx') ? 'text/xml' : 'application/json');
            String endpoint = req.getEndpoint();
            if (endpoint.contains('/v2/token')) {
                res.setStatusCode(200);
                res.setBody('{"access_token":"test-token","expires_in":1000}');
            } else if (endpoint.contains('/customobjects')) {
                res.setStatusCode(200);
                if (endpoint.contains('CC_Message_Blocks_All')) {
                    res.setBody('{"count":1,"items":[{"id":"blocks-de-id","name":"CC_Message_Blocks_All"}]}');
                } else {
                    res.setBody('{"count":1,"items":[{"id":"meta-de-id","name":"CC_Message_Metadata"}]}');
                }
            } else if (endpoint.contains('/rowset') && endpoint.contains('blocks-de-id')) {
                res.setStatusCode(200);
                res.setBody('{"count":1,"page":1,"pageSize":2500,"items":[{"keys":{"messagevariantid":"variant-del-1","contentblockorder":"1"},"values":{"blocktype":"Content"}}]}');
            } else if (req.getMethod() == 'DELETE' && endpoint.contains('customobjectdata/key')) {
                res.setStatusCode(204);
                res.setBody('');
            } else if (endpoint.contains('Service.asmx')) {
                res.setStatusCode(200);
                String soapBody = req.getBody();
                System.assert(soapBody.contains('DeleteRequest'), 'Expected SOAP Delete');
                System.assert(soapBody.contains('DataExtensionObject'), 'Expected DE object delete');
                System.assert(soapBody.contains('variant-del-1'), 'Expected variant id in SOAP body');
                System.assert(
                    soapBody.contains('http://schemas.xmlsoap.org/ws/2004/08/addressing'),
                    'Expected SFMC WS-Addressing namespace'
                );
                System.assert(soapBody.contains('<fueloauth xmlns="http://exacttarget.com">'), 'Expected header fueloauth');
                System.assert(!soapBody.contains(':Security'), 'fueloauth should not be wrapped in WS-Security');
                res.setBody(
                    '<?xml version="1.0" encoding="utf-8"?>'
                    + '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">'
                    + '<soap:Body><DeleteResponse xmlns="http://exacttarget.com/wsdl/partnerAPI">'
                    + '<OverallStatus>OK</OverallStatus>'
                    + '</DeleteResponse></soap:Body></soap:Envelope>'
                );
            } else {
                res.setStatusCode(404);
                res.setBody('{}');
            }
            return res;
        }
    }

    private static MCE_Settings__mdt settings() {
        return new MCE_Settings__mdt(
            Client_Id__c = 'client',
            Client_Secret__c = 'secret',
            Subdomain__c = 'mc-example',
            Account_Id__c = '536010187',
            Data_Extension_Key__c = 'CC_Message_Metadata'
        );
    }

    @IsTest
    static void deleteVariantsFromMce_issuesSoapDeleteForMetadataAndBlocks() {
        MarketingCloudCopyDelete.settingsOverride = settings();
        Test.setMock(HttpCalloutMock.class, new DeleteMock());

        Test.startTest();
        MarketingCloudCopyDelete.deleteVariantsFromMce(new List<String>{ 'variant-del-1' });
        Test.stopTest();

        List<MCE_Delete_Log__c> logs = [
            SELECT Status__c, Source__c, Summary__c, Message_Variant_Ids__c
            FROM MCE_Delete_Log__c
            WHERE Source__c = :MceDeleteLogService.SOURCE_SOAP_QUEUEABLE
        ];
        System.assertEquals(1, logs.size(), 'Expected one SOAP delete log row');
        System.assertEquals('Success', logs[0].Status__c);
        System.assert(logs[0].Summary__c.contains('1 metadata variant'), logs[0].Summary__c);
        System.assertEquals('variant-del-1', logs[0].Message_Variant_Ids__c);
    }

    @IsTest
    static void deleteMessageVariants_enqueuesMceDelete() {
        CC_Message_Metadata__c variant = new CC_Message_Metadata__c(
            Name = 'EMA_PL_MceDel_1',
            Channel_Type__c = 'Email',
            MessageName__c = 'EMA_PL_MceDel',
            MessageVariantId__c = 'variant-del-1',
            MessageVariant__c = 1,
            Version__c = 1
        );
        insert variant;

        MarketingCloudCopyDelete.settingsOverride = settings();
        Test.setMock(HttpCalloutMock.class, new DeleteMock());

        Test.startTest();
        CopyCockpitController.deleteMessageVariants(new List<Id>{ variant.Id });
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM CC_Message_Metadata__c WHERE Id = :variant.Id]);
    }
}
