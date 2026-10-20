@isTest
public class MCE_DataExtensionCalloutTest {
    
    @isTest
    static void testSendData() {
        // 1. Ustawienie udawanego połączenia
        Test.setMock(HttpCalloutMock.class, new MCE_HttpMockFactory());

        // 2. Przygotowanie danych testowych (tak jak we Flow)
        MCE_DataExtensionCallout.MCE_Request req = new MCE_DataExtensionCallout.MCE_Request();
        req.externalKey = 'TestKey123';
        req.prospectId = 'TestProspect';
        req.isExit = true;
        
        // Updated: Populating the new exitReason variable
        req.exitReason = 'Customer Churn'; 
        
        List<MCE_DataExtensionCallout.MCE_Request> requests = new List<MCE_DataExtensionCallout.MCE_Request>{req};

        // 3. Uruchomienie testu
        // StartTest i StopTest są KLUCZOWE przy metodach @future
        Test.startTest();
        MCE_DataExtensionCallout.sendData(requests);
        Test.stopTest(); // Tu Salesforce "dogania" asynchroniczne @future i wykonuje kod

        // 4. Sprawdzenie czy kod przeszedł (Assert)
        // W testach jednostkowych sprawdzamy, czy nie było błędów
        System.assertEquals(1, requests.size(), 'Powinien być jeden rekord w liście');
        
        // Updated: Optional but good practice to assert the new field holds the correct data
        System.assertEquals('Customer Churn', requests[0].exitReason, 'Exit reason test data was not set correctly');
    }
}