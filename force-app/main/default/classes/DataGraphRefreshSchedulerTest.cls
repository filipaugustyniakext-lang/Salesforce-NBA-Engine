@isTest
private class DataGraphRefreshSchedulerTest {

    /**
     * Mock class to simulate the Data Cloud REST API HTTP 201 Created response
     */
    private class DataGraphRefreshMock implements HttpCalloutMock {
        public HTTPResponse respond(HTTPRequest req) {
            // Verify request details
            System.assertEquals('POST', req.getMethod(), 'Expected HTTP POST method');
            System.assertEquals('application/json', req.getHeader('Content-Type'), 'Expected application/json header');
            System.assert(req.getEndpoint().contains('/services/data/v67.0/ssot/data-graphs/'), 'Endpoint path missing expected API version or resource');
            System.assert(req.getEndpoint().endsWith('/actions/refresh'), 'Endpoint missing /actions/refresh');

            // Construct mock HTTP response
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            res.setBody('{"status": "SUCCESS", "message": "Data Graph refresh job queued."}');
            res.setStatusCode(201);
            return res;
        }
    }

    @isTest
    static void testRefreshDataGraphSuccess() {
        // Register the HTTP mock callout
        Test.setMock(HttpCalloutMock.class, new DataGraphRefreshMock());

        Test.startTest();
        HttpResponse res = DataGraphRefreshScheduler.refreshDataGraph('DG_GCP_CUSTOMER_CONTENT_BANNER');
        Test.stopTest();

        System.assertNotEquals(null, res, 'Response should not be null');
        System.assertEquals(201, res.getStatusCode(), 'Expected 201 Created response status');
    }

    @isTest
    static void testRefreshDataGraphsFromFlowSuccess() {
        Test.setMock(HttpCalloutMock.class, new DataGraphRefreshMock());

        List<String> dataGraphList = new List<String>{
            'DG_GCP_CUSTOMER_CONTENT_BANNER',
            'DG_ORDER_HEADER_SUMMARY'
        };

        Test.startTest();
        DataGraphRefreshScheduler.refreshDataGraphsFromFlow(dataGraphList);
        Test.stopTest();
        
        // Assertions are performed inside the mock respond() method during iteration
    }

    @isTest
    static void testBlankDataGraphDevName() {
        Test.startTest();
        HttpResponse res = DataGraphRefreshScheduler.refreshDataGraph('');
        Test.stopTest();

        System.assertEquals(null, res, 'Expected null response when passing a blank Developer Name');
    }

    @isTest
    static void testNullAndEmptyFlowInputs() {
        Test.startTest();
        DataGraphRefreshScheduler.refreshDataGraphsFromFlow(null);
        DataGraphRefreshScheduler.refreshDataGraphsFromFlow(new List<String>());
        Test.stopTest();

        // Verifies guard clauses handle null/empty inputs without throwing exceptions
    }
}