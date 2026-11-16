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

        // 1. Pobranie BannerAudienceUniqueId ze ścieżki URL: /v1/banner-content/{BannerAudienceUniqueId}
        String bannerAudienceUniqueId = req.requestURI.substring(req.requestURI.lastIndexOf('/') + 1).trim();

        // Fallback A: parametr w query ?bannerAudienceUniqueId=...
        if (String.isBlank(bannerAudienceUniqueId) || bannerAudienceUniqueId.equalsIgnoreCase('banner-content')) {
            bannerAudienceUniqueId = req.params.get('bannerAudienceUniqueId');
        }

        // Fallback B: jeśli system zewnętrzny nadal wysyła osobno ?customerId=...&relationId=...
        if (String.isBlank(bannerAudienceUniqueId)) {
            String custId = req.params.get('customerId');
            String relId = req.params.get('relationId');
            if (String.isNotBlank(custId) && String.isNotBlank(relId)) {
                bannerAudienceUniqueId = custId.trim() + '_' + relId.trim();
            }
        }

        // 2. Walidacja klucza
        if (String.isBlank(bannerAudienceUniqueId) || bannerAudienceUniqueId.equalsIgnoreCase('banner-content')) {
            res.statusCode = 400;
            res.responseBody = Blob.valueOf('{"error": "Missing BannerAudienceUniqueId parameter in URL path or query params."}');
            return;
        }

        try {
            if (Test.isRunningTest() && forceException) {
                throw new IllegalArgumentException('Simulated API exception');
            }

            // 3. Bezpośrednie odpytanie Data Graph kluczem BannerAudienceUniqueId
            List<String> rawDataGraphJsonList = fetchDataGraphNativeList(bannerAudienceUniqueId);

            // Brak danych dla danego klucza – standardowy kod 204 No Content
            if (rawDataGraphJsonList.isEmpty()) {
                res.statusCode = 204;
                return;
            }

            // 4. Przekazanie danych do transformera
            String transformedJson = BannerDataGraphTransformer.transformDataGraphList(rawDataGraphJsonList);

            res.statusCode = 200;
            res.responseBody = Blob.valueOf(transformedJson);

        } catch (Exception e) {
            String errorMsg = e.getMessage();
            
            // Obsługa sytuacji, gdy ConnectApi rzuca wyjątek braku dopasowania w Data Cloud
            if (String.isNotBlank(errorMsg) && (errorMsg.contains('404') || errorMsg.contains('NOT_FOUND') || errorMsg.contains('No Matching DataGraphs found'))) {
                res.statusCode = 204;
                return;
            }

            res.statusCode = 500;
            res.responseBody = Blob.valueOf('{"error": "API execution failed", "details": ' + JSON.serialize(errorMsg) + '}');
        }
    }

    @TestVisible
    private static List<String> fetchDataGraphNativeList(String bannerAudienceUniqueId) {
        List<String> blobs = new List<String>();

        if (Test.isRunningTest()) {
            return mockDataGraphJsonList;
        }

        // Kluczowe wywołanie: odpytanie po BannerAudienceUniqueId
        ConnectApi.CdpQueryOutput queryResult = ConnectApi.CdpQuery.getDataGraphData(DATA_GRAPH_DEV_NAME, bannerAudienceUniqueId);

        if (queryResult != null && queryResult.data != null && !queryResult.data.isEmpty()) {
            for (Object rowObj : queryResult.data) {
                blobs.add(JSON.serialize(rowObj));
            }
        }

        return blobs;
    }
}