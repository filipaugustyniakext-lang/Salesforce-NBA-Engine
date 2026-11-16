@IsTest
public class OfferCalculationTestData {

    public static final String FAMILY_NAME = 'Cash Loan Calc Test';

    public Marketing_Dictionary__c family;
    public Map<String, Marketing_Dictionary__c> attrByApi = new Map<String, Marketing_Dictionary__c>();
    public Map<String, Offer_Attribute_Rule__c> ruleByApi = new Map<String, Offer_Attribute_Rule__c>();
    public Offer_Attribute_Calculation__c minMax;
    public Offer_Attribute_Calculation__c loanGap;
    public Offer_Attribute_Calculation__c valueMap;
    public Map<String, Offer_Reference_Value__c> refByName = new Map<String, Offer_Reference_Value__c>();

    /** The Excel Cash Loan family, configured entirely through calculation templates. */
    public static OfferCalculationTestData cashLoan() {
        OfferCalculationTestData d = new OfferCalculationTestData();
        Id productRt = Schema.SObjectType.Marketing_Dictionary__c.getRecordTypeInfosByDeveloperName().get('Product').getRecordTypeId();
        Id offerRt = Schema.SObjectType.Marketing_Dictionary__c.getRecordTypeInfosByDeveloperName().get('Offer').getRecordTypeId();

        d.family = new Marketing_Dictionary__c(Name = FAMILY_NAME, RecordTypeId = productRt, Dictionary_Sub_Type__c = 'Product Family');
        insert d.family;

        Map<String, String> types = new Map<String, String>{
            'Maximum_Amount__c' => 'Currency', 'Maximum_Tenure__c' => 'Number', 'Nominal_Interest_Rate__c' => 'Percent',
            'Sales_Process__c' => 'Picklist', 'Interest_Type__c' => 'Picklist', 'Earlier_Repayment_Fee__c' => 'Picklist'
        };
        for (String api : types.keySet()) {
            d.attrByApi.put(api, new Marketing_Dictionary__c(
                Name = api.removeEnd('__c').replace('_', ' '), RecordTypeId = offerRt,
                Parameter_API_Name__c = api, Parameter_Type__c = types.get(api)
            ));
        }
        insert d.attrByApi.values();

        for (Offer_Reference_Value__c ref : new List<Offer_Reference_Value__c>{
            new Offer_Reference_Value__c(Name = 'Minimal Amount', Value_Type__c = 'Currency', Reference_Value__c = 1000, Product_Family__c = d.family.Id, Is_Active__c = true),
            new Offer_Reference_Value__c(Name = 'Maximum Amount', Value_Type__c = 'Currency', Reference_Value__c = 250000, Product_Family__c = d.family.Id, Is_Active__c = true),
            new Offer_Reference_Value__c(Name = 'Maximum Tenure', Value_Type__c = 'Number', Reference_Value__c = 120, Product_Family__c = d.family.Id, Is_Active__c = true),
            new Offer_Reference_Value__c(Name = 'Nominal Interest Rate', Value_Type__c = 'Percent', Reference_Value__c = 14.5, Product_Family__c = d.family.Id, Is_Active__c = true)
        }) {
            d.refByName.put(ref.Name, ref);
        }
        insert d.refByName.values();

        d.minMax = new Offer_Attribute_Calculation__c(Name = 'Min Max', Calculation_Type__c = 'Formula',
            Formula__c = '({Value} - {Floor}) / ({Ceiling} - {Floor})', Is_Active__c = true);
        d.loanGap = new Offer_Attribute_Calculation__c(Name = 'Loan Rate Gap', Calculation_Type__c = 'Formula with Bands',
            Formula__c = '{Reference Rate} - {Value}', Is_Active__c = true);
        d.valueMap = new Offer_Attribute_Calculation__c(Name = 'Value Map', Calculation_Type__c = 'Value Map', Is_Active__c = true);
        insert new List<Offer_Attribute_Calculation__c>{ d.minMax, d.loanGap, d.valueMap };

        List<Offer_Calculation_Band__c> bands = new List<Offer_Calculation_Band__c>{
            new Offer_Calculation_Band__c(Calculation__c = d.loanGap.Id, Upper_Bound__c = 1, Upper_Inclusive__c = true, Score__c = 0.1, Sort_Order__c = 1)
        };
        for (Integer i = 1; i < 9; i++) {
            bands.add(new Offer_Calculation_Band__c(Calculation__c = d.loanGap.Id, Lower_Bound__c = i, Upper_Bound__c = i + 1,
                Upper_Inclusive__c = true, Score__c = (i + 1) / 10.0, Sort_Order__c = i + 1));
        }
        bands.add(new Offer_Calculation_Band__c(Calculation__c = d.loanGap.Id, Lower_Bound__c = 9, Score__c = 1, Sort_Order__c = 10));
        insert bands;

        Map<String, Decimal> weights = new Map<String, Decimal>{
            'Maximum_Amount__c' => 0.10, 'Maximum_Tenure__c' => 0.10, 'Nominal_Interest_Rate__c' => 0.45,
            'Sales_Process__c' => 0.15, 'Interest_Type__c' => 0.10, 'Earlier_Repayment_Fee__c' => 0.10
        };
        Map<String, String> inputs = new Map<String, String>{
            'Maximum_Amount__c' => JSON.serialize(new Map<String, Object>{
                'Floor' => reference(d.refByName.get('Minimal Amount')), 'Ceiling' => reference(d.refByName.get('Maximum Amount')) }),
            'Maximum_Tenure__c' => JSON.serialize(new Map<String, Object>{
                'Floor' => new Map<String, Object>{ 'source' => 'number', 'value' => 0 }, 'Ceiling' => reference(d.refByName.get('Maximum Tenure')) }),
            'Nominal_Interest_Rate__c' => JSON.serialize(new Map<String, Object>{
                'Reference Rate' => reference(d.refByName.get('Nominal Interest Rate')) })
        };
        for (String api : weights.keySet()) {
            Boolean picklist = types.get(api) == 'Picklist';
            Id calcId = picklist ? d.valueMap.Id : (api == 'Nominal_Interest_Rate__c' ? d.loanGap.Id : d.minMax.Id);
            d.ruleByApi.put(api, new Offer_Attribute_Rule__c(
                Product_Family__c = d.family.Id, Offer_Attribute__c = d.attrByApi.get(api).Id,
                Impacts_Attractiveness__c = true, Attractiveness_Weight__c = weights.get(api),
                Calculation__c = calcId, Calculation_Inputs__c = inputs.get(api), Is_Visible__c = true
            ));
        }
        insert d.ruleByApi.values();

        Map<String, Map<String, Decimal>> maps = new Map<String, Map<String, Decimal>>{
            'Sales_Process__c' => new Map<String, Decimal>{ 'branch' => 0.5, 'omnichannel' => 0.75, 'online' => 1 },
            'Interest_Type__c' => new Map<String, Decimal>{ 'variable' => 0.5, 'fixed' => 1 },
            'Earlier_Repayment_Fee__c' => new Map<String, Decimal>{ 'YES' => 0, 'NO' => 1 }
        };
        List<Offer_Attractiveness_Score_Band__c> rows = new List<Offer_Attractiveness_Score_Band__c>();
        for (String api : maps.keySet()) {
            Integer order = 1;
            for (String key : maps.get(api).keySet()) {
                rows.add(new Offer_Attractiveness_Score_Band__c(Rule__c = d.ruleByApi.get(api).Id, Value_Key__c = key,
                    Score__c = maps.get(api).get(key), Sort_Order__c = order++, Is_Active__c = true));
            }
        }
        insert rows;
        return d;
    }

    public static Map<String, Object> reference(Offer_Reference_Value__c ref) {
        return new Map<String, Object>{ 'source' => 'reference', 'id' => ref.Id, 'name' => ref.Name };
    }

    public static Map<String, Object> excelParams() {
        return new Map<String, Object>{
            'Maximum_Amount__c' => 120000,
            'Maximum_Tenure__c' => 120,
            'Nominal_Interest_Rate__c' => 8,
            'Sales_Process__c' => 'omnichannel',
            'Interest_Type__c' => 'fixed',
            'Earlier_Repayment_Fee__c' => 'NO'
        };
    }
}