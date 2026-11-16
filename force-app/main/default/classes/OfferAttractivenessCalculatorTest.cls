@IsTest
private class OfferAttractivenessCalculatorTest {

    @IsTest
    static void cashLoanExample_matchesExcel() {
        // Excel: 120000 / 120 instalments / 8% / omnichannel / fixed / no early-repayment fee.
        // Amount Z = (120000 - 1000) / (250000 - 1000) = 0.4779116466
        // Tenure Z = (120 - 0) / (120 - 0) = 1
        // Rate gap = 14.5 - 8 = 6.5 pp, band (6, 7] = 0.7
        // 0.4779116466*0.10 + 1*0.10 + 0.7*0.45 + 0.75*0.15 + 1*0.10 + 1*0.10 = 0.7752911647
        OfferCalculationTestData.cashLoan();

        Test.startTest();
        Decimal score = OfferAttractivenessCalculator.calculate(OfferCalculationTestData.FAMILY_NAME, OfferCalculationTestData.excelParams());
        Test.stopTest();

        System.assertEquals(Decimal.valueOf('0.775291'), score, 'Cash loan Excel example');
    }

    @IsTest
    static void valueBeyondReferenceRange_scoresAsRangeEdge() {
        OfferCalculationTestData.cashLoan();
        Map<String, Object> params = OfferCalculationTestData.excelParams();
        params.put('Maximum_Amount__c', 999999);
        params.put('Maximum_Tenure__c', 500);

        Decimal score = OfferAttractivenessCalculator.calculate(OfferCalculationTestData.FAMILY_NAME, params);

        // Amount strength clamps to 1: 0.1 + 0.1 + 0.315 + 0.1125 + 0.1 + 0.1
        System.assertEquals(Decimal.valueOf('0.827500'), score, 'Out of range values score as the edge of the range');
    }

    @IsTest
    static void blankValuesAndUnknownKeys_scoreZero() {
        OfferCalculationTestData.cashLoan();
        Map<String, Object> params = new Map<String, Object>{ 'Sales_Process__c' => 'carrier pigeon' };

        Decimal score = OfferAttractivenessCalculator.calculate(OfferCalculationTestData.FAMILY_NAME, params);

        System.assertEquals(Decimal.valueOf('0.000000'), score, 'Nothing filled in scores 0');
    }

    @IsTest
    static void attributeWithoutCalculation_scoresZero() {
        OfferCalculationTestData d = OfferCalculationTestData.cashLoan();
        update new Offer_Attribute_Rule__c(Id = d.ruleByApi.get('Nominal_Interest_Rate__c').Id, Calculation__c = null);

        Decimal score = OfferAttractivenessCalculator.calculate(OfferCalculationTestData.FAMILY_NAME, OfferCalculationTestData.excelParams());

        System.assertEquals(Decimal.valueOf('0.460291'), score, 'The rate share drops out');
    }

    @IsTest
    static void attributeInput_usesAnotherOfferValue() {
        OfferCalculationTestData d = OfferCalculationTestData.cashLoan();
        Offer_Attribute_Rule__c tenure = new Offer_Attribute_Rule__c(Id = d.ruleByApi.get('Maximum_Tenure__c').Id);
        tenure.Calculation_Inputs__c = JSON.serialize(new Map<String, Object>{
            'Floor' => new Map<String, Object>{ 'source' => 'number', 'value' => 0 },
            'Ceiling' => new Map<String, Object>{ 'source' => 'attribute', 'field' => 'Cap__c', 'name' => 'Cap' }
        });
        update tenure;
        Map<String, Object> params = OfferCalculationTestData.excelParams();
        params.put('Cap__c', 240);

        Decimal score = OfferAttractivenessCalculator.calculate(OfferCalculationTestData.FAMILY_NAME, params);

        // Tenure strength 120 / 240 = 0.5 instead of 1
        System.assertEquals(Decimal.valueOf('0.725291'), score, 'Ceiling comes from the other offer value');
    }

    @IsTest
    static void familyWithoutScoredAttributes_returnsNull() {
        System.assertEquals(null, OfferAttractivenessCalculator.calculate('No Such Family', new Map<String, Object>()));
        System.assertEquals(null, OfferAttractivenessCalculator.scoreOffer(null, null));
    }

    @IsTest
    static void boundsForFamily_readsReferenceRange() {
        OfferCalculationTestData.cashLoan();

        Map<String, OfferAttractivenessCalculator.InputBound> bounds = OfferAttractivenessCalculator.boundsForFamily(OfferCalculationTestData.FAMILY_NAME);

        System.assertEquals(1000, bounds.get('Maximum_Amount__c').minimum);
        System.assertEquals(250000, bounds.get('Maximum_Amount__c').maximum);
        System.assertEquals(120, bounds.get('Maximum_Tenure__c').maximum);
    }
}