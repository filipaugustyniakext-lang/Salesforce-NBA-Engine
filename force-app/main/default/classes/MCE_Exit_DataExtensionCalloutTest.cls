@isTest
private class MCE_Exit_DataExtensionCalloutTest {

    // Klasa Mock symulująca odpowiedź z API Marketing Cloud
    private class MCE_HttpMock implements HttpCalloutMock {
        private Integer statusCode;
        
        public MCE_HttpMock(Integer statusCode) {
            this.statusCode = statusCode;
        }

        public HTTPResponse respond(HTTPRequest req) {
            System.assertEquals('POST', req.getMethod());
            System.assert(req.getEndpoint().contains('callout:MCE_ExitDE_UC1/hub/v1/dataevents/key:TEST_DE_KEY/rowset'));
            System.assertEquals('application/json', req.getHeader('Content-Type'));

            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            res.setStatusCode(this.statusCode);
            res.setBody(this.statusCode == 200 ? '{"status":"success"}' : '{"error":"bad_request"}');
            return res;
        }
    }

    @isTest
    static void testSendDataSuccess() {
        // Ustawienie Mocka z kodem odpowiedzi 200
        Test.setMock(HttpCalloutMock.class, new MCE_HttpMock(200));

        // Przygotowanie danych (jeden rekord z datą, jeden z nullem dla pokrycia obu gałęzi if-a)
        MCE_Exit_DataExtensionCallout.MCE_Request req1 = new MCE_Exit_DataExtensionCallout.MCE_Request();
        req1.externalKey = 'TEST_DE_KEY';
        req1.contactKey = '003xx000004Test1';
        req1.isExit = true;
        req1.exitReason = 'Opt-out';
        req1.entryDate = Datetime.newInstance(2026, 9, 7, 12, 0, 0);

        MCE_Exit_DataExtensionCallout.MCE_Request req2 = new MCE_Exit_DataExtensionCallout.MCE_Request();
        req2.externalKey = 'TEST_DE_KEY';
        req2.contactKey = '003xx000004Test2';
        req2.isExit = false;
        req2.exitReason = null;
        req2.entryDate = null;

        List<MCE_Exit_DataExtensionCallout.MCE_Request> requests = new List<MCE_Exit_DataExtensionCallout.MCE_Request>{ req1, req2 };

        // Test.stopTest() wymusza natychmiastowe wykonanie metody @future
        Test.startTest();
        MCE_Exit_DataExtensionCallout.sendData(requests);
        Test.stopTest();
    }

    @isTest
    static void testSendDataErrorResponse() {
        // Testowanie ścieżki gdy MCE zwraca błąd (np. HTTP 400)
        Test.setMock(HttpCalloutMock.class, new MCE_HttpMock(400));

        MCE_Exit_DataExtensionCallout.MCE_Request req = new MCE_Exit_DataExtensionCallout.MCE_Request();
        req.externalKey = 'TEST_DE_KEY';
        req.contactKey = '003xx000004Test1';
        req.isExit = true;
        req.exitReason = 'Error test';
        req.entryDate = Datetime.now();

        Test.startTest();
        MCE_Exit_DataExtensionCallout.sendData(new List<MCE_Exit_DataExtensionCallout.MCE_Request>{ req });
        Test.stopTest();
    }

    @isTest
    static void testSendDataEmptyList() {
        // Test dla pustej listy (nie wywołuje metody @future)
        Test.startTest();
        MCE_Exit_DataExtensionCallout.sendData(new List<MCE_Exit_DataExtensionCallout.MCE_Request>());
        Test.stopTest();
    }
}