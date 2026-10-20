@isTest
private class BannerContentAPITest {

    @isTest
    static void testMissingCustomerId_Returns400() {
        RestRequest req = new RestRequest();
        RestResponse res = new RestResponse();

        req.requestURI = '/services/apexrest/v1/banner-content/';
        req.httpMethod = 'GET';

        RestContext.request = req;
        RestContext.response = res;

        Test.startTest();
        BannerContentAPI.getFormattedBannerData();
        Test.stopTest();

        System.assertEquals(400, res.statusCode, 'Oczekiwano statusu 400 dla braku customerId w URL');
        System.assertNotEquals(null, res.responseBody, 'Response body nie powinno być null dla błędu 400');
    }

    @isTest
    static void testEmptyDataGraphList_Returns204() {
        RestRequest req = new RestRequest();
        RestResponse res = new RestResponse();

        req.requestURI = '/services/apexrest/v1/banner-content/CUST_12345';
        req.httpMethod = 'GET';

        RestContext.request = req;
        RestContext.response = res;

        // Pusta lista z Data Graph - testuje powrót statusu 204
        BannerContentAPI.mockDataGraphJsonList = new List<String>();

        Test.startTest();
        BannerContentAPI.getFormattedBannerData();
        Test.stopTest();

        System.assertEquals(204, res.statusCode, 'Oczekiwano statusu 204 No Content dla pustego wyniku');
        System.assertEquals(null, res.responseBody, 'Dla statusu 204 responseBody musi być null');
    }

    @isTest
    static void testSuccess_Returns200() {
        RestRequest req = new RestRequest();
        RestResponse res = new RestResponse();

        req.requestURI = '/services/apexrest/v1/banner-content/CUST_12345';
        req.httpMethod = 'GET';

        RestContext.request = req;
        RestContext.response = res;

        // Poprawne dane z Data Graph
        BannerContentAPI.mockDataGraphJsonList = new List<String>{
            '{"ssot__Id__c":"123","ssot__Title__c":"Promocja"}'
        };

        Test.startTest();
        BannerContentAPI.getFormattedBannerData();
        Test.stopTest();

        System.assertEquals(200, res.statusCode, 'Oczekiwano statusu 200 OK');
        System.assertNotEquals(null, res.responseBody, 'Response body nie może być null dla 200 OK');
    }

    @isTest
    static void testException_Returns500() {
        RestRequest req = new RestRequest();
        RestResponse res = new RestResponse();

        req.requestURI = '/services/apexrest/v1/banner-content/CUST_ERROR';
        req.httpMethod = 'GET';

        RestContext.request = req;
        RestContext.response = res;

        // Wymuszenie wyjątku za pomocą istniejącej flagi testowej
        BannerContentAPI.forceException = true;

        Test.startTest();
        BannerContentAPI.getFormattedBannerData();
        Test.stopTest();

        System.assertEquals(500, res.statusCode, 'Oczekiwano statusu 500 dla przechwyconego wyjątku');
        System.assertNotEquals(null, res.responseBody, 'Response body nie może być null dla statusu 500');
    }
}