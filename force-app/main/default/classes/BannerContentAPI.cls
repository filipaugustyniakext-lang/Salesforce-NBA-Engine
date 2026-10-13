@RestResource(urlMapping='/v1/banner-content/*')
global with sharing class BannerContentAPI {

    private static final String DATA_GRAPH_DEV_NAME = 'DG_GCP_CUSTOMER_CONTENT_BANNER';

    // Zmienne do testów jednostkowych Apex
    @TestVisible private static List<String> mockDataGraphJsonList = new List<String>();
    @TestVisible private static Boolean forceException = false;

    @HttpGet
    global static void getFormattedBannerData() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;

        res.addHeader('Content-Type', 'application/json');

        String customerId = req.requestURI.substring(req.requestURI.lastIndexOf('/') + 1);

        if (String.isBlank(customerId) || customerId.equalsIgnoreCase('banner-content')) {
            res.statusCode = 400;
            res.responseBody = Blob.valueOf('{"error": "Missing customerId parameter in URL path."}');
            return;
        }

        try {
            if (Test.isRunningTest() && forceException) {
                throw new IllegalArgumentException('Simulated API exception');
            }

            // 1. Pobierz WSZYSTKIE wiersze z Data Graph dla danego customerId
            List<String> rawDataGraphJsonList = fetchDataGraphNativeList(customerId);

            // Jeśli wynik jest pusty - zwracamy 204 No Content
            if (rawDataGraphJsonList.isEmpty()) {
                res.statusCode = 204;
                // Standard HTTP 204 wymaga pustego responseBody
                return;
            }

            // 2. Przekaż całą listę rekordów do przetworzenia w transformerze
            String transformedJson = BannerDataGraphTransformer.transformDataGraphList(rawDataGraphJsonList);

            res.statusCode = 200;
            res.responseBody = Blob.valueOf(transformedJson);

        } catch (Exception e) {
            String errorMsg = e.getMessage();
            
            // Wyłap błąd rzucany przez ConnectApi dla nieistniejącego klienta i zwróć 204 No Content
            if (String.isNotBlank(errorMsg) && (errorMsg.contains('404') || errorMsg.contains('NOT_FOUND') || errorMsg.contains('No Matching DataGraphs found'))) {
                res.statusCode = 204;
                return;
            }

            res.statusCode = 500;
            res.responseBody = Blob.valueOf('{"error": "API execution failed", "details": ' + JSON.serialize(errorMsg) + '}');
        }
    }

    @TestVisible
    private static List<String> fetchDataGraphNativeList(String customerId) {
        List<String> blobs = new List<String>();

        if (Test.isRunningTest()) {
            return mockDataGraphJsonList;
        }

        // Strzał do Data Cloud ConnectApi
        ConnectApi.CdpQueryOutput queryResult = ConnectApi.CdpQuery.getDataGraphData(DATA_GRAPH_DEV_NAME, customerId);

        if (queryResult != null && queryResult.data != null && !queryResult.data.isEmpty()) {
            for (Object rowObj : queryResult.data) {
                blobs.add(JSON.serialize(rowObj));
            }
        }

        return blobs;
    }
}