public with sharing class FlowInit_TriggerDataSourceObjectRefresh {
    
    @AuraEnabled
    public static void refreshStreamViaFlow(String dsoId) {
        try {
            // Map the parameter exactly as it is named in your Flow variable
            Map<String, Object> inputs = new Map<String, Object>();
            inputs.put('DataStreamObjectId', dsoId); // Updated to match your Flow
            
            // Invoke the flow dynamically (replace 'FL_Trigger_DataStreamObject_Refresh' with your Flow's exact DSO ID)
            Flow.Interview refreshFlow = Flow.Interview.createInterview('FL_Trigger_DataStreamObject_Refresh', inputs);
            refreshFlow.start();
            
        } catch (Exception e) {
            throw new AuraHandledException('Failed to trigger refresh flow: ' + e.getMessage());
        }
    }
}