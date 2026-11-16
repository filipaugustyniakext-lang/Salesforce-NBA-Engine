@IsTest
private class OfferCalculationControllerTest {

    private static OfferCalculationController.BandRow band(Decimal lower, Decimal upper, Decimal score) {
        OfferCalculationController.BandRow b = new OfferCalculationController.BandRow();
        b.lower = lower;
        b.upper = upper;
        b.upperInclusive = true;
        b.score = score;
        return b;
    }

    private static String item(String label, String type, Id calcId, Map<String, Object> inputs, List<Object> rows, Id attrId) {
        return JSON.serialize(new List<Object>{ new Map<String, Object>{
            'label' => label, 'attributeType' => type, 'impacts' => true, 'calculationId' => calcId,
            'inputs' => inputs, 'valueRows' => rows, 'attributeId' => attrId
        } });
    }

    @IsTest
    static void saveCalculation_storesBandsAndListsUsage() {
        OfferCalculationTestData d = OfferCalculationTestData.cashLoan();
        Offer_Attribute_Calculation__c calc = new Offer_Attribute_Calculation__c(
            Name = 'Amount Buckets', Calculation_Type__c = 'Formula with Bands', Formula__c = '{Value}');

        Id calcId = OfferCalculationController.saveCalculation(calc,
            new List<OfferCalculationController.BandRow>{ band(null, 25000, 0.1), band(25000, null, 1) });

        System.assertEquals(2, [SELECT COUNT() FROM Offer_Calculation_Band__c WHERE Calculation__c = :calcId]);
        Boolean found = false;
        for (OfferCalculationController.CalculationView v : OfferCalculationController.getCalculations()) {
            if (v.id == d.minMax.Id) {
                System.assertEquals(new List<String>{ 'Floor', 'Ceiling' }, v.placeholders);
                System.assertEquals(2, v.usedBy.size());
                found = true;
            }
        }
        System.assert(found);
        System.assertEquals(6, [SELECT COUNT() FROM Offer_Attribute_Rule__c WHERE Product_Family__c = :d.family.Id]);
        System.assert(!OfferCalculationController.getRuleCalculations().isEmpty());
    }

    @IsTest
    static void saveCalculation_rejectsBadSetups() {
        OfferCalculationTestData d = OfferCalculationTestData.cashLoan();
        List<Offer_Attribute_Calculation__c> bad = new List<Offer_Attribute_Calculation__c>{
            new Offer_Attribute_Calculation__c(Name = '', Calculation_Type__c = 'Formula', Formula__c = '{Value}'),
            new Offer_Attribute_Calculation__c(Name = 'Broken', Calculation_Type__c = 'Formula', Formula__c = '({Value}'),
            new Offer_Attribute_Calculation__c(Name = 'No bands', Calculation_Type__c = 'Formula with Bands', Formula__c = '{Value}'),
            new Offer_Attribute_Calculation__c(Id = d.minMax.Id, Name = 'Min Max', Calculation_Type__c = 'Formula', Formula__c = '{Value} / {Step}'),
            new Offer_Attribute_Calculation__c(Id = d.minMax.Id, Name = 'Min Max', Calculation_Type__c = 'Value Map')
        };
        for (Offer_Attribute_Calculation__c calc : bad) {
            try {
                OfferCalculationController.saveCalculation(calc, new List<OfferCalculationController.BandRow>{ band(1, 0, 2) });
                System.assert(false, 'Expected a validation error for ' + calc.Name);
            } catch (AuraHandledException e) {
                System.assert(String.isNotBlank(e.getMessage()));
            }
        }
    }

