@isTest
private class AIAgentPayloadBuilderTest {

    @isTest
    static void testBuildPayloadSuccess() {
        // 1. Przygotowanie danych wejściowych z różnymi typami wartości (tekst, lista, liczba, null)
        AIAgentPayloadBuilder.Request req = new AIAgentPayloadBuilder.Request();
        
        req.contextTemplate = '{"accountNumber": "{AccountNum}", "emptyParam": "{NullVal}", "unmatched": "{UnmatchedKey}"}';
        req.actionDataTemplate = '{"currencies": {AvailableCurrencies}, "amount": {Amount}}';
        
        Map<String, Object> dynamicParams = new Map<String, Object>{
            'AccountNum' => '123456',
            'AvailableCurrencies' => new List<String>{'EUR', 'USD', 'PLN'},
            'Amount' => 1000000,
            'NullVal' => null
        };
        req.dynamicParamsJson = JSON.serialize(dynamicParams);

        req.actionCode = 'ACT001';
        req.displayType = 'Banner';
        req.agentId = 'Agent_007';
        req.provider = 'Internal';
        req.welcomeSummary = 'Welcome Summary';
        req.welcomeTitle = 'Welcome Title';

        req.branchId = 'BR01';
        req.brandId = 'BRAND01';
        req.customerId = 'CUST100';
        req.representativeId = 'REP01';
        req.tenantId = 'TEN01';
        req.customerType = 'Retail';

        List<AIAgentPayloadBuilder.Request> requests = new List<AIAgentPayloadBuilder.Request>{ req };

        // 2. Wykonanie metody
        Test.startTest();
        List<AIAgentPayloadBuilder.Response> responses = AIAgentPayloadBuilder.buildPayload(requests);
        Test.stopTest();

        // 3. Asercje dla ścieżki sukcesu
        System.assertEquals(1, responses.size(), 'Powinien zostać zwrócony 1 obiekt Response.');
        AIAgentPayloadBuilder.Response res = responses[0];

        System.assertEquals(true, res.isSuccess, 'Operacja powinna zakończyć się sukcesem.');
        System.assertEquals(null, res.errorMessage, 'Brak błędów w errorMessage przy poprawnej konfiguracji.');
        System.assertNotEquals(null, res.payload, 'Payload nie powinien być pusty.');

        // Weryfikacja czy lista zamieniła się na tablicę JSON []
        System.assert(res.payload.contains('["EUR","USD","PLN"]'), 'Listy powinny zostać przekształcone do tablicy JSON []');
        // Weryfikacja czyszczenia nieużytego placeholdera
        System.assert(!res.payload.contains('UnmatchedKey'), 'Niepodmienione placeholdery powinny zostać wyczyszczone');
    }

    @isTest
    static void testBuildPayloadErrorHandling() {
        // 1. Przygotowanie uszkodzonego JSON-a, który wywoła wyjątek w JSON.deserializeUntyped
        AIAgentPayloadBuilder.Request req = new AIAgentPayloadBuilder.Request();
        req.contextTemplate = '{}';
        req.actionDataTemplate = '{}';
        req.dynamicParamsJson = '{invalid_json_format_here'; 

        List<AIAgentPayloadBuilder.Request> requests = new List<AIAgentPayloadBuilder.Request>{ req };

        // 2. Wykonanie metody
        Test.startTest();
        List<AIAgentPayloadBuilder.Response> responses = AIAgentPayloadBuilder.buildPayload(requests);
        Test.stopTest();

        // 3. Asercje dla ścieżki błędu
        System.assertEquals(1, responses.size(), 'Powinien zostać zwrócony 1 obiekt Response.');
        AIAgentPayloadBuilder.Response res = responses[0];

        System.assertEquals(false, res.isSuccess, 'isSuccess powinna mieć wartość false po wystąpieniu wyjątku.');
        System.assertEquals(null, res.payload, 'Payload w przypadku awarii powinien wynosić null.');
        System.assertNotEquals(null, res.errorMessage, 'Treść błędu w errorMessage powinna zostać zapisana.');
        System.assert(res.errorMessage.contains('Błąd przetwarzania w Apex'), 'Komunikat powinien identyfikować błąd w bloku catch.');
    }
}