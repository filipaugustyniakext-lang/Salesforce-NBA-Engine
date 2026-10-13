@isTest
private class DynamicScenarioPickerTest {

    @isTest
    static void testSingleScenarioWithNulls() {
        DynamicScenarioPicker.ScenarioInput input = new DynamicScenarioPicker.ScenarioInput();
        // Leaving all other scenarios null to verify safe null handling
        input.isEligible5 = true;

        Test.startTest();
        List<String> results = DynamicScenarioPicker.pickScenario(new List<DynamicScenarioPicker.ScenarioInput>{ input });
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return 1 result');
        System.assertEquals('Scenario_5', results[0], 'Should pick Scenario_5 as the only eligible option');
    }

    @isTest
    static void testMultipleEligibleScenarios() {
        DynamicScenarioPicker.ScenarioInput input = new DynamicScenarioPicker.ScenarioInput();
        input.isEligible1 = true;
        input.isEligible7 = true;
        input.isEligible10 = true;
        // Remaining fields default to null

        Test.startTest();
        List<String> results = DynamicScenarioPicker.pickScenario(new List<DynamicScenarioPicker.ScenarioInput>{ input });
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return 1 result');
        System.assert(
            results[0] == 'Scenario_1' || results[0] == 'Scenario_7' || results[0] == 'Scenario_10',
            'Result must be one of the eligible scenarios (1, 7, or 10)'
        );
    }

    @isTest
    static void testAllTenScenariosEligible() {
        DynamicScenarioPicker.ScenarioInput input = new DynamicScenarioPicker.ScenarioInput();
        input.isEligible1 = true;
        input.isEligible2 = true;
        input.isEligible3 = true;
        input.isEligible4 = true;
        input.isEligible5 = true;
        input.isEligible6 = true;
        input.isEligible7 = true;
        input.isEligible8 = true;
        input.isEligible9 = true;
        input.isEligible10 = true;

        Test.startTest();
        List<String> results = DynamicScenarioPicker.pickScenario(new List<DynamicScenarioPicker.ScenarioInput>{ input });
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return 1 result');
        System.assert(results[0].startsWith('Scenario_'), 'Should return a valid scenario name');
    }

    @isTest
    static void testNoEligibleScenariosWithNullsAndFalses() {
        DynamicScenarioPicker.ScenarioInput input = new DynamicScenarioPicker.ScenarioInput();
        input.isEligible1 = false;
        input.isEligible2 = false;
        // Others left as null

        Test.startTest();
        List<String> results = DynamicScenarioPicker.pickScenario(new List<DynamicScenarioPicker.ScenarioInput>{ input });
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should return 1 result');
        System.assertEquals('None', results[0], 'Should return None when zero conditions pass');
    }
}