    @IsTest
    static void deleteCalculation_blockedWhileInUse() {
        OfferCalculationTestData d = OfferCalculationTestData.cashLoan();
        try {
            OfferCalculationController.deleteCalculation(d.minMax.Id);
            System.assert(false, 'Expected in-use error');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage().contains('still used'));
        }
        Offer_Attribute_Calculation__c spare = new Offer_Attribute_Calculation__c(Name = 'Spare', Calculation_Type__c = 'Formula', Formula__c = '1');
        insert spare;
        OfferCalculationController.deleteCalculation(spare.Id);
        System.assertEquals(0, [SELECT COUNT() FROM Offer_Attribute_Calculation__c WHERE Id = :spare.Id]);
    }

    @IsTest
    static void checkFamilyCalculations_catchesMissingSetup() {
        OfferCalculationTestData d = OfferCalculationTestData.cashLoan();
        System.assertEquals(1, OfferCalculationController.checkFamilyCalculations(item('Amount', 'Currency', null, null, null, null)).size());
        System.assertEquals(1, OfferCalculationController.checkFamilyCalculations(item('Amount', 'Currency', d.minMax.Id,
            new Map<String, Object>{ 'Floor' => new Map<String, Object>{ 'source' => 'number', 'value' => 0 } }, null, null)).size());
        System.assertEquals(1, OfferCalculationController.checkFamilyCalculations(item('Amount', 'Currency', d.valueMap.Id, null, null, null)).size());
        System.assertEquals(1, OfferCalculationController.checkFamilyCalculations(item('Fee', 'Picklist', d.minMax.Id, null, null, null)).size());
        System.assertEquals(1, OfferCalculationController.checkFamilyCalculations(item('Note', 'Text', d.minMax.Id, null, null, null)).size());
        System.assertEquals(3, OfferCalculationController.checkFamilyCalculations(item('Fee', 'Picklist', d.valueMap.Id, null,
            new List<Object>{ new Map<String, Object>{ 'key' => 'YES', 'score' => 2 }, new Map<String, Object>{ 'key' => 'yes', 'score' => 0 },
                              new Map<String, Object>{ 'key' => '', 'score' => 0 } }, null)).size());
        System.assertEquals(0, OfferCalculationController.checkFamilyCalculations(item('Amount', 'Currency', d.minMax.Id,
            new Map<String, Object>{ 'Floor' => new Map<String, Object>{ 'source' => 'number', 'value' => 0 },
                                     'Ceiling' => OfferCalculationTestData.reference(d.refByName.get('Maximum Amount')) }, null, null)).size());
    }

    @IsTest
    static void saveFamilyValueRows_replacesRows() {
        OfferCalculationTestData d = OfferCalculationTestData.cashLoan();
        Marketing_Dictionary__c fee = d.attrByApi.get('Earlier_Repayment_Fee__c');

        OfferCalculationController.saveFamilyValueRows(d.family.Id, item('Fee', 'Picklist', d.valueMap.Id, null,
            new List<Object>{ new Map<String, Object>{ 'key' => 'YES', 'score' => 0.25 }, new Map<String, Object>{ 'key' => 'NO', 'score' => 1 },
                              new Map<String, Object>{ 'key' => 'MAYBE', 'score' => 0.5 } }, fee.Id));

        Id ruleId = d.ruleByApi.get('Earlier_Repayment_Fee__c').Id;
        System.assertEquals(3, [SELECT COUNT() FROM Offer_Attractiveness_Score_Band__c WHERE Rule__c = :ruleId]);
        Map<String, Object> params = OfferCalculationTestData.excelParams();
        params.put('Earlier_Repayment_Fee__c', 'YES');
        // Fee strength drops from 1 to 0.25: 0.7752911647 - 0.075
        System.assertEquals(Decimal.valueOf('0.700291'), OfferAttractivenessCalculator.calculate(OfferCalculationTestData.FAMILY_NAME, params));
    }

    @IsTest
    static void formulaHelpers_reportAndPreview() {
        OfferCalculationController.FormulaCheck ok = OfferCalculationController.checkFormula('({Value} - {Floor}) / {Span}');
        System.assert(ok.ok);
        System.assertEquals(2, ok.placeholders.size());
        System.assert(ok.usesValue);
        System.assert(!OfferCalculationController.checkFormula('({Value}').ok);

        Decimal z = OfferCalculationController.previewCalculation('Formula with Bands', '{Rate} - {Value}',
            new List<OfferCalculationController.BandRow>{ band(null, 1, 0.1), band(1, null, 0.9) },
            new Map<String, Decimal>{ 'Rate' => 14.5, 'Value' => 8 });
        System.assertEquals(Decimal.valueOf('0.9000'), z);
        System.assertEquals(Decimal.valueOf('1.0000'), OfferCalculationController.previewCalculation('Formula', '{Value} * 3', null, new Map<String, Decimal>{ 'Value' => 1 }));
        try {
            OfferCalculationController.previewCalculation('Formula', '{Missing}', null, new Map<String, Decimal>());
            System.assert(false, 'Expected a missing value');
        } catch (AuraHandledException e) {
            System.assert(String.isNotBlank(e.getMessage()));
        }
    }
}