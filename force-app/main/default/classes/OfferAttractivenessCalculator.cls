/**
 * Computes offer attractiveness on a 0-1 scale as the weighted sum of per-attribute
 * strengths. Everything comes from the Marketing Dictionary: each family attribute
 * that impacts attractiveness carries a weight and an Offer Attribute Calculation
 * template, plus the inputs that fill the template's placeholders for that family.
 * Each strength is clamped to 0-1, so a value beyond a reference range simply
 * scores as the edge of the range. An attribute without a calculation scores 0.
 */
public with sharing class OfferAttractivenessCalculator {

    public static final String TYPE_FORMULA = 'Formula';
    public static final String TYPE_BANDS = 'Formula with Bands';
    public static final String TYPE_VALUE_MAP = 'Value Map';

    public class InputBound {
        public Decimal minimum;
        public Decimal maximum;
    }

    @AuraEnabled(cacheable=false)
    public static Decimal scoreOffer(String family, Map<String, Object> params) {
        return calculate(family, params);
    }

    /** Returns null when the family has no attribute that impacts attractiveness. */
    public static Decimal calculate(String family, Map<String, Object> data) {
        if (String.isBlank(family) || data == null) {
            return null;
        }
        List<Offer_Attribute_Rule__c> rules = scoredRules(family);
        if (rules.isEmpty()) {
            return null;
        }
        Context ctx = new Context(family, rules);
        Decimal total = 0;
        for (Offer_Attribute_Rule__c rule : rules) {
            if (rule.Attractiveness_Weight__c == null) continue;
            String field = rule.Offer_Attribute__r == null ? null : rule.Offer_Attribute__r.Parameter_API_Name__c;
            Object raw = field == null ? null : data.get(field);
            total += rule.Attractiveness_Weight__c * ctx.strength(rule, raw, data);
        }
        return clamp(total).setScale(6, System.RoundingMode.HALF_UP);
    }

    public static List<Offer_Attribute_Rule__c> scoredRules(String family) {
        return [
            SELECT Id, Attractiveness_Weight__c, Calculation__c, Calculation_Inputs__c,
                   Calculation__r.Name, Calculation__r.Calculation_Type__c, Calculation__r.Formula__c,
                   Offer_Attribute__r.Name, Offer_Attribute__r.Parameter_API_Name__c
            FROM Offer_Attribute_Rule__c
            WHERE Impacts_Attractiveness__c = true
              AND Product_Family__r.Name = :family
              AND (NOT Offer_Attribute__r.Name LIKE '(TEST)%')
            ORDER BY Display_Order__c ASC NULLS LAST
        ];
    }

    /** Loads the templates, bands, value rows and reference values one family needs. */
    public class Context {
        public Map<Id, Offer_Reference_Value__c> refsById = new Map<Id, Offer_Reference_Value__c>();
        public Map<String, Offer_Reference_Value__c> refsByName = new Map<String, Offer_Reference_Value__c>();
        Map<Id, List<Offer_Calculation_Band__c>> bandsByCalc = new Map<Id, List<Offer_Calculation_Band__c>>();
        Map<Id, List<Offer_Attractiveness_Score_Band__c>> valueRowsByRule = new Map<Id, List<Offer_Attractiveness_Score_Band__c>>();
        Map<String, OfferFormula> parsed = new Map<String, OfferFormula>();

        public Context(String family, List<Offer_Attribute_Rule__c> rules) {
            Set<Id> calcIds = new Set<Id>();
            Set<Id> ruleIds = new Set<Id>();
            for (Offer_Attribute_Rule__c rule : rules) {
                if (rule.Calculation__c != null) calcIds.add(rule.Calculation__c);
                if (rule.Id != null) ruleIds.add(rule.Id);
            }
            for (Offer_Calculation_Band__c band : [
                SELECT Calculation__c, Lower_Bound__c, Upper_Bound__c, Lower_Inclusive__c, Upper_Inclusive__c, Score__c
                FROM Offer_Calculation_Band__c
                WHERE Calculation__c IN :calcIds
                ORDER BY Sort_Order__c ASC NULLS LAST, Name ASC
            ]) {
                if (!bandsByCalc.containsKey(band.Calculation__c)) bandsByCalc.put(band.Calculation__c, new List<Offer_Calculation_Band__c>());
                bandsByCalc.get(band.Calculation__c).add(band);
            }
            for (Offer_Attractiveness_Score_Band__c row : [
                SELECT Rule__c, Value_Key__c, Score__c
                FROM Offer_Attractiveness_Score_Band__c
                WHERE Rule__c IN :ruleIds AND Is_Active__c = true AND Value_Key__c != null
                ORDER BY Sort_Order__c ASC NULLS LAST
            ]) {
                if (!valueRowsByRule.containsKey(row.Rule__c)) valueRowsByRule.put(row.Rule__c, new List<Offer_Attractiveness_Score_Band__c>());
                valueRowsByRule.get(row.Rule__c).add(row);
            }
            for (Offer_Reference_Value__c ref : [
                SELECT Id, Name, Reference_Value__c
                FROM Offer_Reference_Value__c
                WHERE Product_Family__r.Name = :family
                  AND (NOT Name LIKE '(TEST)%')
            ]) {
                refsById.put(ref.Id, ref);
                if (!refsByName.containsKey(ref.Name.toLowerCase())) refsByName.put(ref.Name.toLowerCase(), ref);
            }
        }

        public void useValueRows(Id ruleId, List<Offer_Attractiveness_Score_Band__c> rows) {
            valueRowsByRule.put(ruleId, rows);
        }

        public void useBands(Id calcId, List<Offer_Calculation_Band__c> bands) {
            bandsByCalc.put(calcId, bands);
        }

        public Decimal strength(Offer_Attribute_Rule__c rule, Object raw, Map<String, Object> data) {
            Offer_Attribute_Calculation__c calc = rule.Calculation__r;
            if (calc == null) return 0;
            if (calc.Calculation_Type__c == TYPE_VALUE_MAP) {
                return clamp(valueMapScore(valueRowsByRule.get(rule.Id), raw));
            }
            Decimal value = toDecimal(raw);
            if (value == null && OfferFormula.usesValue(calc.Formula__c)) return 0;
            Map<String, Decimal> vars = resolveInputs(parseInputs(rule.Calculation_Inputs__c), data);
            vars.put(OfferFormula.VALUE_PLACEHOLDER, value);
            Decimal result;
            try {
                result = formula(calc.Formula__c).evaluate(vars);
            } catch (OfferFormula.FormulaException e) {
                return 0;
            }
            if (calc.Calculation_Type__c == TYPE_BANDS) {
                return clamp(matchBand(result, bandsByCalc.get(calc.Id)));
            }
            return clamp(result);
        }

        /** Placeholder name to number, for every input that resolves. Unresolved inputs are left out. */
        public Map<String, Decimal> resolveInputs(Map<String, Object> inputs, Map<String, Object> data) {
            Map<String, Decimal> vars = new Map<String, Decimal>();
            for (String name : inputs.keySet()) {
                Decimal v = resolveInput(inputs.get(name), data);
                if (v != null) vars.put(name, v);
            }
            return vars;
        }

        public Decimal resolveInput(Object rawInput, Map<String, Object> data) {
            if (!(rawInput instanceof Map<String, Object>)) return null;
            Map<String, Object> input = (Map<String, Object>) rawInput;
            String source = toStr(input.get('source'));
            if (source == 'number') return toDecimal(input.get('value'));
            if (source == 'reference') {
                Offer_Reference_Value__c ref = null;
                String refId = toStr(input.get('id'));
                if (String.isNotBlank(refId)) {
                    try {
                        ref = refsById.get(Id.valueOf(refId));
                    } catch (Exception e) {
                        ref = null;
                    }
                }
                if (ref == null && input.get('name') != null) ref = refsByName.get(toStr(input.get('name')).toLowerCase());
                return ref == null ? null : ref.Reference_Value__c;
            }
            if (source == 'attribute') {
                String field = toStr(input.get('field'));
                return data == null || String.isBlank(field) ? null : toDecimal(data.get(field));
            }
            return null;
        }

        OfferFormula formula(String text) {
            String key = text == null ? '' : text;
            if (!parsed.containsKey(key)) parsed.put(key, OfferFormula.parse(text));
            return parsed.get(key);
        }
    }

    public static Map<String, Object> parseInputs(String json) {
        if (String.isBlank(json)) return new Map<String, Object>();
        try {
            Object parsed = System.JSON.deserializeUntyped(json);
            return parsed instanceof Map<String, Object> ? (Map<String, Object>) parsed : new Map<String, Object>();
        } catch (Exception e) {
            return new Map<String, Object>();
        }
    }

    public static Decimal valueMapScore(List<Offer_Attractiveness_Score_Band__c> rows, Object raw) {
        String key = toStr(raw);
        if (String.isBlank(key) || rows == null) return 0;
        for (Offer_Attractiveness_Score_Band__c row : rows) {
            if (row.Value_Key__c != null && row.Value_Key__c.trim().equalsIgnoreCase(key.trim()) && row.Score__c != null) {
                return row.Score__c;
            }
        }
        return 0;
    }

    public static Decimal matchBand(Decimal value, List<Offer_Calculation_Band__c> bands) {
        if (value == null || bands == null) return 0;
        for (Offer_Calculation_Band__c band : bands) {
            Boolean above = band.Lower_Bound__c == null || (band.Lower_Inclusive__c == true ? value >= band.Lower_Bound__c : value > band.Lower_Bound__c);
            Boolean below = band.Upper_Bound__c == null || (band.Upper_Inclusive__c == true ? value <= band.Upper_Bound__c : value < band.Upper_Bound__c);
            if (above && below && band.Score__c != null) return band.Score__c;
        }
        return 0;
    }

    /** Reference minimum and maximum per field, shown to the user as guidance only. */
    public static Map<String, InputBound> boundsForFamily(String family) {
        Map<String, InputBound> byField = new Map<String, InputBound>();
        if (String.isBlank(family)) return byField;

        List<Marketing_Dictionary__c> attrs = [
            SELECT Name, Parameter_API_Name__c
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Offer'
              AND Parameter_API_Name__c != null
              AND Id IN (
                  SELECT Offer_Attribute__c FROM Offer_Attribute_Rule__c
                  WHERE Product_Family__r.Name = :family AND Is_Visible__c = true
              )
        ];
        List<Offer_Reference_Value__c> refs = [
            SELECT Name, Reference_Value__c, Range_Bound__c
            FROM Offer_Reference_Value__c
            WHERE Product_Family__r.Name = :family
              AND (NOT Name LIKE '(TEST)%')
              AND Reference_Value__c != null
        ];
        for (Marketing_Dictionary__c attr : attrs) {
            String subject = subjectOf(attr.Name);
            if (String.isBlank(subject)) continue;
            InputBound bound = new InputBound();
            Boolean matched = false;
            for (Offer_Reference_Value__c ref : refs) {
                if (subjectOf(ref.Name) != subject) continue;
                String role = roleOf(ref.Name, ref.Range_Bound__c);
                if (role == 'min') { bound.minimum = ref.Reference_Value__c; matched = true; }
                if (role == 'max') { bound.maximum = ref.Reference_Value__c; matched = true; }
            }
            if (matched) byField.put(attr.Parameter_API_Name__c, bound);
        }
        return byField;
    }

    private static String subjectOf(String name) {
        if (String.isBlank(name)) return '';
        String s = name.toLowerCase();
        s = s.replace('minimum', '').replace('minimal', '').replace('maximum', '');
        s = s.replace('min', '').replace('max', '');
        return s.replaceAll('[^a-z]', '');
    }

    private static String roleOf(String name, String rangeBound) {
        if (rangeBound == 'Min') return 'min';
        if (rangeBound == 'Max') return 'max';
        if (String.isBlank(name)) return null;
        String s = name.toLowerCase().trim();
        if (s.startsWith('minimum') || s.startsWith('minimal') || s.startsWith('min ')) return 'min';
        if (s.startsWith('maximum') || s.startsWith('max ')) return 'max';
        return null;
    }

    public static Decimal clamp(Decimal z) {
        if (z == null || z < 0) return 0;
        if (z > 1) return 1;
        return z;
    }

    private static String toStr(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    public static Decimal toDecimal(Object o) {
        if (o == null) return null;
        if (o instanceof Decimal) return (Decimal) o;
        String s = String.valueOf(o).trim();
        if (String.isBlank(s)) return null;
        try {
            return Decimal.valueOf(s);
        } catch (Exception e) {
            return null;
        }
    }
}