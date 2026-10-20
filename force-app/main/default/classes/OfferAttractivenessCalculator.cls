/**
 * Computes offer attractiveness on a 0-1 scale as a weighted sum of per-parameter
 * sub-scores. Weights, categorical dictionaries and rate buckets come from the
 * business "Atrakcyjność oferty" spec. Numeric params (amount / tenure) are min-max
 * normalized; deposit/saving promotional amounts use absolute buckets; rate is a
 * bucketed difference versus a per-family reference rate.
 *
 * The GLOBAL reference table (min/max/reference rate) is intentionally centralized
 * here so it stays modifiable. Productionization note: move REFERENCE into Custom
 * Metadata so admins can edit reference rates (e.g. tied to the NBP base rate).
 */
public with sharing class OfferAttractivenessCalculator {

    // --- Global reference values per product family ---
    public class FamilyRef {
        public Decimal amountMin;
        public Decimal amountMax;
        public Decimal tenureMin;
        public Decimal tenureMax;
        public Decimal refRate; // reference nominal interest rate (%)
        public FamilyRef(Decimal aMin, Decimal aMax, Decimal tMin, Decimal tMax, Decimal r) {
            amountMin = aMin; amountMax = aMax; tenureMin = tMin; tenureMax = tMax; refRate = r;
        }
    }

    private static final Map<String, FamilyRef> REFERENCE = new Map<String, FamilyRef>{
        'Cash Loan'          => new FamilyRef(1000, 250000, 0, 120, 14.5),
        'Consolidation Loan' => new FamilyRef(1000, 250000, 0, 120, 14.5),
        'Credit Card'        => new FamilyRef(0, 100000, 0, 0, 14.5),
        'Mortgage'           => new FamilyRef(0, 0, 0, 360, 14.5),
        'Home Equity Loan'   => new FamilyRef(0, 0, 0, 360, 14.5),
        'Term Deposit'       => new FamilyRef(0, 0, 0, 0, 3.75),
        'Term Deposit FX'    => new FamilyRef(0, 0, 0, 0, 3.75),
        'Saving Account'     => new FamilyRef(0, 0, 0, 0, 3.75),
        'Saving Account FX'  => new FamilyRef(0, 0, 0, 0, 3.75)
    };

    // --- Per-family weights (must sum to 1) ---
    private static final Map<String, Map<String, Decimal>> WEIGHTS = new Map<String, Map<String, Decimal>>{
        'Cash Loan' => new Map<String, Decimal>{
            'Nominal_Interest_Rate__c' => 0.45, 'Sales_Process__c' => 0.15,
            'Maximum_Amount__c' => 0.10, 'Maximum_Tenure__c' => 0.10,
            'Earlier_Repayment_Fee__c' => 0.10, 'Interest_Type__c' => 0.10
        },
        'Consolidation Loan' => new Map<String, Decimal>{
            'Nominal_Interest_Rate__c' => 0.45, 'Sales_Process__c' => 0.15,
            'Maximum_Amount__c' => 0.10, 'Maximum_Tenure__c' => 0.10,
            'Earlier_Repayment_Fee__c' => 0.10, 'Interest_Type__c' => 0.10
        },
        'Credit Card' => new Map<String, Decimal>{
            'NO_Fees_Conditions_Simplicity__c' => 0.35, 'Grace_Period_Days__c' => 0.20,
            'Sales_Process__c' => 0.15, 'Additional_VAS__c' => 0.15,
            'Nominal_Interest_Rate__c' => 0.10, 'Maximum_Amount__c' => 0.05
        },
        'Mortgage' => new Map<String, Decimal>{
            'Nominal_Interest_Rate__c' => 0.50, 'Earlier_Repayment_Fee__c' => 0.15,
            'Own_Input_Percentage__c' => 0.15, 'Interest_Type__c' => 0.10,
            'Sales_Process__c' => 0.05, 'Maximum_Tenure__c' => 0.05
        },
        'Home Equity Loan' => new Map<String, Decimal>{
            'Nominal_Interest_Rate__c' => 0.65, 'Earlier_Repayment_Fee__c' => 0.15,
            'Interest_Type__c' => 0.10, 'Sales_Process__c' => 0.05, 'Maximum_Tenure__c' => 0.05
        },
        'Term Deposit' => new Map<String, Decimal>{
            'Nominal_Interest_Rate__c' => 0.65, 'Maximum_Promotional_Amount__c' => 0.25,
            'Interest_Type__c' => 0.10
        },
        'Term Deposit FX' => new Map<String, Decimal>{
            'Nominal_Interest_Rate__c' => 0.65, 'Maximum_Promotional_Amount__c' => 0.25,
            'Interest_Type__c' => 0.10
        },
        'Saving Account' => new Map<String, Decimal>{
            'Nominal_Interest_Rate__c' => 0.65, 'Maximum_Promotional_Amount__c' => 0.35
        },
        'Saving Account FX' => new Map<String, Decimal>{
            'Nominal_Interest_Rate__c' => 0.65, 'Maximum_Promotional_Amount__c' => 0.35
        }
    };

    // --- Categorical dictionaries ---
    private static final Map<String, Decimal> EARLIER_REPAYMENT = new Map<String, Decimal>{ 'YES' => 0, 'NO' => 1 };
    private static final Map<String, Decimal> INTEREST_TYPE = new Map<String, Decimal>{ 'variable' => 0.5, 'fixed' => 1 };
    private static final Map<String, Decimal> SALES_PROCESS = new Map<String, Decimal>{ 'branch' => 0.5, 'omnichannel' => 0.75, 'online' => 1 };
    private static final Map<String, Decimal> GRACE_PERIOD = new Map<String, Decimal>{ 'short' => 0.25, 'standard' => 0.5, 'long' => 0.75 };
    private static final Map<String, Decimal> ADDITIONAL_VAS = new Map<String, Decimal>{
        'none' => 0, 'poor' => 0.2, 'fair' => 0.4, 'good' => 0.6, 'excellent' => 0.8, 'outstanding' => 1
    };
    private static final Map<String, Decimal> NO_FEES_SIMPLICITY = new Map<String, Decimal>{
        'no fee' => 1, 'easy' => 0.75, 'medium' => 0.5, 'difficult' => 0.25, 'not possible' => 0
    };
    private static final Map<String, Decimal> OWN_INPUT = new Map<String, Decimal>{ '10%' => 1, '10-20%' => 0.75, '20%+' => 0.25 };

    @AuraEnabled(cacheable=false)
    public static Decimal scoreOffer(String family, Map<String, Object> params) {
        return calculate(family, params);
    }

    public static Decimal calculate(String family, Map<String, Object> data) {
        if (family == null || data == null) {
            return null;
        }
        Decimal parameterized = scoreFromDictionary(family, data);
        if (parameterized != null) {
            return parameterized;
        }
        FamilyConfig fromDictionary = dictionaryConfig(family);
        if (fromDictionary != null) {
            return score(fromDictionary.weights, fromDictionary.ref, fromDictionary.depositLike, data);
        }
        if (!WEIGHTS.containsKey(family)) {
            return null;
        }
        return score(WEIGHTS.get(family), REFERENCE.get(family), isDepositFamily(family), data);
    }

    private static Decimal score(Map<String, Decimal> weights, FamilyRef ref, Boolean isDepositLike, Map<String, Object> data) {
        Decimal total = 0;
        for (String field : weights.keySet()) {
            Decimal sub = subScore(field, data.get(field), ref, isDepositLike);
            if (sub == null) {
                sub = 0;
            }
            total += weights.get(field) * sub;
        }
        return total.setScale(6, System.RoundingMode.HALF_UP);
    }

    private static Boolean isDepositFamily(String family) {
        return family.startsWith('Term Deposit') || family.startsWith('Saving Account');
    }

    /**
     * Scores from the Marketing Dictionary when every non-test rule on the family
     * has a scoring method and the weights sum to 1. Returns null when that
     * setup is missing, so the built-in table remains the fallback.
     */
    private static Decimal scoreFromDictionary(String family, Map<String, Object> data) {
        List<Offer_Attribute_Rule__c> rules = [
            SELECT Attractiveness_Weight__c, Scoring_Method__c, Picklist_Power_Values__c,
                   Offer_Attribute__r.Parameter_API_Name__c,
                   Reference_Value__r.Reference_Value__c, Reference_Value__r.Value_Type__c
            FROM Offer_Attribute_Rule__c
            WHERE Impacts_Attractiveness__c = true
              AND Product_Family__r.Name = :family
              AND (NOT Offer_Attribute__r.Name LIKE '(TEST)%')
        ];
        if (rules.isEmpty()) return null;

        Decimal sum = 0;
        Set<Id> ruleIds = new Set<Id>();
        for (Offer_Attribute_Rule__c rule : rules) {
            if (String.isBlank(rule.Scoring_Method__c) || rule.Attractiveness_Weight__c == null
                    || rule.Offer_Attribute__r == null || String.isBlank(rule.Offer_Attribute__r.Parameter_API_Name__c)) {
                return null;
            }
            sum += rule.Attractiveness_Weight__c;
            ruleIds.add(rule.Id);
        }
        if (sum.setScale(4, System.RoundingMode.HALF_UP) != 1) return null;

        Map<Id, List<Offer_Attractiveness_Score_Band__c>> bandsByRule = new Map<Id, List<Offer_Attractiveness_Score_Band__c>>();
        for (Offer_Attractiveness_Score_Band__c band : [
            SELECT Rule__c, Value_Key__c, Lower_Bound__c, Upper_Bound__c, Lower_Inclusive__c, Upper_Inclusive__c, Score__c
            FROM Offer_Attractiveness_Score_Band__c
            WHERE Rule__c IN :ruleIds AND Is_Active__c = true
            ORDER BY Sort_Order__c ASC NULLS LAST
        ]) {
            if (!bandsByRule.containsKey(band.Rule__c)) bandsByRule.put(band.Rule__c, new List<Offer_Attractiveness_Score_Band__c>());
            bandsByRule.get(band.Rule__c).add(band);
        }

        Map<String, Decimal> refs = new Map<String, Decimal>();
        for (Offer_Reference_Value__c ref : [
            SELECT Name, Reference_Value__c FROM Offer_Reference_Value__c
            WHERE Product_Family__r.Name = :family
              AND (NOT Name LIKE '(TEST)%')
              AND Reference_Value__c != null
        ]) {
            if (!refs.containsKey(ref.Name)) refs.put(ref.Name, ref.Reference_Value__c);
        }

        Decimal total = 0;
        for (Offer_Attribute_Rule__c rule : rules) {
            String field = rule.Offer_Attribute__r.Parameter_API_Name__c;
            Decimal sub = parameterScore(rule, data.get(field), bandsByRule.get(rule.Id), refs);
            total += rule.Attractiveness_Weight__c * sub;
        }
        return total.setScale(6, System.RoundingMode.HALF_UP);
    }

    private static Decimal parameterScore(Offer_Attribute_Rule__c rule, Object raw, List<Offer_Attractiveness_Score_Band__c> bands, Map<String, Decimal> refs) {
        String method = rule.Scoring_Method__c;
        if (method == 'Categorical') {
            String key = toStr(raw);
            if (key == null) return 0;
            if (bands != null) {
                for (Offer_Attractiveness_Score_Band__c band : bands) {
                    if (band.Value_Key__c == key && band.Score__c != null) return band.Score__c;
                }
            }
            if (String.isBlank(rule.Picklist_Power_Values__c)) return 0;
            Map<String, Object> powers = (Map<String, Object>) JSON.deserializeUntyped(rule.Picklist_Power_Values__c);
            if (powers == null || !powers.containsKey(key) || powers.get(key) == null) return 0;
            return Decimal.valueOf(String.valueOf(powers.get(key)));
        }
        Decimal value = toDecimal(raw);
        if (value == null) return 0;
        if (method == 'Min Max') {
            Decimal lo = refs.get('Minimal Amount');
            Decimal hi = refs.get('Maximum Amount');
            if (rule.Offer_Attribute__r.Parameter_API_Name__c == 'Maximum_Tenure__c') {
                lo = refs.containsKey('Minimal Tenure') ? refs.get('Minimal Tenure') : 0;
                hi = refs.get('Maximum Tenure');
            }
            return minMax(value, lo, hi);
        }
        if (method == 'Loan Rate Gap' || method == 'Deposit Rate Gap') {
            Decimal reference = rule.Reference_Value__r != null && rule.Reference_Value__r.Value_Type__c == 'Percent'
                ? rule.Reference_Value__r.Reference_Value__c : refs.get('Nominal Interest Rate');
            if (reference == null) return 0;
            Decimal gap = method == 'Deposit Rate Gap' ? (value - reference) : (reference - value);
            return matchBand(gap, bands);
        }
        if (method == 'Amount Buckets') return matchBand(value, bands);
        return 0;
    }

    private static Decimal matchBand(Decimal value, List<Offer_Attractiveness_Score_Band__c> bands) {
        if (value == null || bands == null) return 0;
        for (Offer_Attractiveness_Score_Band__c band : bands) {
            Boolean above = band.Lower_Bound__c == null || (band.Lower_Inclusive__c == true ? value >= band.Lower_Bound__c : value > band.Lower_Bound__c);
            Boolean below = band.Upper_Bound__c == null || (band.Upper_Inclusive__c == true ? value <= band.Upper_Bound__c : value < band.Upper_Bound__c);
            if (above && below && band.Score__c != null) return band.Score__c;
        }
        return 0;
    }

    /**
     * A dictionary config is usable only when every scored rule is a known
     * parameter and the weights sum to 1. Partial or test rows stay on the
     * built-in table so an unfinished family cannot change live scores.
     */
    private static FamilyConfig dictionaryConfig(String family) {
        List<Offer_Attribute_Rule__c> rules = [
            SELECT Attractiveness_Weight__c,
                   Offer_Attribute__r.Parameter_API_Name__c,
                   Reference_Value__r.Value_Type__c,
                   Reference_Value__r.Reference_Value__c,
                   Reference_Value__r.Range_Key__c,
                   Reference_Value__r.Range_Bound__c
            FROM Offer_Attribute_Rule__c
            WHERE Impacts_Attractiveness__c = true
              AND Product_Family__r.Name = :family
        ];
        if (rules.isEmpty()) {
            return null;
        }

        Map<String, Decimal> weights = new Map<String, Decimal>();
        Map<String, Offer_Reference_Value__c> refByField = new Map<String, Offer_Reference_Value__c>();
        Set<String> rangeKeys = new Set<String>();
        Decimal sum = 0;
        for (Offer_Attribute_Rule__c rule : rules) {
            String field = rule.Offer_Attribute__r == null ? null : rule.Offer_Attribute__r.Parameter_API_Name__c;
            if (String.isBlank(field) || !isScorableField(field) || rule.Attractiveness_Weight__c == null || weights.containsKey(field)) {
                return null;
            }
            weights.put(field, rule.Attractiveness_Weight__c);
            sum += rule.Attractiveness_Weight__c;
            if (rule.Reference_Value__r != null) {
                refByField.put(field, rule.Reference_Value__r);
                if (rule.Reference_Value__r.Value_Type__c == 'Range' && String.isNotBlank(rule.Reference_Value__r.Range_Key__c)) {
                    rangeKeys.add(rule.Reference_Value__r.Range_Key__c);
                }
            }
        }
        if (sum.setScale(4, System.RoundingMode.HALF_UP) != 1) {
            return null;
        }

        FamilyRef base = REFERENCE.containsKey(family) ? REFERENCE.get(family) : new FamilyRef(null, null, null, null, null);
        FamilyRef ref = new FamilyRef(base.amountMin, base.amountMax, base.tenureMin, base.tenureMax, base.refRate);
        applyDictionaryRefs(ref, refByField, rangeBounds(rangeKeys));

        FamilyConfig cfg = new FamilyConfig();
        cfg.weights = weights;
        cfg.ref = ref;
        cfg.depositLike = isDepositFamily(family);
        return cfg;
    }

    private class FamilyConfig {
        Map<String, Decimal> weights;
        FamilyRef ref;
        Boolean depositLike;
    }

    private static Boolean isScorableField(String field) {
        return field == 'Earlier_Repayment_Fee__c'
            || field == 'Interest_Type__c'
            || field == 'Sales_Process__c'
            || field == 'Grace_Period_Days__c'
            || field == 'Additional_VAS__c'
            || field == 'NO_Fees_Conditions_Simplicity__c'
            || field == 'Own_Input_Percentage__c'
            || field == 'Nominal_Interest_Rate__c'
            || field == 'Maximum_Amount__c'
            || field == 'Maximum_Tenure__c'
            || field == 'Maximum_Promotional_Amount__c';
    }

    private class RangePair {
        Decimal min;
        Decimal max;
    }

    private static Map<String, RangePair> rangeBounds(Set<String> rangeKeys) {
        Map<String, RangePair> pairs = new Map<String, RangePair>();
        if (rangeKeys.isEmpty()) {
            return pairs;
        }
        for (Offer_Reference_Value__c bound : [
            SELECT Range_Key__c, Range_Bound__c, Reference_Value__c
            FROM Offer_Reference_Value__c
            WHERE Range_Key__c IN :rangeKeys
        ]) {
            if (!pairs.containsKey(bound.Range_Key__c)) {
                pairs.put(bound.Range_Key__c, new RangePair());
            }
            RangePair pair = pairs.get(bound.Range_Key__c);
            if (bound.Range_Bound__c == 'Min') pair.min = bound.Reference_Value__c;
            if (bound.Range_Bound__c == 'Max') pair.max = bound.Reference_Value__c;
        }
        return pairs;
    }

    private static void applyDictionaryRefs(FamilyRef ref, Map<String, Offer_Reference_Value__c> refByField, Map<String, RangePair> pairs) {
        Offer_Reference_Value__c rate = refByField.get('Nominal_Interest_Rate__c');
        if (rate != null && rate.Value_Type__c == 'Percent' && rate.Reference_Value__c != null) {
            ref.refRate = rate.Reference_Value__c;
        }
        applyRange(ref, refByField.get('Maximum_Amount__c'), pairs, true);
        applyRange(ref, refByField.get('Maximum_Tenure__c'), pairs, false);
    }

    private static void applyRange(FamilyRef ref, Offer_Reference_Value__c source, Map<String, RangePair> pairs, Boolean amount) {
        if (source == null || source.Value_Type__c != 'Range' || String.isBlank(source.Range_Key__c)) {
            return;
        }
        RangePair pair = pairs.get(source.Range_Key__c);
        if (pair == null || pair.min == null || pair.max == null || pair.max <= pair.min) {
            return;
        }
        if (amount) {
            ref.amountMin = pair.min;
            ref.amountMax = pair.max;
        } else {
            ref.tenureMin = pair.min;
            ref.tenureMax = pair.max;
        }
    }

    private static Decimal subScore(String field, Object raw, FamilyRef ref, Boolean isDepositLike) {
        if (field == 'Earlier_Repayment_Fee__c') return EARLIER_REPAYMENT.get(toStr(raw));
        if (field == 'Interest_Type__c') return INTEREST_TYPE.get(toStr(raw));
        if (field == 'Sales_Process__c') return SALES_PROCESS.get(toStr(raw));
        if (field == 'Grace_Period_Days__c') return GRACE_PERIOD.get(toStr(raw));
        if (field == 'Additional_VAS__c') return ADDITIONAL_VAS.get(toStr(raw));
        if (field == 'NO_Fees_Conditions_Simplicity__c') return NO_FEES_SIMPLICITY.get(toStr(raw));
        if (field == 'Own_Input_Percentage__c') return OWN_INPUT.get(toStr(raw));

        if (field == 'Nominal_Interest_Rate__c') {
            return rateScore(toDecimal(raw), ref, isDepositLike);
        }
        if (field == 'Maximum_Amount__c') {
            return minMax(toDecimal(raw), ref.amountMin, ref.amountMax);
        }
        if (field == 'Maximum_Tenure__c') {
            return minMax(toDecimal(raw), ref.tenureMin, ref.tenureMax);
        }
        if (field == 'Maximum_Promotional_Amount__c') {
            return depositAmountBucket(toDecimal(raw));
        }
        return null;
    }

    // Min-max normalization: Z = (X - min) / (max - min), clamped to [0,1].
    private static Decimal minMax(Decimal x, Decimal lo, Decimal hi) {
        if (x == null || hi == null || lo == null || hi <= lo) return 0;
        Decimal z = (x - lo) / (hi - lo);
        if (z < 0) return 0;
        if (z > 1) return 1;
        return z;
    }

    // Rate = bucketed difference versus the reference rate.
    // Loans/cards: cheaper than reference is better (diff = ref - offered).
    // Deposits/savings: higher than reference is better (diff = offered - ref), inverted table.
    private static Decimal rateScore(Decimal offered, FamilyRef ref, Boolean isDepositLike) {
        if (offered == null || ref == null) return 0;
        Decimal diff = isDepositLike ? (offered - ref.refRate) : (ref.refRate - offered);
        return isDepositLike ? depositRateBucket(diff) : loanRateBucket(diff);
    }

    private static Decimal loanRateBucket(Decimal d) {
        if (d <= 1) return 0.1;
        if (d <= 2) return 0.2;
        if (d <= 3) return 0.3;
        if (d <= 4) return 0.4;
        if (d <= 5) return 0.5;
        if (d <= 6) return 0.6;
        if (d <= 7) return 0.7;
        if (d <= 8) return 0.8;
        if (d <= 9) return 0.9;
        return 1;
    }

    private static Decimal depositRateBucket(Decimal d) {
        if (d < 0) return 0;
        if (d == 0) return 0.1;
        if (d <= 1) return 0.2;
        if (d <= 2) return 0.3;
        if (d <= 3) return 0.4;
        if (d <= 4) return 0.6;
        if (d <= 5) return 0.8;
        return 1;
    }

    private static Decimal depositAmountBucket(Decimal a) {
        if (a == null) return 0;
        if (a <= 25000) return 0.1;
        if (a <= 50000) return 0.2;
        if (a <= 100000) return 0.3;
        if (a <= 150000) return 0.4;
        if (a <= 200000) return 0.5;
        if (a <= 300000) return 0.6;
        if (a <= 400000) return 0.7;
        if (a <= 500000) return 0.8;
        return 1;
    }

    private static String toStr(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private static Decimal toDecimal(Object o) {
        if (o == null) return null;
        try {
            return Decimal.valueOf(String.valueOf(o));
        } catch (Exception e) {
            return null;
        }
    }
}