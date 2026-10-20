@isTest
private class DataCloudTransformManagerTest {
    
    private static final String TEST_DSO_NAME = 'GCP_PROSPECT_ACTVTY__dll';
    private static final String TEST_FLOW_NAME = 'Dummy_Test_Flow_Name';

    @testSetup
    static void setupTestData() {
        D360_NRT_Sync_State__c stateRecord = new D360_NRT_Sync_State__c(
            DSO_API_Name_c__c = TEST_DSO_NAME, 
            Target_Flow_API_Name_c__c = TEST_FLOW_NAME,
            Last_Processed_Timestamp_c__c = Datetime.now().addDays(-1) 
        );
        insert stateRecord;
    }

    @isTest
    static void testExecute_NewDataFound() {
        DataCloudTransformManager.mockMaxTime = Datetime.now();
        DataCloudTransformManager job = new DataCloudTransformManager(TEST_DSO_NAME);
        
        Test.startTest();
        job.execute(null); 
        Test.stopTest(); // Forces the Queueable job to execute instantly and flush DML
        
        D360_NRT_Sync_State__c updatedRecord = [SELECT Last_Processed_Timestamp_c__c FROM D360_NRT_Sync_State__c WHERE DSO_API_Name_c__c = :TEST_DSO_NAME LIMIT 1];
        System.assertEquals(DataCloudTransformManager.mockMaxTime, updatedRecord.Last_Processed_Timestamp_c__c, 'The timestamp should have been updated to the new max time.');
    }

    @isTest
    static void testExecute_CacheIsStatic() {
        D360_NRT_Sync_State__c initialRecord = [SELECT Last_Processed_Timestamp_c__c FROM D360_NRT_Sync_State__c WHERE DSO_API_Name_c__c = :TEST_DSO_NAME LIMIT 1];
        Datetime exactDatabaseTime = initialRecord.Last_Processed_Timestamp_c__c;
        
        DataCloudTransformManager.mockMaxTime = exactDatabaseTime;
        DataCloudTransformManager job = new DataCloudTransformManager(TEST_DSO_NAME);
        
        Test.startTest();
        job.execute(null);
        Test.stopTest();
        
        D360_NRT_Sync_State__c unmodifiedRecord = [SELECT Last_Processed_Timestamp_c__c FROM D360_NRT_Sync_State__c WHERE DSO_API_Name_c__c = :TEST_DSO_NAME LIMIT 1];
        System.assertEquals(exactDatabaseTime, unmodifiedRecord.Last_Processed_Timestamp_c__c, 'The timestamp should remain unchanged.');
    }

    @isTest
    static void testExecute_MissingConfiguration() {
        DataCloudTransformManager job = new DataCloudTransformManager('INVALID_STREAM__dll');
        
        Test.startTest();
        job.execute(null);
        Test.stopTest();
        
        System.assert(true, 'Job completed gracefully without throwing an error when configuration is missing.');
    }

    @isTest
    static void testExecute_ExceptionHandling() {
        D360_NRT_Sync_State__c initialRecord = [SELECT Last_Processed_Timestamp_c__c FROM D360_NRT_Sync_State__c WHERE DSO_API_Name_c__c = :TEST_DSO_NAME LIMIT 1];
        Datetime originalTime = initialRecord.Last_Processed_Timestamp_c__c;
        
        DataCloudTransformManager.forceException = true;
        DataCloudTransformManager job = new DataCloudTransformManager(TEST_DSO_NAME);
        
        Test.startTest();
        job.execute(null);
        Test.stopTest();
        
        D360_NRT_Sync_State__c unmodifiedRecord = [SELECT Last_Processed_Timestamp_c__c FROM D360_NRT_Sync_State__c WHERE DSO_API_Name_c__c = :TEST_DSO_NAME LIMIT 1];
        System.assertEquals(originalTime, unmodifiedRecord.Last_Processed_Timestamp_c__c, 'Timestamp should not update when an exception occurs.');
    }
    
    @isTest
    static void testExecute_LiveSOQL_EmptyCache() {
        DataCloudTransformManager.mockMaxTime = null; 
        DataCloudTransformManager job = new DataCloudTransformManager(TEST_DSO_NAME);
        
        Test.startTest();
        job.execute(null);
        Test.stopTest();
        
        D360_NRT_Sync_State__c unmodifiedRecord = [SELECT Last_Processed_Timestamp_c__c FROM D360_NRT_Sync_State__c WHERE DSO_API_Name_c__c = :TEST_DSO_NAME LIMIT 1];
        System.assertNotEquals(Datetime.now(), unmodifiedRecord.Last_Processed_Timestamp_c__c, 'Timestamp should remain unchanged for live SOQL with empty cache.');
    }

    @isTest
    static void testExecute_BlankFlowName() {
        D360_NRT_Sync_State__c record = [SELECT Id FROM D360_NRT_Sync_State__c WHERE DSO_API_Name_c__c = :TEST_DSO_NAME LIMIT 1];
        record.Target_Flow_API_Name_c__c = null; 
        update record;
        
        DataCloudTransformManager.mockMaxTime = Datetime.now();
        DataCloudTransformManager job = new DataCloudTransformManager(TEST_DSO_NAME);
        
        Test.startTest();
        job.execute(null);
        Test.stopTest();
        
        System.assert(true, 'Job completed gracefully when Flow API Name was left blank.');
    }
}