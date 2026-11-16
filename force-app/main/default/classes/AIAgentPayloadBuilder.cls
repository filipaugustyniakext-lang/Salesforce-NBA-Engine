public class AIAgentPayloadBuilder {

    public class Request {
        @InvocableVariable(label='Context Template' required=true)
        public String contextTemplate;
        
        @InvocableVariable(label='Action Data Template')
        public String actionDataTemplate;

        @InvocableVariable(label='Dynamic Parameters (JSON)' description='Data in JSON format from $ActivationData')
        public String dynamicParamsJson;

        @InvocableVariable public String actionCode;
        @InvocableVariable public String displayType;
        @InvocableVariable public String agentId;
        @InvocableVariable public String provider;
        @InvocableVariable public String welcomeSummary;
        @InvocableVariable public String welcomeTitle;

        @InvocableVariable public String branchId;
        @InvocableVariable public String brandId;
        @InvocableVariable public String customerId;
        @InvocableVariable public String representativeId;
        @InvocableVariable public String tenantId;
        @InvocableVariable public String customerType;
    }

    // Klasa wyjściowa zwracana do Flow
    public class Response {
        @InvocableVariable(label='Is Success')
        public Boolean isSuccess;

        @InvocableVariable(label='Error Message')
        public String errorMessage;

        @InvocableVariable(label='Payload JSON')
        public String payload;
    }

    @InvocableMethod(label='Build Payload JSON for AI Agent' description='Generates valid escaped JSON payload dynamically')
    public static List<Response> buildPayload(List<Request> requests) {
        List<Response> results = new List<Response>();

        for (Request req : requests) {
            Response res = new Response();
            
            try {
                String contextRaw = req.contextTemplate != null ? req.contextTemplate : '{}';
                String actionDataRaw = req.actionDataTemplate != null ? req.actionDataTemplate : '{}';

                if (String.isNotBlank(req.dynamicParamsJson)) {
                    Map<String, Object> paramMap = (Map<String, Object>) JSON.deserializeUntyped(req.dynamicParamsJson);
                    for (String key : paramMap.keySet()) {
                        String placeholder = '{' + key + '}';
                        Object rawVal = paramMap.get(key);
                        
                        String valStr;
                        if (rawVal instanceof List<Object>) {
                            valStr = JSON.serialize(rawVal);
                        } else if (rawVal != null) {
                            valStr = String.valueOf(rawVal);
                        } else {
                            valStr = '';
                        }
                        
                        contextRaw = contextRaw.replace(placeholder, valStr);
                        actionDataRaw = actionDataRaw.replace(placeholder, valStr);
                    }
                }

                contextRaw = contextRaw.replaceAll('\\{[A-Za-z0-9_]+\\}', '');
                actionDataRaw = actionDataRaw.replaceAll('\\{[A-Za-z0-9_]+\\}', '');

                Map<String, Object> eventContext = new Map<String, Object>{
                    'branchId' => req.branchId,
                    'brandId' => req.brandId,
                    'customerId' => req.customerId,
                    'customerType' => req.customerType,
                    'representativeId' => req.representativeId,
                    'tenantId' => req.tenantId
                };

                Map<String, Object> payloadBody = new Map<String, Object>{
                    'actionData' => actionDataRaw,
                    'actions' => new List<String>{ req.actionCode },
                    'adDisplayType' => req.displayType,
                    'agentId' => req.agentId,
                    'context' => contextRaw,
                    'provider' => req.provider,
                    'validFrom' => System.now().formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''),
                    'validTo' => System.now().addDays(3).formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''),
                    'welcomeSummary' => req.welcomeSummary,
                    'welcomeTitle' => req.welcomeTitle
                };

                Map<String, Object> fullStructure = new Map<String, Object>{
                    'eventContext' => eventContext,
                    'payload' => payloadBody
                };

                // Sukces – ustawiamy dane i flagę na true
                res.isSuccess = true;
                res.payload = JSON.serialize(fullStructure);
                res.errorMessage = null;

            } catch (Exception e) {
                // Błąd – przechwytujemy dowolną awarię bez rzucania wyjątku
                res.isSuccess = false;
                res.payload = null;
                res.errorMessage = 'Błąd przetwarzania w Apex: ' + e.getMessage() + ' (Linia: ' + e.getLineNumber() + ')';
            }

            results.add(res);
        }
        return results;
    }
}