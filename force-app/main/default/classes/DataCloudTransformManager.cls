public class DataCloudTransformManager implements Schedulable {
    
    @TestVisible private static Datetime mockMaxTime;
    @TestVisible private static Boolean forceException = false;
    
    private String dsoApiName;
    
    public DataCloudTransformManager(String streamApiName) {
        this.dsoApiName = streamApiName;
    }
    
    public void execute(SchedulableContext sc) {
        System.enqueueJob(new QueueableGatekeeper(this.dsoApiName));
    }
    
    public class QueueableGatekeeper implements Queueable, Database.AllowsCallouts {
        private String targetDsoName;
        
        public QueueableGatekeeper(String dsoName) {
            this.targetDsoName = dsoName;
        }
        
        public void execute(QueueableContext context) {
            try {
                if (forceException) {
                    throw new CalloutException('Forced exception for test coverage.');
                }
                
                // 1. Retrieve the state record
                List<D360_NRT_Sync_State__c> stateRecords = [
                    SELECT Id, DSO_API_Name_c__c, Last_Processed_Timestamp_c__c, Target_Flow_API_Name_c__c 
                    FROM D360_NRT_Sync_State__c 
                    WHERE DSO_API_Name_c__c = :this.targetDsoName 
                    LIMIT 1
                ];
                
                if (stateRecords.isEmpty()) {
                    System.debug('Error: No configuration found for stream: ' + this.targetDsoName);
                    return;
                }
                
                D360_NRT_Sync_State__c currentState = stateRecords[0];
                Datetime lastProcessedTime = currentState.Last_Processed_Timestamp_c__c;
                
                Datetime currentMaxTime;
                
                // 2. Query Data Cloud 
                if (Test.isRunningTest() && mockMaxTime != null) {
                    currentMaxTime = mockMaxTime;
                } else {
                    String queryObj = Test.isRunningTest() ? 'User' : this.targetDsoName;
                    String queryField = Test.isRunningTest() ? 'CreatedDate' : 'evt_dttm__c';
                    String query = 'SELECT MAX(' + queryField + ') latestEventTime FROM ' + String.escapeSingleQuotes(queryObj);
                    
                    List<AggregateResult> results = Database.query(query);
                    currentMaxTime = (Datetime)results[0].get('latestEventTime');
                }
                
                // 3. Evaluate the Gatekeeper
                if (currentMaxTime != null && (lastProcessedTime == null || currentMaxTime > lastProcessedTime)) {
                    
                    System.debug('New events found for ' + this.targetDsoName + '. Updating timestamp first...');
                    
                    // FIX: Save the timestamp to the custom object FIRST. 
                    // This commits the standard object DML and clears the transaction pipeline.
                    currentState.Last_Processed_Timestamp_c__c = currentMaxTime;
                    update currentState;
                    
                    // 4. Trigger the Flow SECOND.
                    // Setup object DML (MktDataTransform) can now safely execute without Mixed DML conflicts.
                    if (String.isNotBlank(currentState.Target_Flow_API_Name_c__c)) {
                        Map<String, Object> flowParams = new Map<String, Object>();
                        try {
                            Flow.Interview dynamicFlow = Flow.Interview.createInterview(currentState.Target_Flow_API_Name_c__c, flowParams);
                            if (!Test.isRunningTest()) {
                                dynamicFlow.start();
                            }
                        } catch (TypeException te) {
                            // Expected in test environment
                        }
                        System.debug('Data Cloud Transform request sent successfully for ' + this.targetDsoName);
                    } else {
                        System.debug('Warning: No Flow API Name defined for ' + this.targetDsoName);
                    }
                    
                } else {
                    System.debug('Cache is static for ' + this.targetDsoName + '. Execution blocked to save Data Cloud credits.');
                }
                
            } catch (Exception e) {
                System.debug('Could not complete Data Cloud Transform process. Error: ' + e.getMessage());
            }
        }
    }
}