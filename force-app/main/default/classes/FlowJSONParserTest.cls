@isTest
private class FlowJSONParserTest {
    
    @isTest
    static void testValidJsonParsing() {
        // Przygotowanie danych testowych
        FlowJSONParser.FlowInput input = new FlowJSONParser.FlowInput();
        input.jsonString = '{"email":"alex@example.com","status":"active","age":30}';
        input.keyToExtract = 'email';
        
        List<FlowJSONParser.FlowInput> inputs = new List<FlowJSONParser.FlowInput>{input};
        
        Test.startTest();
        List<FlowJSONParser.FlowOutput> outputs = FlowJSONParser.extractValue(inputs);
        Test.stopTest();
        
        System.assertEquals(1, outputs.size(), 'Should return exactly one output.');
        System.assertEquals('alex@example.com', outputs[0].extractedValue, 'Should correctly extract the email address.');
    }
    
    @isTest
    static void testMissingKey() {
        FlowJSONParser.FlowInput input = new FlowJSONParser.FlowInput();
        input.jsonString = '{"email":"alex@example.com"}';
        input.keyToExtract = 'phoneNumber'; // Ten klucz nie istnieje w JSONie
        
        List<FlowJSONParser.FlowInput> inputs = new List<FlowJSONParser.FlowInput>{input};
        
        Test.startTest();
        List<FlowJSONParser.FlowOutput> outputs = FlowJSONParser.extractValue(inputs);
        Test.stopTest();
        
        // Zmiana na poprawny, uniwersalny assert dla wartości null:
        System.assertEquals(null, outputs[0].extractedValue, 'Should return null for non-existent key.');
    }
    
    @isTest
    static void testMalformedJson() {
        FlowJSONParser.FlowInput input = new FlowJSONParser.FlowInput();
        input.jsonString = '{invalid-json-string}'; 
        input.keyToExtract = 'email';
        
        List<FlowJSONParser.FlowInput> inputs = new List<FlowJSONParser.FlowInput>{input};
        
        Test.startTest();
        List<FlowJSONParser.FlowOutput> outputs = FlowJSONParser.extractValue(inputs);
        Test.stopTest();
        
        // Zmiana na poprawny, uniwersalny assert dla wartości null:
        System.assertEquals(null, outputs[0].extractedValue, 'Should handle malformed JSON gracefully and return null.');
    }
    
    @isTest
    static void testBlankInputs() {
        FlowJSONParser.FlowInput input = new FlowJSONParser.FlowInput();
        input.jsonString = ''; // Pusty ciąg znaków
        input.keyToExtract = ''; // Pusty klucz
        
        List<FlowJSONParser.FlowInput> inputs = new List<FlowJSONParser.FlowInput>{input};
        
        Test.startTest();
        List<FlowJSONParser.FlowOutput> outputs = FlowJSONParser.extractValue(inputs);
        Test.stopTest();
        
        System.assertEquals(null, outputs[0].extractedValue, 'Should handle blank inputs gracefully and return null.');
    }
}