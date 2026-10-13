public class AIAgentDeleteCallout {

    public class Request {
        @InvocableVariable(label='Full CREATE Payload (JSON)' required=true)
        public String fullJsonPayload;
    }

    public class Response {
        @InvocableVariable(label='Is Success')
        public Boolean isSuccess;

        @InvocableVariable(label='Error Message')
        public String errorMessage;
    }

    @InvocableMethod(label='Delete AI Agent Conversation' description='Filters payload and sends synchronous delete request to AI Agent API')
    public static List<Response> deleteConversation(List<Request> requests) {
        List<Response> responses = new List<Response>();

        for (Request req : requests) {
            Response res = new Response();
            res.isSuccess = false;

            if (String.isBlank(req.fullJsonPayload)) {
                res.errorMessage = 'Payload wejściowy jest pusty.';
                responses.add(res);
                continue;
            }

            // 1. Wyciągnięcie i przetworzenie właściwych pól do payloadu Delete
            String cleanDeletePayload = buildDeletePayload(req.fullJsonPayload);
            
            if (String.isBlank(cleanDeletePayload)) {
                res.errorMessage = 'Błąd parsowania JSON wejściowego podczas budowania payloadu Delete.';
                responses.add(res);
                continue;
            }

            // 2. Synchroniczne wywołanie API
            try {
                Http http = new Http();
                HttpRequest request = new HttpRequest();
                
                // Zastąp AI_Agent_Named_Credential właściwą nazwą Named Credential
                request.setEndpoint('callout:AI_Agent_Named_Credential/delete'); 
                request.setMethod('POST');
                request.setHeader('Content-Type', 'application/json');
                request.setBody(cleanDeletePayload);

                HttpResponse response = http.send(request);

                // Sprawdzenie statusu odpowiedzi (200-299 oznacza sukces)
                if (response.getStatusCode() >= 200 && response.getStatusCode() < 300) {
                    res.isSuccess = true;
                    res.errorMessage = null;
                } else {
                    res.isSuccess = false;
                    res.errorMessage = 'Błąd API AI Agent (Status: ' + response.getStatusCode() + '): ' + response.getBody();
                }

            } catch (Exception e) {
                res.isSuccess = false;
                res.errorMessage = 'Wyjątek podczas wywołania API: ' + e.getMessage() + ' (Linia: ' + e.getLineNumber() + ')';
            }

            responses.add(res);
        }

        return responses;
    }

    private static String buildDeletePayload(String rawJson) {
        try {
            Map<String, Object> fullMap = (Map<String, Object>) JSON.deserializeUntyped(rawJson);
            
            Map<String, Object> origPayload = fullMap.containsKey('payload') ? (Map<String, Object>) fullMap.get('payload') : new Map<String, Object>();
            Map<String, Object> origContext = fullMap.containsKey('eventContext') ? (Map<String, Object>) fullMap.get('eventContext') : new Map<String, Object>();

            Map<String, Object> filteredPayload = new Map<String, Object>{
                'provider' => origPayload.get('provider'),
                'agentId'  => origPayload.get('agentId')
            };

            Map<String, Object> filteredEventContext = new Map<String, Object>{
                'tenantId'         => origContext.get('tenantId'),
                'representativeId' => origContext.get('representativeId'),
                'customerType'     => origContext.containsKey('customerType') ? origContext.get('customerType') : 'RETAIL',
                'customerId'       => origContext.get('customerId'),
                'brandId'          => origContext.get('brandId'),
                'branchId'         => origContext.get('branchId')
            };

            Map<String, Object> finalStructure = new Map<String, Object>{
                'payload'      => filteredPayload,
                'eventContext' => filteredEventContext
            };

            return JSON.serialize(finalStructure);

        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Błąd parsowania JSON do payloadu Delete: ' + e.getMessage());
            return null;
        }
    }
}