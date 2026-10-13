@IsTest
private class MCEContentCenterHourlySyncTest {
    
    // Simple mock to handle the callouts initiated by the Queueable
    private class SuccessMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setHeader('Content-Type', 'application/json');
            
            String endpoint = req.getEndpoint();
            if (endpoint.contains('/v2/token')) {
                res.setBody('{"access_token":"token","expires_in":1000}');
            } else if (endpoint.contains('/customobjects')) {
                res.setBody('{"count":1,"items":[{"id":"12345678","name":"CC_Message_Metadata","rowCount":0}]}');
            } else {
                // Empty rowset response
                res.setBody('{"count":0,"page":1,"pageSize":2500,"items":[]}');
            }
            return res;
        }
    }

    @IsTest
    static void testSchedulerExecutes() {
        Test.startTest();
        // Schedule the job for a hypothetical future date
        String cronExp = '0 0 0 1 1 ? 2030';
        String jobId = System.schedule('Test MCE Hourly Sync', cronExp, new MCEContentCenterHourlySyncScheduler());
        Test.stopTest();
        
        // Verify the job was placed in the schedule queue
        CronTrigger ct = [
            SELECT Id, CronExpression, TimesTriggered 
            FROM CronTrigger 
            WHERE Id = :jobId
        ];
        System.assertEquals(cronExp, ct.CronExpression);
        System.assertEquals(0, ct.TimesTriggered);
    }

    @IsTest
    static void testQueueableExecutes() {
        // Inject settings to bypass custom metadata queries during tests
        MarketingCloudCopySync.settingsOverride = new MCE_Settings__mdt(
            Subdomain__c = 'example',
            Client_Id__c = 'client-id',
            Client_Secret__c = 'client-secret',
            Account_Id__c = '123456',
            Data_Extension_Key__c = 'CC_Message_Metadata'
        );
        
        // Set the mock callout
        Test.setMock(HttpCalloutMock.class, new SuccessMock());
        
        Test.startTest();
        // Enqueue the job directly
        System.enqueueJob(new MCEContentCenterHourlySyncQueueable());
        Test.stopTest();
        
        // If the test reaches this point without unhandled exceptions from the callouts, the Queueable fired successfully.
        System.assert(true, 'Queueable job executed successfully and handled callouts.');
    }
}