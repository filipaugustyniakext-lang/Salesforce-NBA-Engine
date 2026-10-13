public class FlowJSONParser {
    
    // This inner class defines the inputs the Flow must provide
    public class FlowInput {
        @InvocableVariable(required=true label='Raw JSON String' description='The full JSON text to parse')
        public String jsonString;
        
        @InvocableVariable(required=true label='Key to Extract' description='The specific JSON key you want to pull')
        public String keyToExtract;
    }
    
    // This inner class defines the outputs returned back to the Flow
    public class FlowOutput {
        @InvocableVariable(label='Extracted Value' description='The value of the specified key')
        public String extractedValue;
    }
    
    @InvocableMethod(
        label='Extract Value from JSON' 
        category='JSON Utilities' 
        description='Safely extracts a specific key value from a flat JSON string.'
    )
    public static List<FlowOutput> extractValue(List<FlowInput> inputs) {
        List<FlowOutput> outputs = new List<FlowOutput>();
        
        for (FlowInput input : inputs) {
            FlowOutput out = new FlowOutput();
            
            // Check for null or empty inputs to prevent runtime errors
            if (String.isBlank(input.jsonString) || String.isBlank(input.keyToExtract)) {
                out.extractedValue = null;
                outputs.add(out);
                continue;
            }
            
            try {
                // Parse the JSON string into a key-value map
                Map<String, Object> jsonMap = (Map<String, Object>) JSON.deserializeUntyped(input.jsonString);
                
                if (jsonMap.containsKey(input.keyToExtract)) {
                    // Extract the value and convert it to a String format for the Flow
                    out.extractedValue = String.valueOf(jsonMap.get(input.keyToExtract));
                } else {
                    out.extractedValue = null;
                }
            } catch (Exception e) {
                // If the JSON is malformed or parsing fails, return null instead of crashing the Flow
                System.debug('Error parsing JSON in Flow: ' + e.getMessage());
                out.extractedValue = null;
            }
            
            outputs.add(out);
        }
        
        return outputs;
    }
}