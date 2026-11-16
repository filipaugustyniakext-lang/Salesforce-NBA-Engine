public class DynamicScenarioPicker {
    
    public class ScenarioInput {
        @InvocableVariable(label='Scenario 1 Eligible')
        public Boolean isEligible1;
        
        @InvocableVariable(label='Scenario 2 Eligible')
        public Boolean isEligible2;
        
        @InvocableVariable(label='Scenario 3 Eligible')
        public Boolean isEligible3;
        
        @InvocableVariable(label='Scenario 4 Eligible')
        public Boolean isEligible4;

        @InvocableVariable(label='Scenario 5 Eligible')
        public Boolean isEligible5;

        @InvocableVariable(label='Scenario 6 Eligible')
        public Boolean isEligible6;

        @InvocableVariable(label='Scenario 7 Eligible')
        public Boolean isEligible7;

        @InvocableVariable(label='Scenario 8 Eligible')
        public Boolean isEligible8;

        @InvocableVariable(label='Scenario 9 Eligible')
        public Boolean isEligible9;

        @InvocableVariable(label='Scenario 10 Eligible')
        public Boolean isEligible10;
    }

    @InvocableMethod(label='Pick Random Eligible Scenario' description='Selects a random scenario from up to 10 eligible options')
    public static List<String> pickScenario(List<ScenarioInput> inputs) {
        List<String> results = new List<String>();

        for (ScenarioInput input : inputs) {
            List<String> eligibleScenarios = new List<String>();

            // Safely evaluates true and ignores false/null
            if (input.isEligible1 == true) eligibleScenarios.add('Scenario_1');
            if (input.isEligible2 == true) eligibleScenarios.add('Scenario_2');
            if (input.isEligible3 == true) eligibleScenarios.add('Scenario_3');
            if (input.isEligible4 == true) eligibleScenarios.add('Scenario_4');
            if (input.isEligible5 == true) eligibleScenarios.add('Scenario_5');
            if (input.isEligible6 == true) eligibleScenarios.add('Scenario_6');
            if (input.isEligible7 == true) eligibleScenarios.add('Scenario_7');
            if (input.isEligible8 == true) eligibleScenarios.add('Scenario_8');
            if (input.isEligible9 == true) eligibleScenarios.add('Scenario_9');
            if (input.isEligible10 == true) eligibleScenarios.add('Scenario_10');

            if (eligibleScenarios.isEmpty()) {
                results.add('None');
            } else {
                Integer randomIndex = Integer.valueOf(Math.floor(Math.random() * eligibleScenarios.size()));
                results.add(eligibleScenarios.get(randomIndex));
            }
        }
        return results;
    }
}