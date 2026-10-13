public class DataTransformStatusChecker {

    // Define the inputs expected from the Flow
    public class FlowInput {
        @InvocableVariable(label='Data Transform ID' required=true description='The ID of the Data Cloud Batch Data Transform')
        public String dataTransformId;

        @InvocableVariable(label='Named Credential Name' required=true description='API Name of the Named Credential pointing to the local org (e.g., Local_Org_Creds)')
        public String namedCredentialName;
    }

    // Define the outputs to return to the Flow
    public class FlowOutput {
        @InvocableVariable(label='Is Running?' description='Returns True if the job is InProgress, Queued, or Starting')
        public Boolean isRunning;

        @InvocableVariable(label='Latest Status' description='The exact status string returned by the API')
        public String latestStatus;
    }

    @InvocableMethod(label='Check Data Transform Status' description='Checks if a specific Data Cloud Data Transform is currently running.')
    public static List<FlowOutput> checkStatus(List<FlowInput> requests) {
        List<FlowOutput> results = new List<FlowOutput>();

        for (FlowInput req : requests) {
            results.add(getTransformStatus(req.dataTransformId, req.namedCredentialName));
        }
        return results;
    }

    private static FlowOutput getTransformStatus(String transformId, String ncName) {
        FlowOutput output = new FlowOutput();
        output.isRunning = false;
        output.latestStatus = 'Unknown';

        HttpRequest req = new HttpRequest();
        // Use the Named Credential to call the local Salesforce org's Connect REST API
        req.setEndpoint('callout:' + ncName + '/services/data/v61.0/connect/data-cloud/data-transforms/' + transformId + '/run-history');
        req.setMethod('GET');

        Http http = new Http();
        try {
            HttpResponse res = http.send(req);
            
            if (res.getStatusCode() == 200 || res.getStatusCode() == 201) {
                // Parse the JSON response
                Map<String, Object> responseBody = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
                
                // The history records are typically held in an array (adjust 'items' if the API payload differs slightly in your version)
                List<Object> histories = new List<Object>();
                if(responseBody.containsKey('items')) {
                     histories = (List<Object>) responseBody.get('items');
                } else if (responseBody.containsKey('runHistories')) {
                     histories = (List<Object>) responseBody.get('runHistories');
                }

                if (histories != null && !histories.isEmpty()) {
                    // Grab the most recent run (usually the first item in the array)
                    Map<String, Object> latestRun = (Map<String, Object>) histories[0];
                    String status = (String) latestRun.get('status');
                    
                    output.latestStatus = status;

                    // Evaluate if the status means the job is currently occupying resources
                    if (status == 'InProgress' || status == 'Running' || status == 'Queued' || status == 'Starting') {
                        output.isRunning = true;
                    }
                } else {
                    output.latestStatus = 'NoRunsFound';
                }
            } else {
                output.latestStatus = 'API_Error: ' + res.getStatusCode() + ' ' + res.getStatus();
            }
        } catch (Exception e) {
            output.latestStatus = 'Exception: ' + e.getMessage();
        }

        return output;
    }
}