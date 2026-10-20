public class MCE_DataExtensionCallout {

    @InvocableMethod(label='Send to MCE via API (Bulk Ready)' callout=true)
    public static void sendData(List<MCE_Request> requests) {
        
        // Wysyłamy całą listę do jednej metody @future.
        // Serializujemy do JSON, bo @future nie przyjmuje list obiektów wewnętrznych.
        if (!requests.isEmpty()) {
            executeCalloutBulk(JSON.serialize(requests));
        }
    }

    @future(callout=true)
    private static void executeCalloutBulk(String requestsJson) {
        List<MCE_Request> requests = (List<MCE_Request>)JSON.deserialize(requestsJson, List<MCE_Request>.class);
        
        // Wyciągamy externalKey z pierwszego rekordu, bo idą do tej samej DE)
        String externalKey = requests[0].externalKey;

        Http http = new Http();
        HttpRequest request = new HttpRequest();
        request.setEndpoint('callout:MCE_ExitDE_UC1/hub/v1/dataevents/key:' + externalKey + '/rowset');
        request.setMethod('POST');
        request.setHeader('Content-Type', 'application/json');

        // Budujemy listę wszystkich wierszy (payload)
        List<Object> payload = new List<Object>();

        for (MCE_Request req : requests) {
            Map<String, Object> row = new Map<String, Object>();
            row.put('keys', new Map<String, Object>{ 'Prospect_Id' => req.prospectId }); 
            
            // Updated to include ExitReason in the payload values
            row.put('values', new Map<String, Object>{ 
                'isExit' => req.isExit,
                'ExitReason' => req.exitReason
            });
            
            payload.add(row);
        }

        request.setBody(JSON.serialize(payload));

        try {
            HttpResponse response = http.send(request);
            System.debug('MCE Bulk Status: ' + response.getStatusCode());
            if (response.getStatusCode() != 201 && response.getStatusCode() != 200) {
                System.debug('MCE Bulk Error: ' + response.getBody());
            }
        } catch (Exception e) {
            System.debug('Critical Error: ' + e.getMessage());
        }
    }

    public class MCE_Request {
        @InvocableVariable(required=true) public String externalKey;
        @InvocableVariable public String prospectId;
        @InvocableVariable public Boolean isExit;
        
        // New variable to capture exitReason__c from Flow/DLO
        @InvocableVariable public String exitReason; 
    }
}