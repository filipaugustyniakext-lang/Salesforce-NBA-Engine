/**
 * Server side of the Marketing Dictionary "Calculations" section and of the
 * calculation setup on family attributes.
 */
public with sharing class OfferCalculationController {

    public static final Set<String> NUMERIC_TYPES = new Set<String>{ 'Number', 'Decimal', 'Currency', 'Percent', 'Days', 'Months' };
    public static final Set<String> VALUE_MAP_TYPES = new Set<String>{ 'Picklist', 'Checkbox' };

    public class BandRow {
        @AuraEnabled public Decimal lower;
        @AuraEnabled public Decimal upper;
        @AuraEnabled public Boolean lowerInclusive;
        @AuraEnabled public Boolean upperInclusive;
        @AuraEnabled public Decimal score;
    }

    public class CalculationView {
        @AuraEnabled public Id id;
        @AuraEnabled public String name;
        @AuraEnabled public String description;
        @AuraEnabled public String calculationType;
        @AuraEnabled public String formula;
        @AuraEnabled public Boolean isActive;
        @AuraEnabled public List<String> placeholders = new List<String>();
        @AuraEnabled public Boolean usesValue = false;
        @AuraEnabled public List<BandRow> bands = new List<BandRow>();
        @AuraEnabled public List<String> usedBy = new List<String>();
    }

    public class RuleCalculationView {
        @AuraEnabled public Id ruleId;
        @AuraEnabled public Id attributeId;
        @AuraEnabled public Id familyId;
        @AuraEnabled public Id calculationId;
        @AuraEnabled public String inputs;
    }

    public class FormulaCheck {
        @AuraEnabled public Boolean ok = true;
        @AuraEnabled public String message;
        @AuraEnabled public List<String> placeholders = new List<String>();
        @AuraEnabled public Boolean usesValue = false;
    }

    /** One family attribute as the dictionary is about to save it. */
    public class FamilyItem {
        public String label;
        public String attributeType;
        public Boolean impacts;
        public Id calculationId;
        public Map<String, Object> inputs;
        public List<Map<String, Object>> valueRows;
        public Id attributeId;
    }

    @AuraEnabled
    public static List<CalculationView> getCalculations() {
        Map<Id, CalculationView> byId = new Map<Id, CalculationView>();
        List<CalculationView> out = new List<CalculationView>();
        for (Offer_Attribute_Calculation__c c : [
            SELECT Id, Name, Description__c, Calculation_Type__c, Formula__c, Is_Active__c,
                   (SELECT Lower_Bound__c, Upper_Bound__c, Lower_Inclusive__c, Upper_Inclusive__c, Score__c
                    FROM Bands__r ORDER BY Sort_Order__c ASC NULLS LAST, Name ASC)
            FROM Offer_Attribute_Calculation__c
            ORDER BY Name ASC
            LIMIT 500
        ]) {
            CalculationView v = new CalculationView();
            v.id = c.Id;
            v.name = c.Name;
            v.description = c.Description__c;
            v.calculationType = c.Calculation_Type__c;
            v.formula = c.Formula__c;
            v.isActive = c.Is_Active__c;
            if (c.Calculation_Type__c != OfferAttractivenessCalculator.TYPE_VALUE_MAP) {
                v.placeholders = OfferFormula.placeholders(c.Formula__c);
                v.usesValue = OfferFormula.usesValue(c.Formula__c);
            }
            for (Offer_Calculation_Band__c b : c.Bands__r) {
                BandRow r = new BandRow();
                r.lower = b.Lower_Bound__c;
                r.upper = b.Upper_Bound__c;
                r.lowerInclusive = b.Lower_Inclusive__c;
                r.upperInclusive = b.Upper_Inclusive__c;
                r.score = b.Score__c;
                v.bands.add(r);
            }
            byId.put(c.Id, v);
            out.add(v);
        }
        for (Offer_Attribute_Rule__c rule : [
            SELECT Calculation__c, Product_Family__r.Name, Offer_Attribute__r.Name
            FROM Offer_Attribute_Rule__c
            WHERE Calculation__c IN :byId.keySet()
            ORDER BY Product_Family__r.Name, Offer_Attribute__r.Name
        ]) {
            byId.get(rule.Calculation__c).usedBy.add(rule.Product_Family__r.Name + ' · ' + rule.Offer_Attribute__r.Name);
        }
        return out;
    }

    @AuraEnabled
    public static List<RuleCalculationView> getRuleCalculations() {
        List<RuleCalculationView> out = new List<RuleCalculationView>();
        for (Offer_Attribute_Rule__c rule : [
            SELECT Id, Offer_Attribute__c, Product_Family__c, Calculation__c, Calculation_Inputs__c
            FROM Offer_Attribute_Rule__c
            LIMIT 5000
        ]) {
            RuleCalculationView v = new RuleCalculationView();
            v.ruleId = rule.Id;
            v.attributeId = rule.Offer_Attribute__c;
            v.familyId = rule.Product_Family__c;
            v.calculationId = rule.Calculation__c;
            v.inputs = rule.Calculation_Inputs__c;
            out.add(v);
        }
        return out;
    }

    @AuraEnabled
    public static FormulaCheck checkFormula(String formula) {
        FormulaCheck res = new FormulaCheck();
        try {
            OfferFormula.parse(formula);
            res.placeholders = OfferFormula.placeholders(formula);
            res.usesValue = OfferFormula.usesValue(formula);
        } catch (OfferFormula.FormulaException e) {
            res.ok = false;
            res.message = e.getMessage();
        }
        return res;
    }

    /** Strength for a test value, so an admin can try a template before saving it. */
    @AuraEnabled
    public static Decimal previewCalculation(String calculationType, String formula, List<BandRow> bands, Map<String, Decimal> vars) {
        try {
            Decimal result = OfferFormula.parse(formula).evaluate(vars);
            if (calculationType == OfferAttractivenessCalculator.TYPE_BANDS) {
                result = OfferAttractivenessCalculator.matchBand(result, toBands(bands, null));
            }
            return OfferAttractivenessCalculator.clamp(result).setScale(4, System.RoundingMode.HALF_UP);
        } catch (OfferFormula.FormulaException e) {
            throw fail(e.getMessage());
        }
    }

    @AuraEnabled
    public static Id saveCalculation(Offer_Attribute_Calculation__c calculation, List<BandRow> bands) {
        if (calculation == null) throw fail('Nothing to save.');
        List<String> errors = calculationErrors(calculation, bands);
        if (!errors.isEmpty()) throw fail(String.join(errors, ' '));
        if (calculation.Calculation_Type__c == OfferAttractivenessCalculator.TYPE_VALUE_MAP) {
            calculation.Formula__c = null;
        }
        try {
            upsert calculation;
            delete [SELECT Id FROM Offer_Calculation_Band__c WHERE Calculation__c = :calculation.Id];
            if (calculation.Calculation_Type__c == OfferAttractivenessCalculator.TYPE_BANDS) {
                insert toBands(bands, calculation.Id);
            }
        } catch (DmlException e) {
            throw fail(e.getDmlMessage(0));
        }
        return calculation.Id;
    }

    @AuraEnabled
    public static void deleteCalculation(Id calculationId) {
        List<String> users = new List<String>();
        for (Offer_Attribute_Rule__c rule : [
            SELECT Product_Family__r.Name, Offer_Attribute__r.Name
            FROM Offer_Attribute_Rule__c WHERE Calculation__c = :calculationId
        ]) {
            users.add(rule.Product_Family__r.Name + ' · ' + rule.Offer_Attribute__r.Name);
        }
        if (!users.isEmpty()) {
            throw fail('This calculation is still used by ' + String.join(users, ', ') + '. Pick another calculation for those attributes first.');
        }
        try {
            delete new Offer_Attribute_Calculation__c(Id = calculationId);
        } catch (DmlException e) {
            throw fail(e.getDmlMessage(0));
        }
    }

    /** Checks a family's attributes before anything is saved. Returns one message per problem. */
    @AuraEnabled
    public static List<String> checkFamilyCalculations(String itemsJson) {
        return familyErrors(parseItems(itemsJson));
    }

    /** Stores the value map rows of a family's Picklist and Checkbox attributes, after the rules are saved. */
    @AuraEnabled
    public static void saveFamilyValueRows(Id familyId, String itemsJson) {
        List<FamilyItem> items = parseItems(itemsJson);
        List<String> errors = familyErrors(items);
        if (!errors.isEmpty()) throw fail(String.join(errors, ' '));

        Map<Id, FamilyItem> byAttr = new Map<Id, FamilyItem>();
        for (FamilyItem item : items) {
            if (item.attributeId != null) byAttr.put(item.attributeId, item);
        }
        Map<Id, Offer_Attribute_Calculation__c> calcs = calculationsFor(items);
        Set<Id> replaceRuleIds = new Set<Id>();
        List<Offer_Attractiveness_Score_Band__c> rows = new List<Offer_Attractiveness_Score_Band__c>();
        for (Offer_Attribute_Rule__c rule : [
            SELECT Id, Offer_Attribute__c FROM Offer_Attribute_Rule__c
            WHERE Product_Family__c = :familyId AND Offer_Attribute__c IN :byAttr.keySet()
        ]) {
            FamilyItem item = byAttr.get(rule.Offer_Attribute__c);
            Offer_Attribute_Calculation__c calc = item.calculationId == null ? null : calcs.get(item.calculationId);
            if (item.impacts != true || calc == null || calc.Calculation_Type__c != OfferAttractivenessCalculator.TYPE_VALUE_MAP) continue;
            replaceRuleIds.add(rule.Id);
            Integer order = 1;
            for (Map<String, Object> vr : item.valueRows) {
                rows.add(new Offer_Attractiveness_Score_Band__c(
                    Rule__c = rule.Id,
                    Value_Key__c = String.valueOf(vr.get('key')).trim(),
                    Score__c = OfferAttractivenessCalculator.toDecimal(vr.get('score')),
                    Sort_Order__c = order++,
                    Is_Active__c = true
                ));
            }
        }
        try {
            delete [SELECT Id FROM Offer_Attractiveness_Score_Band__c WHERE Rule__c IN :replaceRuleIds];
            insert rows;
        } catch (DmlException e) {
            throw fail(e.getDmlMessage(0));
        }
    }

    public static List<String> calculationErrors(Offer_Attribute_Calculation__c calc, List<BandRow> bands) {
        List<String> errors = new List<String>();
        if (String.isBlank(calc.Name)) errors.add('Give the calculation a name.');
        String type = calc.Calculation_Type__c;
        if (type != OfferAttractivenessCalculator.TYPE_FORMULA && type != OfferAttractivenessCalculator.TYPE_BANDS
                && type != OfferAttractivenessCalculator.TYPE_VALUE_MAP) {
            errors.add('Pick a calculation type.');
            return errors;
        }
        if (type != OfferAttractivenessCalculator.TYPE_VALUE_MAP) {
            try {
                OfferFormula.parse(calc.Formula__c);
            } catch (OfferFormula.FormulaException e) {
                errors.add('Formula: ' + e.getMessage());
            }
        }
        if (type == OfferAttractivenessCalculator.TYPE_BANDS) {
            if (bands == null || bands.isEmpty()) errors.add('Add at least one band row.');
            Integer i = 1;
            for (BandRow b : bands == null ? new List<BandRow>() : bands) {
                if (b.score == null || b.score < 0 || b.score > 1) errors.add('Band row ' + i + ': strength must be between 0 and 1.');
                if (b.lower != null && b.upper != null && b.lower > b.upper) errors.add('Band row ' + i + ': From is above To.');
                i++;
            }
        }
        if (calc.Id != null) {
            Offer_Attribute_Calculation__c old = [SELECT Calculation_Type__c FROM Offer_Attribute_Calculation__c WHERE Id = :calc.Id];
            List<Offer_Attribute_Rule__c> users = [
                SELECT Calculation_Inputs__c, Product_Family__r.Name, Offer_Attribute__r.Name
                FROM Offer_Attribute_Rule__c WHERE Calculation__c = :calc.Id
            ];
            Boolean wasMap = old.Calculation_Type__c == OfferAttractivenessCalculator.TYPE_VALUE_MAP;
            Boolean isMap = type == OfferAttractivenessCalculator.TYPE_VALUE_MAP;
            if (!users.isEmpty() && wasMap != isMap) {
                errors.add('This calculation is in use, so it cannot switch between Value Map and a formula type.');
            } else if (!isMap && errors.isEmpty()) {
                for (Offer_Attribute_Rule__c rule : users) {
                    Map<String, Object> inputs = OfferAttractivenessCalculator.parseInputs(rule.Calculation_Inputs__c);
                    List<String> missing = new List<String>();
                    for (String p : OfferFormula.placeholders(calc.Formula__c)) {
                        if (!hasInput(inputs, p)) missing.add('{' + p + '}');
                    }
                    if (!missing.isEmpty()) {
                        errors.add(rule.Product_Family__r.Name + ' · ' + rule.Offer_Attribute__r.Name
                            + ' uses this calculation and has no input for ' + String.join(missing, ', ') + '.');
                    }
                }
            }
        }
        return errors;
    }

    public static List<String> familyErrors(List<FamilyItem> items) {
        List<String> errors = new List<String>();
        Map<Id, Offer_Attribute_Calculation__c> calcs = calculationsFor(items);
        for (FamilyItem item : items) {
            if (item.impacts != true) continue;
            String label = String.isBlank(item.label) ? 'An attribute' : item.label;
            Boolean numeric = NUMERIC_TYPES.contains(item.attributeType);
            Boolean mapped = VALUE_MAP_TYPES.contains(item.attributeType);
            if (!numeric && !mapped) {
                errors.add(label + ': a ' + (String.isBlank(item.attributeType) ? 'typeless' : item.attributeType)
                    + ' attribute cannot impact attractiveness.');
                continue;
            }
            Offer_Attribute_Calculation__c calc = item.calculationId == null ? null : calcs.get(item.calculationId);
            if (calc == null) {
                errors.add(label + ': pick a calculation.');
                continue;
            }
            Boolean calcIsMap = calc.Calculation_Type__c == OfferAttractivenessCalculator.TYPE_VALUE_MAP;
            if (numeric && calcIsMap) {
                errors.add(label + ': ' + calc.Name + ' is a Value Map, which only fits Picklist and Checkbox attributes.');
                continue;
            }
            if (mapped && !calcIsMap) {
                errors.add(label + ': ' + calc.Name + ' is a formula, which only fits Number, Currency and Percent attributes.');
                continue;
            }
            if (calcIsMap) {
                if (item.valueRows.isEmpty()) errors.add(label + ': add at least one value with its strength.');
                Set<String> keys = new Set<String>();
                for (Map<String, Object> vr : item.valueRows) {
                    String key = vr.get('key') == null ? '' : String.valueOf(vr.get('key')).trim();
                    Decimal score = OfferAttractivenessCalculator.toDecimal(vr.get('score'));
                    if (String.isBlank(key)) errors.add(label + ': every value row needs a value.');
                    else if (!keys.add(key.toLowerCase())) errors.add(label + ': value "' + key + '" is listed twice.');
                    if (score == null || score < 0 || score > 1) errors.add(label + ': strength for "' + key + '" must be between 0 and 1.');
                }
                continue;
            }
            List<String> missing = new List<String>();
            for (String p : OfferFormula.placeholders(calc.Formula__c)) {
                if (!hasInput(item.inputs, p)) missing.add('{' + p + '}');
            }
            if (!missing.isEmpty()) errors.add(label + ': fill ' + String.join(missing, ', ') + ' for ' + calc.Name + '.');
        }
        return errors;
    }

    private static Boolean hasInput(Map<String, Object> inputs, String placeholder) {
        if (inputs == null) return false;
        for (String key : inputs.keySet()) {
            if (key == null || !key.trim().equalsIgnoreCase(placeholder)) continue;
            Object raw = inputs.get(key);
            if (!(raw instanceof Map<String, Object>)) return false;
            Map<String, Object> input = (Map<String, Object>) raw;
            String source = input.get('source') == null ? null : String.valueOf(input.get('source'));
            if (source == 'number') return OfferAttractivenessCalculator.toDecimal(input.get('value')) != null;
            if (source == 'reference') return input.get('id') != null && String.isNotBlank(String.valueOf(input.get('id')));
            if (source == 'attribute') return input.get('field') != null && String.isNotBlank(String.valueOf(input.get('field')));
            return false;
        }
        return false;
    }

    private static Map<Id, Offer_Attribute_Calculation__c> calculationsFor(List<FamilyItem> items) {
        Set<Id> ids = new Set<Id>();
        for (FamilyItem item : items) {
            if (item.calculationId != null) ids.add(item.calculationId);
        }
        return new Map<Id, Offer_Attribute_Calculation__c>([
            SELECT Id, Name, Calculation_Type__c, Formula__c FROM Offer_Attribute_Calculation__c WHERE Id IN :ids
        ]);
    }

    private static List<FamilyItem> parseItems(String itemsJson) {
        List<FamilyItem> items = new List<FamilyItem>();
        if (String.isBlank(itemsJson)) return items;
        for (Object raw : (List<Object>) System.JSON.deserializeUntyped(itemsJson)) {
            Map<String, Object> m = (Map<String, Object>) raw;
            FamilyItem item = new FamilyItem();
            item.label = m.get('label') == null ? null : String.valueOf(m.get('label'));
            item.attributeType = m.get('attributeType') == null ? null : String.valueOf(m.get('attributeType'));
            item.impacts = m.get('impacts') == true;
            item.calculationId = toId(m.get('calculationId'));
            item.attributeId = toId(m.get('attributeId'));
            item.inputs = m.get('inputs') instanceof Map<String, Object> ? (Map<String, Object>) m.get('inputs') : new Map<String, Object>();
            item.valueRows = new List<Map<String, Object>>();
            if (m.get('valueRows') instanceof List<Object>) {
                for (Object vr : (List<Object>) m.get('valueRows')) {
                    if (vr instanceof Map<String, Object>) item.valueRows.add((Map<String, Object>) vr);
                }
            }
            items.add(item);
        }
        return items;
    }

    private static Id toId(Object o) {
        if (o == null || String.isBlank(String.valueOf(o))) return null;
        try {
            return Id.valueOf(String.valueOf(o));
        } catch (Exception e) {
            return null;
        }
    }

    private static List<Offer_Calculation_Band__c> toBands(List<BandRow> rows, Id calcId) {
        List<Offer_Calculation_Band__c> out = new List<Offer_Calculation_Band__c>();
        Integer order = 1;
        for (BandRow r : rows == null ? new List<BandRow>() : rows) {
            out.add(new Offer_Calculation_Band__c(
                Calculation__c = calcId,
                Lower_Bound__c = r.lower,
                Upper_Bound__c = r.upper,
                Lower_Inclusive__c = r.lowerInclusive == true,
                Upper_Inclusive__c = r.upperInclusive == true,
                Score__c = r.score,
                Sort_Order__c = order++
            ));
        }
        return out;
    }

    private static AuraHandledException fail(String message) {
        AuraHandledException e = new AuraHandledException(message);
        e.setMessage(message);
        return e;
    }
}