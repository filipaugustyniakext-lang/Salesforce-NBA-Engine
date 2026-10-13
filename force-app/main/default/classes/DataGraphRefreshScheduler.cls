public class DataGraphRefreshScheduler {

    private static final String API_VERSION = 'v67.0';
    private static final String NAMED_CREDENTIAL = 'NC_DataCloud_Refresh_DataGraph';

    /**
     * Invocable method allowing Scheduled Flows to pass one or more Data Graph Developer Names dynamically.
     */
    @InvocableMethod(
        callout=true
        label='Refresh Data Graph' 
        description='Triggers a Data Graph refresh in Data Cloud for the specified Developer Name(s)'
        category='Data Cloud'
    )
    public static void refreshDataGraphsFromFlow(List<String> dataGraphDevNames) {
        if (dataGraphDevNames == null || dataGraphDevNames.isEmpty()) {
            return;
        }
        for (String devName : dataGraphDevNames) {
            refreshDataGraph(devName);
        }
    }

    /**
     * Public reusable method for direct invocation via Apex Scheduler, Anonymous Apex, or Triggers.
     * @param dataGraphDevName The API/Developer Name of the Data Graph (e.g., 'DG_GCP_CUSTOMER_CONTENT_MANUAL')
     * @return HttpResponse The API response from Data Cloud
     */
    public static HttpResponse refreshDataGraph(String dataGraphDevName) {
        if (String.isBlank(dataGraphDevName)) {
            System.debug(LoggingLevel.ERROR, 'Data Graph Refresh Aborted: Developer Name is blank.');
            return null;
        }

        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:' + NAMED_CREDENTIAL + '/services/data/' + API_VERSION + '/ssot/data-graphs/' + EncodingUtil.urlEncode(dataGraphDevName, 'UTF-8') + '/actions/refresh');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');

        Http http = new Http();
        HttpResponse res;

        try {
            res = http.send(req);
            System.debug('Refresh execution for [' + dataGraphDevName + '] - Status Code: ' + res.getStatusCode());
            System.debug('Response Body: ' + res.getBody());
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Exception executing Data Graph refresh for [' + dataGraphDevName + ']: ' + e.getMessage());
        }

        return res;
    }
}