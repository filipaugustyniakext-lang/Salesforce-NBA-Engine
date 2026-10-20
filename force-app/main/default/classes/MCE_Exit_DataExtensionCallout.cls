public class MCE_Exit_DataExtensionCallout {

    @InvocableMethod(label='Send to MCE via API (Bulk Ready)' callout=true)
    public static void sendData(List<MCE_Request> requests) {
        if (!requests.isEmpty()) {
            executeCalloutBulk(JSON.serialize(requests));
        }
    }

    @future(callout=true)
    private static void executeCalloutBulk(String requestsJson) {
        List<MCE_Request> requests = (List<MCE_Request>)JSON.deserialize(requestsJson, List<MCE_Request>.class);
        
        String externalKey = requests[0].externalKey;

        Http http = new Http();
        HttpRequest request = new HttpRequest();
        request.setEndpoint('callout:MCE_ExitDE_UC1/hub/v1/dataevents/key:' + externalKey + '/rowset');
        request.setMethod('POST');
        request.setHeader('Content-Type', 'application/json');

        List<Object> payload = new List<Object>();

        for (MCE_Request req : requests) {
            Map<String, Object> row = new Map<String, Object>();
            
            // Primary Key w Data Extension
            row.put('keys', new Map<String, Object>{ 
                'ContactKey' => req.contactKey 
            }); 
            
            // Pozostałe wartości pól
            Map<String, Object> values = new Map<String, Object>{ 
                'IsExit' => req.isExit,
                'ExitReason' => req.exitReason
            };

            // Formatowanie daty do formatu akceptowanego przez MCE (YYYY-MM-DD HH:mm:ss)
            if (req.entryDate != null) {
                values.put('EntryDate', req.entryDate.format('yyyy-MM-dd HH:mm:ss'));
            } else {
                values.put('EntryDate', null);
            }

            row.put('values', values);
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
        @InvocableVariable(required=true) public String contactKey;
        @InvocableVariable public Boolean isExit;
        @InvocableVariable public String exitReason;
        @InvocableVariable public Datetime entryDate;
    }
}